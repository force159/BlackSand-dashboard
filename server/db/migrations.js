'use strict';
/**
 * BlackSand dashboard — lightweight migration runner (Phase 1). No ORM.
 *
 * A dedicated `schema_migrations` table records which versioned migrations have
 * been applied. Migrations are an ordered list; each has an integer `version`, a
 * descriptive `name`, and an `up(db)` function. On run:
 *   - the tracking table is ensured;
 *   - already-applied versions are skipped;
 *   - each pending migration runs inside a TRANSACTION (rolls back on failure);
 *   - the migration is recorded ONLY after its `up` succeeds;
 *   - re-running is safe (no duplicate tables, no duplicate tracking rows).
 *
 * There is intentionally no destructive down/rollback system in v1 — SQLite has
 * weak ALTER support, so migrations are forward-only and "rollback" means restoring
 * a backup. Future phases (e.g. residential fields) ADD new migration entries; they
 * never edit a shipped migration.
 */

const { INITIAL_SCHEMA_SQL, SCHEMA_VERSION } = require('./schema');

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

/**
 * Ordered migration list. Keep versions monotonic and never reorder/edit a shipped
 * entry — add a new one instead.
 */
const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_schema',
    up(db) {
      // All CREATE TABLE / CREATE INDEX statements are IF NOT EXISTS, so this is
      // itself safe, but the applied-version guard means it only runs once anyway.
      db.exec(INITIAL_SCHEMA_SQL);
    },
  },
  {
    version: 2,
    name: '002_add_source_record_keys',
    up(db) {
      // Leases need a STABLE, per-record identity for repeatable seeding: duplicate
      // tenant names and duplicate rows are legitimate, so tenant_name is not a key
      // and Monday external_id is null for seed rows. `source_record_key` is a
      // deterministic seed-only key (e.g. "seed:lease:business-address:retail:001").
      // A partial UNIQUE index makes (source, source_record_key) unique when set,
      // while leaving it free for future Monday rows that use external_id instead.
      db.exec(`
        ALTER TABLE leases ADD COLUMN source_record_key TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS uidx_leases_source_record_key
          ON leases (source, source_record_key)
          WHERE source_record_key IS NOT NULL;
      `);
    },
  },
  {
    version: 3,
    name: '003_source_ownership_and_sync_meta',
    up(db) {
      // AUTHORITATIVE source per project (distinct from a row's provenance `source`).
      // The dashboard reads leases for a project WHERE source = current_data_source, so
      // seed and Monday rows never count together. Defaults to 'seed' so existing
      // behaviour is unchanged until a Monday cutover flips it to 'monday'.
      db.exec(`ALTER TABLE projects ADD COLUMN current_data_source TEXT NOT NULL DEFAULT 'seed';`);
      // Richer sync telemetry (all nullable/defaulted; no secrets, no payloads).
      const cols = [
        'records_fetched INTEGER', 'records_accepted INTEGER',
        'insert_count INTEGER', 'update_count INTEGER', 'deactivate_count INTEGER', 'unchanged_count INTEGER',
        'dry_run INTEGER NOT NULL DEFAULT 0', 'cutover INTEGER NOT NULL DEFAULT 0',
        'previous_source TEXT', 'new_source TEXT', 'scope TEXT',
      ];
      for (const c of cols) db.exec(`ALTER TABLE sync_runs ADD COLUMN ${c};`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_projects_current_data_source ON projects (current_data_source);');
    },
  },
  {
    version: 4,
    name: '004_add_lease_unit_code',
    up(db) {
      // The Monday item's UNIT CODE (its item name, e.g. "(A-GF-R01)" / "C04" / "D101").
      // Additive + nullable: existing rows get NULL until the next Monday sync repopulates
      // it. It is the authoritative key for project-specific building allocation (Town
      // Center: first letter A–G → Building 1–7; Business Address: explicit lookup table).
      // Seed rows leave it NULL (seed projects keep the manual buildings table).
      db.exec('ALTER TABLE leases ADD COLUMN unit_code TEXT;');
    },
  },
  {
    version: 5,
    name: '005_historical_snapshots',
    up(db) {
      // Phase 9.1A: the historical snapshot foundation (audit runs + project/building/
      // tenant snapshot tables + indexes). Purely ADDITIVE — no existing table/row is
      // touched, so /api/dashboard and all current data are unaffected. Percentages are
      // stored 0–100 (matches the live `metrics.*Pct`); areas are REAL m²; timestamps/dates
      // are ISO-8601 TEXT. FKs cascade so a (future, admin-only) parent delete cleans
      // children — snapshots are immutable in 9.1A and never deleted by normal flows.
      db.exec(require('./schema').HISTORICAL_SCHEMA_SQL);
    },
  },
  {
    version: 6,
    name: '006_historical_execution_lock',
    up(db) {
      // Phase 9.1B: a cross-process execution lock so scheduled/recovery/post-sync/CLI
      // snapshot attempts never overlap even across multiple Node processes sharing the
      // SQLite file (the in-process mutex + UNIQUE(project,date) are the other two layers).
      db.exec(require('./schema').EXECUTION_LOCK_SQL);
    },
  },
];

/** Ensure the tracking table exists (idempotent). */
function ensureMigrationsTable(db) {
  db.exec(SCHEMA_MIGRATIONS_DDL);
}

/** Highest applied migration version, or 0 if none. */
function getCurrentVersion(db) {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row && row.v != null ? row.v : 0;
}

/** Set of applied versions. */
function getAppliedVersions(db) {
  ensureMigrationsTable(db);
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
}

/**
 * Apply all pending migrations in order. Returns a concise summary:
 *   { fromVersion, toVersion, applied: [{version, name}], skipped: [versions] }
 * Logs one line per applied/skip decision when `log` is provided.
 */
function runMigrations(db, log = () => {}) {
  ensureMigrationsTable(db);
  const applied = getAppliedVersions(db);
  const fromVersion = getCurrentVersion(db);

  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
  const results = { fromVersion, toVersion: fromVersion, applied: [], skipped: [] };

  for (const migration of ordered) {
    if (applied.has(migration.version)) {
      results.skipped.push(migration.version);
      log(`  · migration ${migration.version} (${migration.name}) already applied — skipping`);
      continue;
    }

    // Run the migration and record it atomically: if either the DDL or the tracking
    // insert throws, the whole transaction rolls back and nothing is recorded.
    const applyOne = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(migration.version, migration.name, new Date().toISOString());
    });

    try {
      applyOne();
    } catch (err) {
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${err.message}`);
    }

    results.applied.push({ version: migration.version, name: migration.name });
    log(`  ✓ applied migration ${migration.version} (${migration.name})`);
  }

  results.toVersion = getCurrentVersion(db);
  return results;
}

/** List applied migrations (version, name, applied_at) in order. */
function listAppliedMigrations(db) {
  ensureMigrationsTable(db);
  return db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC')
    .all();
}

module.exports = {
  MIGRATIONS,
  LATEST_VERSION: SCHEMA_VERSION,
  ensureMigrationsTable,
  getCurrentVersion,
  getAppliedVersions,
  runMigrations,
  listAppliedMigrations,
};
