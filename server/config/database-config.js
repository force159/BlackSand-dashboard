'use strict';
/**
 * BlackSand dashboard — SQLite database configuration (Phase 1).
 *
 * Single responsibility: work out WHERE the database file lives and make sure the
 * parent directory exists. It does NOT open the database, run SQL, or know anything
 * about the schema — that belongs to db/connection.js and db/migrations.js.
 *
 * Path rules (see README / CLAUDE §Phase 1):
 *   - configurable via the SQLITE_DB_PATH environment variable;
 *   - default is `data/dashboard.db`;
 *   - relative paths resolve from the PROJECT ROOT (not the terminal CWD), so the
 *     same DB is used whether you run `npm run db:migrate` from the root or elsewhere;
 *   - an absolute path is honoured as-is;
 *   - the parent directory is created if missing;
 *   - never place the DB under a publicly served directory (the Express host only
 *     routes `/`, `/health`, `/ready`, `/page-3.svg`, `/logos` — `data/` is not served).
 */

const path = require('path');
const fs = require('fs');

// server/config/ → project root is two levels up.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_DB_RELATIVE = path.join('data', 'dashboard.db');

/**
 * Resolve the final absolute database path from SQLITE_DB_PATH (or the default).
 * Relative values are anchored to the project root; absolute values pass through.
 */
function resolveDatabasePath() {
  const raw = (process.env.SQLITE_DB_PATH || '').trim();
  const target = raw || DEFAULT_DB_RELATIVE;
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(PROJECT_ROOT, target);
}

/**
 * Ensure the directory that will hold the database file exists.
 * Throws a clear, path-free-enough error if it cannot be created.
 */
function ensureParentDir(dbPath) {
  const dir = path.dirname(dbPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create database directory "${dir}": ${err.message}`);
  }
  return dir;
}

/**
 * Return safe database configuration: the resolved absolute path (with its parent
 * directory guaranteed to exist) plus the project root. No SQL, no side effects
 * beyond creating the directory.
 */
function getDatabaseConfig() {
  const dbPath = resolveDatabasePath();
  const dir = ensureParentDir(dbPath);
  return {
    dbPath,
    dbDir: dir,
    projectRoot: PROJECT_ROOT,
    // A non-sensitive, root-relative label for logs (avoids leaking user-specific
    // absolute Windows paths into logs where it isn't needed).
    displayPath: path.relative(PROJECT_ROOT, dbPath) || dbPath,
  };
}

module.exports = {
  PROJECT_ROOT,
  DEFAULT_DB_RELATIVE,
  resolveDatabasePath,
  ensureParentDir,
  getDatabaseConfig,
};
