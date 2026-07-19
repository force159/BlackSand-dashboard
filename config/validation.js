'use strict';
/**
 * Phase 9.4A — production configuration VALIDATION (pure; no I/O side effects beyond a
 * writable-directory probe). Validates the normalized config object produced by
 * config/index.js and returns structured { ok, errors, warnings }. It never throws for a
 * bad value (the caller decides whether to exit) and never logs or exposes a secret VALUE
 * — only booleans / names.
 *
 * Reconciliation note: this validates the REAL variables the app uses (SQLITE_DB_PATH,
 * MONDAY_API_KEY, HISTORY_SNAPSHOT_TIME, HISTORY_TIMEZONE, …). config/index.js accepts the
 * spec's alias names (DATABASE_PATH, SNAPSHOT_SCHEDULE, TIMEZONE, MONDAY_API_TOKEN) and
 * bridges them to the canonical names before validation, so both work.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;          // HH:MM 24h
const REQUIRED_TIMEZONE = 'Asia/Riyadh';                // the app's hard automation constraint

function isValidPort(p) { return Number.isInteger(p) && p >= 1 && p <= 65535; }

// Probe that the database's parent directory exists (or can be created) and is writable.
// Returns { ok, detail } — never throws.
function probeDatabaseDir(absDbPath) {
  try {
    const dir = path.dirname(absDbPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true, detail: null };
  } catch (e) {
    return { ok: false, detail: e.code || e.message };
  }
}

/**
 * @param {object} cfg normalized config from config/index.js loadConfig()
 * @returns {{ ok:boolean, errors:string[], warnings:string[] }}
 */
function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  const strict = !!cfg.isProduction; // production → problems are fatal; development → warnings

  const problem = (msg) => (strict ? errors : warnings).push(msg);

  // NODE_ENV
  if (!cfg.nodeEnv) warnings.push('NODE_ENV is not set (defaulting to "development").');
  else if (!['production', 'development', 'test'].includes(cfg.nodeEnv)) warnings.push(`NODE_ENV="${cfg.nodeEnv}" is unusual (expected production | development | test).`);

  // PORT (always fatal if malformed — the server cannot bind otherwise)
  if (!isValidPort(cfg.port)) errors.push(`PORT must be an integer 1–65535 (got "${cfg.portRaw}").`);

  // LOG_LEVEL (always fatal if malformed — cheap to get right)
  if (!LOG_LEVELS.includes(cfg.logLevel)) errors.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')} (got "${cfg.logLevel}").`);

  // Snapshot schedule (HH:MM)
  if (!TIME_RE.test(cfg.snapshotSchedule)) errors.push(`SNAPSHOT_SCHEDULE / HISTORY_SNAPSHOT_TIME must be HH:MM 24h (got "${cfg.snapshotSchedule}").`);

  // Timezone — the historical scheduler is hard-locked to Asia/Riyadh; anything else would
  // make automation config throw at startup, so surface it here with a clear message.
  if (cfg.timezone !== REQUIRED_TIMEZONE) errors.push(`TIMEZONE / HISTORY_TIMEZONE must be "${REQUIRED_TIMEZONE}" (got "${cfg.timezone}"). The daily snapshot scheduler is locked to Riyadh.`);

  // Database directory writable (fatal in prod, warning in dev)
  const dir = probeDatabaseDir(cfg.databasePathAbsolute);
  if (!dir.ok) problem(`Database directory for "${cfg.databasePathDisplay}" is not writable (${dir.detail}).`);

  // Monday — the server NEVER auto-syncs (sync is CLI-gated), so sync being disabled is
  // fine even in production. Only when sync is explicitly enabled do the credentials matter.
  if (cfg.monday.syncEnabled) {
    if (!cfg.monday.tokenPresent) problem('MONDAY_SYNC_ENABLED=true but no API token is set (MONDAY_API_KEY / MONDAY_API_TOKEN).');
    if (!cfg.monday.mappingFilePresent) problem('MONDAY_SYNC_ENABLED=true but the board mapping file (config/monday-mapping.json) is missing.');
  } else {
    warnings.push('Monday sync is disabled — the dashboard serves the last committed SQLite data (expected for a read-only kiosk host).');
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateConfig, probeDatabaseDir, LOG_LEVELS, REQUIRED_TIMEZONE, isValidPort };
