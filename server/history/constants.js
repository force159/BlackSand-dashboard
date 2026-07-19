'use strict';
/**
 * Phase 9.1A — historical snapshot constants + controlled enums.
 *
 * Centralizes version stamps, controlled status/enum values, supported project keys,
 * and numeric policy so nothing is scattered as raw strings/magic numbers. No I/O.
 */

// Version stamps stored on every snapshot for provenance (§22).
const HISTORY_SCHEMA_VERSION = 1;                 // historical snapshot table/format version
const HISTORY_CALCULATION_VERSION = 'historical-calculations-v1'; // metric-definition version
const HISTORY_METADATA_VERSION = 1;

const TIMEZONE = 'Asia/Riyadh';

// Projects eligible for historical capture (stable internal keys, never display labels).
const SUPPORTED_PROJECT_KEYS = ['town-center', 'business-address'];

// Controlled enums (avoid arbitrary strings in the audit table).
const TRIGGER_TYPES = {
  MANUAL: 'manual', MANUAL_CLI: 'manual_cli', TEST: 'test', SCHEDULER: 'scheduler',
  SCHEDULED_DAILY: 'scheduled_daily', STARTUP_RECOVERY: 'startup_recovery', POST_SYNC: 'post_sync', RETRY: 'retry',
};
const LOCK_NAME = 'historical_snapshot_execution';
const MODES = { WRITE: 'write', DRY_RUN: 'dry-run' };
const RUN_STATUS = {
  STARTED: 'started',
  COMPLETED: 'completed',
  COMPLETED_WITH_SKIPS: 'completed_with_skips',
  VALIDATION_FAILED: 'validation_failed',
  SOURCE_INELIGIBLE: 'source_ineligible',
  DUPLICATE_SKIPPED: 'duplicate_skipped',
  FAILED: 'failed',
};
// Per-project outcome within a run.
const PROJECT_STATUS = {
  CREATED: 'created',
  DUPLICATE_SKIPPED: 'duplicate_skipped',
  VALIDATION_FAILED: 'validation_failed',
  SOURCE_INELIGIBLE: 'source_ineligible',
  NOT_FOUND: 'project_not_found',
  FAILED: 'failed',
  DRY_RUN: 'dry_run',
};
const ERROR_CODES = {
  SOURCE_INELIGIBLE: 'SOURCE_INELIGIBLE',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  SNAPSHOT_VALIDATION_FAILED: 'SNAPSHOT_VALIDATION_FAILED',
  SNAPSHOT_DUPLICATE: 'SNAPSHOT_DUPLICATE',
  SNAPSHOT_PERSISTENCE_FAILED: 'SNAPSHOT_PERSISTENCE_FAILED',
  LOCK_OWNERSHIP_LOST: 'LOCK_OWNERSHIP_LOST',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  DATABASE_BUSY: 'DATABASE_BUSY',
  INVALID_CLI_ARGUMENT: 'INVALID_CLI_ARGUMENT',
};

// Numeric policy (§6). Percentages are stored 0–100 (matches the live `metrics.*Pct`).
// Areas are stored to 2 dp; percentages to 2 dp; counts are integers. The area-balance
// tolerance guards against benign rounding noise (leased + vacant ≈ total).
const AREA_DECIMALS = 2;
const PERCENT_DECIMALS = 2;
const AREA_BALANCE_TOLERANCE = 0.5;   // m² — leased + vacant vs total
const VELOCITY_WINDOW_DAYS = 90;      // matches the live dashboard's leasing-velocity window

function round(n, dp) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
const roundArea = (n) => round(n, AREA_DECIMALS);
const roundPercent = (n) => round(n, PERCENT_DECIMALS);

module.exports = {
  HISTORY_SCHEMA_VERSION, HISTORY_CALCULATION_VERSION, HISTORY_METADATA_VERSION,
  TIMEZONE, SUPPORTED_PROJECT_KEYS,
  TRIGGER_TYPES, LOCK_NAME, MODES, RUN_STATUS, PROJECT_STATUS, ERROR_CODES,
  AREA_DECIMALS, PERCENT_DECIMALS, AREA_BALANCE_TOLERANCE, VELOCITY_WINDOW_DAYS,
  round, roundArea, roundPercent,
};
