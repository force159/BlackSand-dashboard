'use strict';
/**
 * BlackSand dashboard — SQLite connection lifecycle (Phase 1).
 *
 * Owns exactly ONE better-sqlite3 connection for the single backend Node process.
 * Opening the database is a CONTROLLED action (initializeDatabase()), never an
 * uncontrolled side effect of importing this module — so scripts and the server
 * decide when the file is touched.
 *
 * Lifecycle:
 *   initializeDatabase()  open once, apply pragmas, verify them, return the handle.
 *   getDatabase()         return the already-open handle (throws if not initialized).
 *   closeDatabase()       close cleanly; safe to call repeatedly; no silent reopen.
 *
 * Pragmas (why):
 *   foreign_keys = ON      enforce relational integrity between the tables.
 *   journal_mode = WAL     let dashboard reads proceed while a sync writes.
 *   synchronous = NORMAL   right durability/performance balance for a local,
 *                          re-syncable cache (a crash loses at most the last txn,
 *                          which a re-sync restores).
 *   busy_timeout = 5000    wait up to 5s on a brief lock instead of erroring at once.
 *
 * Single process only — do not run multiple Node processes against one DB file.
 */

const Database = require('better-sqlite3');
const { getDatabaseConfig } = require('../config/database-config');

// Module-level singleton state. `db` is the live handle; `closed` guards against
// silent reopen after an explicit shutdown within the same process.
let db = null;
let closed = false;

const PRAGMAS = [
  ['foreign_keys', 'ON'],
  ['journal_mode', 'WAL'],
  ['synchronous', 'NORMAL'],
  ['busy_timeout', '5000'],
];

/**
 * Apply the required pragmas, then read them back and confirm the ones that have a
 * deterministic reported value. Throws a clear error if a critical pragma did not
 * take (WAL / foreign_keys), so we never serve on a mis-configured database.
 */
function applyAndVerifyPragmas(handle) {
  for (const [key, value] of PRAGMAS) {
    handle.pragma(`${key} = ${value}`);
  }

  const foreignKeys = handle.pragma('foreign_keys', { simple: true });
  const journalMode = String(handle.pragma('journal_mode', { simple: true }) || '').toLowerCase();
  const busyTimeout = handle.pragma('busy_timeout', { simple: true });

  if (foreignKeys !== 1) {
    throw new Error(`Failed to enable foreign_keys (reported: ${foreignKeys})`);
  }
  if (journalMode !== 'wal') {
    throw new Error(`Failed to set WAL journal mode (reported: ${journalMode})`);
  }
  // synchronous reads back as an integer (NORMAL === 1); we set it but don't hard-fail
  // on it since it is a tuning pragma, not a correctness one.
  return {
    foreignKeys: foreignKeys === 1,
    journalMode,
    busyTimeout,
    synchronous: handle.pragma('synchronous', { simple: true }),
  };
}

/**
 * Open the database once and apply pragmas. Idempotent: a second call returns the
 * same handle. Throws with a clear message if the file cannot be opened/configured.
 */
function initializeDatabase() {
  if (db) return db;
  if (closed) {
    throw new Error('Database was closed in this process; refusing to silently reopen.');
  }

  const { dbPath, displayPath } = getDatabaseConfig();

  let handle;
  try {
    handle = new Database(dbPath); // creates the file if it does not exist
  } catch (err) {
    throw new Error(`Cannot open SQLite database at "${displayPath}": ${err.message}`);
  }

  try {
    applyAndVerifyPragmas(handle);
  } catch (err) {
    // Don't leave a half-configured handle open.
    try { handle.close(); } catch (_) { /* ignore */ }
    throw new Error(`SQLite pragma configuration failed: ${err.message}`);
  }

  db = handle;
  return db;
}

/**
 * Return the open handle. Throws if initializeDatabase() has not run — callers must
 * initialize explicitly (server startup / CLI scripts), never rely on lazy open.
 */
function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/** True once a connection is open (and not closed). */
function isInitialized() {
  return db !== null;
}

/**
 * Close cleanly. Safe to call multiple times and safe if never opened. Sets the
 * closed flag so an accidental re-init in the same process fails loudly rather than
 * silently opening a second connection.
 */
function closeDatabase() {
  if (db) {
    try {
      db.close();
    } catch (_) {
      // Already closed or closing — tolerate.
    }
    db = null;
  }
  closed = true;
}

/**
 * Test/CLI helper: fully reset the module singleton so a fresh process-like state
 * can be established within one Node process (used by scripts that open, work, and
 * then want a clean slate). Not used by the server.
 */
function resetForReinit() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
  }
  db = null;
  closed = false;
}

module.exports = {
  initializeDatabase,
  getDatabase,
  isInitialized,
  closeDatabase,
  resetForReinit,
  PRAGMAS,
};
