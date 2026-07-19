'use strict';
/**
 * BlackSand dashboard — schema validation & database health (Phase 1).
 *
 * Read-only inspection of an already-open connection. Two entry points:
 *   validateSchema(db)     detailed structural verdict (tables/columns/indexes/
 *                          pragmas/version) — used by CLI checks.
 *   getDatabaseHealth(db)  a compact status object safe for a /ready response
 *                          (NO absolute paths, NO stack traces, NO secrets).
 *
 * These functions NEVER write and NEVER apply migrations — they only observe.
 */

const {
  EXPECTED_TABLES,
  EXPECTED_COLUMNS,
  EXPECTED_INDEXES,
  BUSINESS_TABLES,
  SCHEMA_VERSION,
} = require('./schema');
const { getCurrentVersion } = require('./migrations');

/** Names of all tables present in the database. */
function listTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
}

/** Names of all indexes present (both explicit and implicit autoindexes). */
function listIndexes(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((r) => r.name);
}

/** Column names for a table via PRAGMA table_info (presence, not ordering). */
function columnsOf(db, table) {
  return db.pragma(`table_info(${table})`).map((c) => c.name);
}

/**
 * Full structural validation. Returns:
 *   { valid, schemaVersion, expectedVersion, foreignKeysEnabled, journalMode,
 *     readOk, missingTables, missingColumns, missingIndexes, errors }
 * Never throws for "schema wrong" — it reports; it only throws if the handle is
 * unusable (which callers catch).
 */
function validateSchema(db) {
  const result = {
    valid: false,
    schemaVersion: 0,
    expectedVersion: SCHEMA_VERSION,
    foreignKeysEnabled: false,
    journalMode: null,
    readOk: false,
    missingTables: [],
    missingColumns: {},
    missingIndexes: [],
    errors: [],
  };

  // Pragmas
  try {
    result.foreignKeysEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
    result.journalMode = String(db.pragma('journal_mode', { simple: true }) || '').toLowerCase();
  } catch (err) {
    result.errors.push(`pragma read failed: ${err.message}`);
  }

  // Schema version (from schema_migrations)
  try {
    result.schemaVersion = getCurrentVersion(db);
  } catch (err) {
    result.errors.push(`could not read schema version: ${err.message}`);
  }

  // Tables
  let tables = [];
  try {
    tables = listTables(db);
  } catch (err) {
    result.errors.push(`could not list tables: ${err.message}`);
  }
  const tableSet = new Set(tables);
  result.missingTables = EXPECTED_TABLES.filter((t) => !tableSet.has(t));

  // Columns (only for tables that exist)
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    if (!tableSet.has(table)) continue;
    let present = [];
    try {
      present = columnsOf(db, table);
    } catch (err) {
      result.errors.push(`could not read columns of ${table}: ${err.message}`);
      continue;
    }
    const presentSet = new Set(present);
    const missing = cols.filter((c) => !presentSet.has(c));
    if (missing.length) result.missingColumns[table] = missing;
  }

  // Indexes
  let indexes = [];
  try {
    indexes = listIndexes(db);
  } catch (err) {
    result.errors.push(`could not list indexes: ${err.message}`);
  }
  const indexSet = new Set(indexes);
  result.missingIndexes = EXPECTED_INDEXES.filter((i) => !indexSet.has(i));

  // Trivial read query
  try {
    db.prepare('SELECT 1 AS ok').get();
    result.readOk = true;
  } catch (err) {
    result.errors.push(`trivial read failed: ${err.message}`);
  }

  result.valid =
    result.errors.length === 0 &&
    result.foreignKeysEnabled === true &&
    result.journalMode === 'wal' &&
    result.readOk === true &&
    result.missingTables.length === 0 &&
    Object.keys(result.missingColumns).length === 0 &&
    result.missingIndexes.length === 0 &&
    result.schemaVersion === SCHEMA_VERSION;

  return result;
}

/**
 * Compact health object for internal use and /ready. Contains NO filesystem paths.
 */
function getDatabaseHealth(db) {
  try {
    const v = validateSchema(db);
    return {
      ok: v.valid,
      databaseOpen: true,
      schemaCurrent: v.schemaVersion === v.expectedVersion,
      foreignKeysEnabled: v.foreignKeysEnabled,
      journalMode: v.journalMode,
      migrationVersion: v.schemaVersion,
    };
  } catch (err) {
    return {
      ok: false,
      databaseOpen: false,
      schemaCurrent: false,
      foreignKeysEnabled: false,
      journalMode: null,
      migrationVersion: 0,
    };
  }
}

/** Row counts for the business tables (for CLI inspection — all 0 in Phase 1). */
function getRowCounts(db) {
  const counts = {};
  for (const table of BUSINESS_TABLES) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch (_) {
      counts[table] = null;
    }
  }
  return counts;
}

module.exports = {
  listTables,
  listIndexes,
  columnsOf,
  validateSchema,
  getDatabaseHealth,
  getRowCounts,
};
