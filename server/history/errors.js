'use strict';
/**
 * Phase 9.1B CP4 — historical error classification. Retries must fire ONLY for explicitly
 * transient failures (never validation/duplicate/stale/programmer errors). Classification
 * is by explicit code where possible (better-sqlite3 sets e.code), not message guessing.
 */

// SQLite transient conditions that a bounded retry can legitimately clear.
const RETRYABLE_SQLITE_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_PROTOCOL']);

// Never-retry decision/error codes (deterministic / permanent for this attempt).
const NON_RETRYABLE_CODES = new Set([
  'SNAPSHOT_VALIDATION_FAILED', 'SNAPSHOT_DUPLICATE', 'PROJECT_NOT_FOUND', 'INVALID_CLI_ARGUMENT',
  'SOURCE_INELIGIBLE', 'SOURCE_STALE', 'SOURCE_SYNC_MISSING', 'SOURCE_NOT_AUTHORITATIVE',
  'SOURCE_DATE_MISMATCH', 'SOURCE_STRUCTURE_INVALID', 'MIGRATION_FAILED',
  'LOCK_OWNERSHIP_LOST', // ownership lost mid-run — retrying under a stale lease is unsafe
]);

// True only for a clearly-transient error object.
function isTransientError(err) {
  if (!err) return false;
  if (err.code && RETRYABLE_SQLITE_CODES.has(err.code)) return true;
  // Programmer errors are never transient.
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof SyntaxError) return false;
  return false; // default: NOT transient (fail closed — safer than over-retrying)
}

/**
 * Decide whether a project-level failure result should be retried. Accepts either an Error
 * or a structured project result ({ errorCode, error }). Fails closed: unknown → not retryable.
 */
function isRetryableHistoricalError(errorOrResult) {
  if (!errorOrResult) return false;
  if (errorOrResult instanceof Error) return isTransientError(errorOrResult);
  const code = errorOrResult.errorCode || errorOrResult.code;
  if (code && NON_RETRYABLE_CODES.has(code)) return false;
  if (code && RETRYABLE_SQLITE_CODES.has(code)) return true; // transient SQLite condition
  // A persistence failure is retryable ONLY if its underlying cause was transient SQLite.
  if (code === 'SNAPSHOT_PERSISTENCE_FAILED') {
    const msg = String(errorOrResult.errorMessage || errorOrResult.message || '');
    return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy/i.test(msg);
  }
  return false;
}

module.exports = { isRetryableHistoricalError, isTransientError, RETRYABLE_SQLITE_CODES, NON_RETRYABLE_CODES };
