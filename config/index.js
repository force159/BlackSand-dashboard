'use strict';
/**
 * Phase 9.4A — centralized production configuration.
 *
 * Responsibilities:
 *   1. Read configuration from the environment (after server/config/load-env has populated
 *      process.env from .env).
 *   2. Accept the Phase 9.4A spec's variable NAMES as aliases and BRIDGE them to the
 *      canonical names the existing code already uses, so nothing downstream changes:
 *        DATABASE_PATH      → SQLITE_DB_PATH
 *        SNAPSHOT_SCHEDULE  → HISTORY_SNAPSHOT_TIME
 *        TIMEZONE           → HISTORY_TIMEZONE
 *        MONDAY_API_TOKEN   → MONDAY_API_KEY   (already an accepted alias in monday/config)
 *      (Board IDs deliberately live in config/monday-mapping.json, NOT in an env var — see
 *      CLAUDE §28.2 — so MONDAY_BOARD_ID is informational only.)
 *   3. Apply an environment profile (production = strict, development = lenient).
 *   4. Validate and, on request, exit with a clear message if invalid.
 *
 * This is an ADDITIVE facade: it does not replace server/config/*, monday/config.js, or
 * automation-config.js — it validates the same variables and normalizes a read-only view
 * for the logger, /health, and startup validation. A secret VALUE is never stored on the
 * returned object or printed.
 */

const fs = require('fs');
const path = require('path');
const { resolveDatabasePath, PROJECT_ROOT } = require('../server/config/database-config');
const { validateConfig } = require('./validation');
const productionProfile = require('./production');
const developmentProfile = require('./development');

const MAPPING_FILE = path.resolve(PROJECT_ROOT, 'config', 'monday-mapping.json');

let PKG_VERSION = '0.0.0';
try { PKG_VERSION = require('../package.json').version || PKG_VERSION; } catch (_) {}

// Set a canonical env var from a spec alias ONLY when the canonical one is not already set,
// so an explicit canonical value always wins and re-running is idempotent.
function bridge(canonical, alias) {
  if (!(canonical in process.env) || process.env[canonical] === '') {
    if (alias in process.env && process.env[alias] !== '') process.env[canonical] = process.env[alias];
  }
}
function applyEnvAliases() {
  bridge('SQLITE_DB_PATH', 'DATABASE_PATH');
  bridge('HISTORY_SNAPSHOT_TIME', 'SNAPSHOT_SCHEDULE');
  bridge('HISTORY_TIMEZONE', 'TIMEZONE');
  // MONDAY_API_TOKEN → MONDAY_API_KEY is handled inside monday/config.js already.
}

const first = (...vals) => { for (const v of vals) { if (v != null && String(v).trim() !== '') return String(v).trim(); } return null; };

/**
 * Build the normalized, frozen config object. Has ONE intentional side effect: it bridges
 * the alias env vars to canonical names (so downstream modules read them). Never stores a
 * secret value.
 * @returns {object} frozen config
 */
function loadConfig() {
  applyEnvAliases();

  const nodeEnv = first(process.env.NODE_ENV) || 'development';
  const isProduction = nodeEnv === 'production';
  const profile = isProduction ? productionProfile : developmentProfile;
  const d = profile.defaults;

  const portRaw = first(process.env.PORT) || String(d.port);
  const port = Number(portRaw);

  const databasePathAbsolute = resolveDatabasePath();               // reuses the canonical resolver
  const databasePathDisplay = path.relative(PROJECT_ROOT, databasePathAbsolute) || databasePathAbsolute;

  const tokenPresent = !!first(process.env.MONDAY_API_KEY, process.env.MONDAY_API_TOKEN);
  let mappingFilePresent = false;
  try { mappingFilePresent = fs.existsSync(MAPPING_FILE); } catch (_) {}

  const cfg = {
    nodeEnv, isProduction, isDevelopment: !isProduction, profile: profile.name, strict: !!profile.strict,
    host: first(process.env.HOST) || d.host,
    port, portRaw,
    logLevel: (first(process.env.LOG_LEVEL) || d.logLevel).toLowerCase(),
    databasePathAbsolute, databasePathDisplay,
    snapshotSchedule: first(process.env.HISTORY_SNAPSHOT_TIME) || d.snapshotSchedule,
    timezone: first(process.env.HISTORY_TIMEZONE) || d.timezone,
    monday: {
      syncEnabled: first(process.env.MONDAY_SYNC_ENABLED) === 'true',
      dryRun: first(process.env.MONDAY_DRY_RUN) !== 'false',   // default true (safe)
      tokenPresent,                                             // boolean only — never the value
      boardIdConfigured: mappingFilePresent,                   // board IDs live in the mapping file
      mappingFilePresent,
    },
    version: PKG_VERSION,
  };
  return Object.freeze(cfg);
}

/**
 * A secret-free description safe for logs / the banner.
 */
function describe(cfg) {
  return `env=${cfg.nodeEnv} port=${cfg.port} log=${cfg.logLevel} db=${cfg.databasePathDisplay} ` +
    `snapshot=${cfg.snapshotSchedule} tz=${cfg.timezone} ` +
    `monday(sync=${cfg.monday.syncEnabled}, token=${cfg.monday.tokenPresent ? 'set' : 'unset'}, mapping=${cfg.monday.mappingFilePresent ? 'present' : 'absent'})`;
}

/**
 * Validate the config. In production, any problem is fatal (print a clear, secret-free
 * error and exit non-zero). In development, problems are warnings. Warnings are always
 * printed. Returns the result; `opts.exit`/`opts.logger` are injectable for tests.
 */
function validateConfigOrExit(cfg, opts) {
  opts = opts || {};
  const log = opts.logger || console;
  const exit = opts.exit || ((code) => process.exit(code));
  const { ok, errors, warnings } = validateConfig(cfg);

  warnings.forEach((w) => log.warn ? log.warn('[config] WARNING: ' + w) : console.warn('[config] WARNING: ' + w));

  if (!ok) {
    const banner = [
      '',
      '════════════════════════════════════════════════════════════════',
      '  FATAL: invalid production configuration — refusing to start',
      '════════════════════════════════════════════════════════════════',
      ...errors.map((e) => '  • ' + e),
      '',
      '  Fix the environment (.env) and restart. See DEPLOYMENT_CHECKLIST.md.',
      '════════════════════════════════════════════════════════════════',
      '',
    ].join('\n');
    (log.error ? log.error : console.error)(banner);
    exit(1);
    return { ok: false, errors, warnings };
  }
  return { ok: true, errors, warnings };
}

module.exports = { loadConfig, validateConfig, validateConfigOrExit, describe, applyEnvAliases, MAPPING_FILE };
