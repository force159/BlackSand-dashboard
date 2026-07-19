'use strict';
/**
 * BlackSand dashboard — SQLite schema definition (Phase 1).
 *
 * This module is pure DATA: the DDL for the initial schema plus a description of the
 * expected structure (tables / columns / indexes) that the health module validates
 * against. It performs no I/O and opens no connection.
 *
 * Design notes:
 *   - Areas are REAL square metres (source data is fractional m², e.g. 317.71).
 *   - All timestamps are ISO-8601 UTC TEXT (new Date().toISOString()).
 *   - Every externally-sourced row carries a nullable `external_id` — the stable
 *     Monday item id in later phases. Tenant NAME is deliberately NOT unique
 *     (one tenant can hold many leases; duplicate names are real).
 *   - The schema is project-centric so a future residential dashboard is just more
 *     rows (+ additive migrations), never a rebuild. Category `code`, building
 *     `code`, and `occupancy_source` are intentionally NOT constrained to a fixed
 *     list at the DB level — validation (a later phase) owns business rules.
 *   - CHECK constraints guard only hard invariants (non-negative areas, 0/1 flags,
 *     leased ≤ total, percentages in 0..1).
 *
 * NOTHING here inserts business data. Tables are created empty.
 */

// The current schema version. Bumping this requires a matching migration (see
// migrations.js) and, usually, an update to the expected structure below.
//   v1 = 001_initial_schema
//   v2 = 002_add_source_record_keys (adds leases.source_record_key for stable,
//        idempotent seed identity — duplicate tenant rows mean name is not a key)
//   v3 = 003_source_ownership_and_sync_meta (adds projects.current_data_source — the
//        AUTHORITATIVE source the dashboard reads per project, distinct from a row's
//        provenance `source`; plus richer sync_runs telemetry columns)
//   v4 = 004_add_lease_unit_code (adds leases.unit_code — the Monday item's unit code,
//        e.g. "(A-GF-R01)"/"C04"/"D101"; drives project-specific building allocation)
//   v5 = 005_historical_snapshots (Phase 9.1A: additive historical snapshot tables —
//        audit runs + project/building/tenant snapshots + indexes; no live table touched)
//   v6 = 006_historical_execution_lock (Phase 9.1B: cross-process snapshot execution lock)
const SCHEMA_VERSION = 6;

/**
 * Initial schema DDL (migration 001). Tables are created in a foreign-key-safe
 * order; indexes follow. `schema_migrations` is created by the migration runner
 * itself (migrations.js) before any migration runs, so it is not repeated here.
 */
const INITIAL_SCHEMA_SQL = `
-- ── projects ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                INTEGER PRIMARY KEY,
  external_id       TEXT,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  address           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  source            TEXT NOT NULL DEFAULT 'seed',
  source_updated_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_external_id ON projects (external_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_active   ON projects (is_active);

-- ── property_categories ───────────────────────────────────────────────────────
-- Categories within a project (retail / office / residential / serviced / parking …).
-- The valid set is intentionally open — do not enforce it in the DB.
CREATE TABLE IF NOT EXISTS property_categories (
  id                  INTEGER PRIMARY KEY,
  project_id          INTEGER NOT NULL,
  code                TEXT NOT NULL,
  label               TEXT NOT NULL,
  total_area          REAL NOT NULL DEFAULT 0 CHECK (total_area >= 0),
  occupancy_source    TEXT NOT NULL DEFAULT 'leases',
  explicit_leased_pct REAL CHECK (explicit_leased_pct IS NULL OR (explicit_leased_pct >= 0 AND explicit_leased_pct <= 1)),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  UNIQUE (project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_property_categories_project_id ON property_categories (project_id);

-- ── buildings ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buildings (
  id                INTEGER PRIMARY KEY,
  external_id       TEXT,
  project_id        INTEGER NOT NULL,
  code              TEXT,
  name              TEXT NOT NULL,
  total_area        REAL NOT NULL DEFAULT 0 CHECK (total_area >= 0),
  sort_order        INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  source            TEXT NOT NULL DEFAULT 'seed',
  source_updated_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  UNIQUE (project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_buildings_project_id  ON buildings (project_id);
CREATE INDEX IF NOT EXISTS idx_buildings_external_id ON buildings (external_id);
CREATE INDEX IF NOT EXISTS idx_buildings_is_active   ON buildings (is_active);

-- ── leases ──────────────────────────────────────────────────────────────────
-- One lease-like row. tenant_name is NOT unique (duplicate names are real; one
-- tenant can hold many leases). external_id becomes the stable Monday item id.
CREATE TABLE IF NOT EXISTS leases (
  id                 INTEGER PRIMARY KEY,
  external_id        TEXT,
  project_id         INTEGER NOT NULL,
  category_id        INTEGER,
  building_id        INTEGER,
  tenant_name        TEXT NOT NULL,
  tenant_external_id TEXT,
  tenant_type        TEXT,
  area               REAL NOT NULL DEFAULT 0 CHECK (area >= 0),
  lease_date         TEXT,
  status             TEXT,
  logo_path          TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  source             TEXT NOT NULL DEFAULT 'seed',
  source_updated_at  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY (project_id)  REFERENCES projects (id)            ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES property_categories (id) ON DELETE SET NULL,
  FOREIGN KEY (building_id) REFERENCES buildings (id)           ON DELETE SET NULL
);
-- Partial UNIQUE: external ids must be unique when present, but many seed rows
-- (this phase / Phase 2) legitimately have NULL external_id.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_leases_external_id ON leases (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leases_project_id  ON leases (project_id);
CREATE INDEX IF NOT EXISTS idx_leases_category_id ON leases (category_id);
CREATE INDEX IF NOT EXISTS idx_leases_building_id ON leases (building_id);
CREATE INDEX IF NOT EXISTS idx_leases_lease_date  ON leases (lease_date);
CREATE INDEX IF NOT EXISTS idx_leases_is_active   ON leases (is_active);

-- ── building_departments ──────────────────────────────────────────────────────
-- Category/department breakdown per building. Strict: leased_area <= total_area.
-- Incomplete source data is a validation concern (later phase), not a schema one.
CREATE TABLE IF NOT EXISTS building_departments (
  id          INTEGER PRIMARY KEY,
  building_id INTEGER NOT NULL,
  category_id INTEGER,
  code        TEXT NOT NULL,
  label       TEXT NOT NULL,
  total_area  REAL NOT NULL DEFAULT 0 CHECK (total_area >= 0),
  leased_area REAL NOT NULL DEFAULT 0 CHECK (leased_area >= 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (building_id) REFERENCES buildings (id)            ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES property_categories (id)  ON DELETE SET NULL,
  UNIQUE (building_id, code),
  CHECK (leased_area <= total_area)
);
CREATE INDEX IF NOT EXISTS idx_building_departments_building_id ON building_departments (building_id);

-- ── sync_runs ─────────────────────────────────────────────────────────────────
-- Audit of future seed / Monday sync attempts. Never store secrets or raw API
-- payloads here (only counts + a concise, secret-free message).
CREATE TABLE IF NOT EXISTS sync_runs (
  id                  INTEGER PRIMARY KEY,
  source              TEXT NOT NULL,
  status              TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  last_data_change_at TEXT,
  data_version        TEXT,
  record_count        INTEGER NOT NULL DEFAULT 0,
  warning_count       INTEGER NOT NULL DEFAULT 0,
  rejected_row_count  INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER,
  error_code          TEXT,
  error_message       TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status      ON sync_runs (status);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at  ON sync_runs (started_at);
CREATE INDEX IF NOT EXISTS idx_sync_runs_finished_at ON sync_runs (finished_at);

-- ── dashboard_snapshots ─────────────────────────────────────────────────────
-- Canonical per-project KPI history for future trends. Not populated in Phase 1.
-- occupancy_pct is a fraction (0..1). At most one effective snapshot per project
-- per day (enforced via UNIQUE(project_id, snapshot_date)).
CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id               INTEGER PRIMARY KEY,
  project_id       INTEGER NOT NULL,
  snapshot_date    TEXT NOT NULL,
  data_version     TEXT NOT NULL,
  source           TEXT NOT NULL,
  total_area       REAL NOT NULL DEFAULT 0,
  leased_area      REAL NOT NULL DEFAULT 0,
  vacant_area      REAL NOT NULL DEFAULT 0,
  occupancy_pct    REAL NOT NULL DEFAULT 0,
  tenant_count     INTEGER NOT NULL DEFAULT 0,
  new_leasing_area REAL NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  UNIQUE (project_id, snapshot_date),
  CHECK (total_area >= 0),
  CHECK (leased_area >= 0),
  CHECK (vacant_area >= 0),
  CHECK (occupancy_pct >= 0 AND occupancy_pct <= 1),
  CHECK (tenant_count >= 0),
  CHECK (new_leasing_area >= 0)
);
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_project_id ON dashboard_snapshots (project_id);
`;

/**
 * Historical snapshot schema (migration 005, Phase 9.1A). ADDITIVE only. Percentages
 * are 0–100; areas REAL m²; dates/timestamps ISO-8601 TEXT; booleans INTEGER 0/1. CHECK
 * constraints guard hard invariants only (non-negative areas/counts/occupancy, non-empty
 * project key) — NOT floating rounding-sensitive bounds (validation owns 0..100 etc.).
 */
const HISTORICAL_SCHEMA_SQL = `
-- ── historical_snapshot_runs (audit of every attempt: manual/test/dry-run/write) ──
CREATE TABLE IF NOT EXISTS historical_snapshot_runs (
  id                       INTEGER PRIMARY KEY,
  run_id                   TEXT NOT NULL UNIQUE,
  trigger_type             TEXT NOT NULL,
  requested_project_key    TEXT,
  started_at_utc           TEXT NOT NULL,
  completed_at_utc         TEXT,
  business_date            TEXT,
  timezone                 TEXT,
  mode                     TEXT NOT NULL,
  status                   TEXT NOT NULL,
  source_type              TEXT,
  source_data_version      TEXT,
  source_synced_at_utc     TEXT,
  snapshot_count_requested INTEGER,
  snapshot_count_created   INTEGER,
  snapshot_count_skipped   INTEGER,
  validation_error_count   INTEGER,
  error_code               TEXT,
  error_message            TEXT,
  metadata_json            TEXT
);
CREATE INDEX IF NOT EXISTS idx_hsr_started_at   ON historical_snapshot_runs (started_at_utc);
CREATE INDEX IF NOT EXISTS idx_hsr_status       ON historical_snapshot_runs (status);
CREATE INDEX IF NOT EXISTS idx_hsr_business_date ON historical_snapshot_runs (business_date);

-- ── historical_project_snapshots (parent: one project × one Riyadh business date) ──
CREATE TABLE IF NOT EXISTS historical_project_snapshots (
  id                              INTEGER PRIMARY KEY,
  snapshot_id                     TEXT NOT NULL UNIQUE,
  run_id                          TEXT NOT NULL,
  project_key                     TEXT NOT NULL CHECK (length(project_key) > 0),
  project_name                    TEXT,
  business_date                   TEXT NOT NULL,
  timezone                        TEXT NOT NULL,
  captured_at_utc                 TEXT NOT NULL,
  source_type                     TEXT NOT NULL,
  source_data_version             TEXT,
  source_synced_at_utc            TEXT,
  source_record_count             INTEGER,
  schema_version                  INTEGER NOT NULL,
  calculation_version             TEXT NOT NULL,
  total_gla                       REAL CHECK (total_gla IS NULL OR total_gla >= 0),
  leased_area                     REAL CHECK (leased_area IS NULL OR leased_area >= 0),
  vacant_area                     REAL CHECK (vacant_area IS NULL OR vacant_area >= 0),
  occupancy_percent               REAL CHECK (occupancy_percent IS NULL OR occupancy_percent >= 0),
  retail_total_area               REAL,
  retail_leased_area              REAL,
  retail_vacant_area              REAL,
  retail_occupancy_percent        REAL,
  office_total_area               REAL,
  office_leased_area              REAL,
  office_vacant_area              REAL,
  office_occupancy_percent        REAL,
  active_lease_count              INTEGER,
  tenant_count_raw                INTEGER,
  tenant_count_aggregated         INTEGER,
  occupied_unit_count             INTEGER,
  vacant_unit_count               INTEGER,
  total_unit_count                INTEGER,
  leasing_velocity_area_90d       REAL,
  leasing_velocity_lease_count_90d INTEGER,
  unassigned_area                 REAL,
  unassigned_unit_count           INTEGER,
  excluded_record_count           INTEGER,
  warning_count                   INTEGER,
  warnings_json                   TEXT,
  metadata_json                   TEXT,
  created_at_utc                  TEXT NOT NULL,
  UNIQUE (project_key, business_date)
);
CREATE INDEX IF NOT EXISTS idx_hps_project_date  ON historical_project_snapshots (project_key, business_date);
CREATE INDEX IF NOT EXISTS idx_hps_business_date ON historical_project_snapshots (business_date);
CREATE INDEX IF NOT EXISTS idx_hps_captured_at   ON historical_project_snapshots (captured_at_utc);
CREATE INDEX IF NOT EXISTS idx_hps_data_version  ON historical_project_snapshots (source_data_version);

-- ── historical_building_snapshots (child) ──
CREATE TABLE IF NOT EXISTS historical_building_snapshots (
  id                       INTEGER PRIMARY KEY,
  project_snapshot_id      INTEGER NOT NULL,
  snapshot_id              TEXT NOT NULL,
  project_key              TEXT NOT NULL,
  business_date            TEXT NOT NULL,
  building_key             TEXT NOT NULL,
  building_name            TEXT,
  building_order           INTEGER,
  total_area               REAL CHECK (total_area IS NULL OR total_area >= 0),
  leased_area              REAL CHECK (leased_area IS NULL OR leased_area >= 0),
  vacant_area              REAL CHECK (vacant_area IS NULL OR vacant_area >= 0),
  occupancy_percent        REAL CHECK (occupancy_percent IS NULL OR occupancy_percent >= 0),
  retail_total_area        REAL,
  retail_leased_area       REAL,
  retail_vacant_area       REAL,
  retail_occupancy_percent REAL,
  office_total_area        REAL,
  office_leased_area       REAL,
  office_vacant_area       REAL,
  office_occupancy_percent REAL,
  tenant_count_raw         INTEGER,
  tenant_count_aggregated  INTEGER,
  unit_count               INTEGER,
  occupied_unit_count      INTEGER,
  vacant_unit_count        INTEGER,
  excluded_record_count    INTEGER,
  warnings_json            TEXT,
  metadata_json            TEXT,
  created_at_utc           TEXT NOT NULL,
  FOREIGN KEY (project_snapshot_id) REFERENCES historical_project_snapshots (id) ON DELETE CASCADE,
  UNIQUE (project_snapshot_id, building_key)
);
CREATE INDEX IF NOT EXISTS idx_hbs_parent        ON historical_building_snapshots (project_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_hbs_project_bkey  ON historical_building_snapshots (project_key, building_key, business_date);
CREATE INDEX IF NOT EXISTS idx_hbs_project_date  ON historical_building_snapshots (project_key, business_date);

-- ── historical_tenant_snapshots (child: project-wide aggregated tenants) ──
CREATE TABLE IF NOT EXISTS historical_tenant_snapshots (
  id                        INTEGER PRIMARY KEY,
  project_snapshot_id       INTEGER NOT NULL,
  snapshot_id               TEXT NOT NULL,
  project_key               TEXT NOT NULL,
  business_date             TEXT NOT NULL,
  tenant_key                TEXT NOT NULL,
  tenant_display_name       TEXT,
  tenant_normalized_name    TEXT,
  total_leased_area         REAL CHECK (total_leased_area IS NULL OR total_leased_area >= 0),
  lease_record_count        INTEGER,
  unit_count                INTEGER,
  building_count            INTEGER,
  building_keys_json        TEXT,
  primary_category          TEXT,
  categories_json           TEXT,
  rank_by_area              INTEGER,
  is_top_3                  INTEGER CHECK (is_top_3 IN (0, 1)),
  is_top_5                  INTEGER CHECK (is_top_5 IN (0, 1)),
  is_top_10                 INTEGER CHECK (is_top_10 IN (0, 1)),
  active_lease_count        INTEGER,
  earliest_active_start_date TEXT,
  latest_active_start_date  TEXT,
  warnings_json             TEXT,
  metadata_json             TEXT,
  created_at_utc            TEXT NOT NULL,
  FOREIGN KEY (project_snapshot_id) REFERENCES historical_project_snapshots (id) ON DELETE CASCADE,
  UNIQUE (project_snapshot_id, tenant_key)
);
CREATE INDEX IF NOT EXISTS idx_hts_parent       ON historical_tenant_snapshots (project_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_hts_project_tkey ON historical_tenant_snapshots (project_key, tenant_key, business_date);
CREATE INDEX IF NOT EXISTS idx_hts_project_date ON historical_tenant_snapshots (project_key, business_date);
CREATE INDEX IF NOT EXISTS idx_hts_project_rank ON historical_tenant_snapshots (project_key, rank_by_area, business_date);
`;

/**
 * Execution-lock table (migration 006, Phase 9.1B). One row per lock name; atomic
 * acquisition via INSERT, stale takeover via a guarded UPDATE. No secrets stored.
 */
const EXECUTION_LOCK_SQL = `
CREATE TABLE IF NOT EXISTS historical_execution_locks (
  lock_name       TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  acquired_at_utc TEXT NOT NULL,
  expires_at_utc  TEXT NOT NULL,
  metadata_json   TEXT
);
`;

/**
 * Expected structure the health/validation module checks against. Kept in sync
 * with the DDL above. `schema_migrations` is included (created by the runner).
 * Column checks assert PRESENCE (not ordering) so they are robust.
 */
const EXPECTED_TABLES = [
  'schema_migrations',
  'projects',
  'property_categories',
  'buildings',
  'leases',
  'building_departments',
  'sync_runs',
  'dashboard_snapshots',
  'historical_snapshot_runs',
  'historical_project_snapshots',
  'historical_building_snapshots',
  'historical_tenant_snapshots',
  'historical_execution_locks',
];

const EXPECTED_COLUMNS = {
  schema_migrations: ['version', 'name', 'applied_at'],
  projects: ['id', 'external_id', 'slug', 'name', 'address', 'is_active', 'source', 'current_data_source', 'source_updated_at', 'created_at', 'updated_at'],
  property_categories: ['id', 'project_id', 'code', 'label', 'total_area', 'occupancy_source', 'explicit_leased_pct', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  buildings: ['id', 'external_id', 'project_id', 'code', 'name', 'total_area', 'sort_order', 'is_active', 'source', 'source_updated_at', 'created_at', 'updated_at'],
  leases: ['id', 'external_id', 'project_id', 'category_id', 'building_id', 'tenant_name', 'tenant_external_id', 'tenant_type', 'area', 'lease_date', 'status', 'logo_path', 'is_active', 'source', 'source_updated_at', 'source_record_key', 'unit_code', 'created_at', 'updated_at'],
  building_departments: ['id', 'building_id', 'category_id', 'code', 'label', 'total_area', 'leased_area', 'created_at', 'updated_at'],
  sync_runs: ['id', 'source', 'status', 'started_at', 'finished_at', 'last_data_change_at', 'data_version', 'record_count', 'warning_count', 'rejected_row_count', 'duration_ms', 'error_code', 'error_message', 'created_at', 'records_fetched', 'records_accepted', 'insert_count', 'update_count', 'deactivate_count', 'unchanged_count', 'dry_run', 'cutover', 'previous_source', 'new_source', 'scope'],
  dashboard_snapshots: ['id', 'project_id', 'snapshot_date', 'data_version', 'source', 'total_area', 'leased_area', 'vacant_area', 'occupancy_pct', 'tenant_count', 'new_leasing_area', 'created_at', 'updated_at'],
  historical_snapshot_runs: ['id', 'run_id', 'trigger_type', 'requested_project_key', 'started_at_utc', 'completed_at_utc', 'business_date', 'timezone', 'mode', 'status', 'source_type', 'source_data_version', 'source_synced_at_utc', 'snapshot_count_requested', 'snapshot_count_created', 'snapshot_count_skipped', 'validation_error_count', 'error_code', 'error_message', 'metadata_json'],
  historical_project_snapshots: ['id', 'snapshot_id', 'run_id', 'project_key', 'project_name', 'business_date', 'timezone', 'captured_at_utc', 'source_type', 'source_data_version', 'source_synced_at_utc', 'source_record_count', 'schema_version', 'calculation_version', 'total_gla', 'leased_area', 'vacant_area', 'occupancy_percent', 'retail_total_area', 'retail_leased_area', 'retail_vacant_area', 'retail_occupancy_percent', 'office_total_area', 'office_leased_area', 'office_vacant_area', 'office_occupancy_percent', 'active_lease_count', 'tenant_count_raw', 'tenant_count_aggregated', 'occupied_unit_count', 'vacant_unit_count', 'total_unit_count', 'leasing_velocity_area_90d', 'leasing_velocity_lease_count_90d', 'unassigned_area', 'unassigned_unit_count', 'excluded_record_count', 'warning_count', 'warnings_json', 'metadata_json', 'created_at_utc'],
  historical_building_snapshots: ['id', 'project_snapshot_id', 'snapshot_id', 'project_key', 'business_date', 'building_key', 'building_name', 'building_order', 'total_area', 'leased_area', 'vacant_area', 'occupancy_percent', 'retail_total_area', 'retail_leased_area', 'retail_vacant_area', 'retail_occupancy_percent', 'office_total_area', 'office_leased_area', 'office_vacant_area', 'office_occupancy_percent', 'tenant_count_raw', 'tenant_count_aggregated', 'unit_count', 'occupied_unit_count', 'vacant_unit_count', 'excluded_record_count', 'warnings_json', 'metadata_json', 'created_at_utc'],
  historical_execution_locks: ['lock_name', 'owner_id', 'acquired_at_utc', 'expires_at_utc', 'metadata_json'],
  historical_tenant_snapshots: ['id', 'project_snapshot_id', 'snapshot_id', 'project_key', 'business_date', 'tenant_key', 'tenant_display_name', 'tenant_normalized_name', 'total_leased_area', 'lease_record_count', 'unit_count', 'building_count', 'building_keys_json', 'primary_category', 'categories_json', 'rank_by_area', 'is_top_3', 'is_top_5', 'is_top_10', 'active_lease_count', 'earliest_active_start_date', 'latest_active_start_date', 'warnings_json', 'metadata_json', 'created_at_utc'],
};

// A practical subset of the explicit named indexes to assert exist. (We do not
// assert every implicit UNIQUE autoindex — those are guaranteed by the constraints.)
const EXPECTED_INDEXES = [
  'idx_projects_external_id',
  'idx_projects_is_active',
  'idx_property_categories_project_id',
  'idx_buildings_project_id',
  'idx_buildings_external_id',
  'idx_buildings_is_active',
  'uidx_leases_external_id',
  'uidx_leases_source_record_key',
  'idx_leases_project_id',
  'idx_leases_category_id',
  'idx_leases_building_id',
  'idx_leases_lease_date',
  'idx_leases_is_active',
  'idx_building_departments_building_id',
  'idx_sync_runs_status',
  'idx_sync_runs_started_at',
  'idx_sync_runs_finished_at',
  'idx_dashboard_snapshots_project_id',
  'idx_hsr_started_at',
  'idx_hps_project_date',
  'idx_hps_business_date',
  'idx_hbs_parent',
  'idx_hts_parent',
  'idx_hts_project_rank',
];

// Business tables that must be EMPTY in Phase 1 (no seed data allowed).
const BUSINESS_TABLES = [
  'projects',
  'property_categories',
  'buildings',
  'leases',
  'building_departments',
  'sync_runs',
  'dashboard_snapshots',
];

module.exports = {
  SCHEMA_VERSION,
  INITIAL_SCHEMA_SQL,
  HISTORICAL_SCHEMA_SQL,
  EXECUTION_LOCK_SQL,
  EXPECTED_TABLES,
  EXPECTED_COLUMNS,
  EXPECTED_INDEXES,
  BUSINESS_TABLES,
};
