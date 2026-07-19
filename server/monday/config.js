'use strict';
/**
 * BlackSand dashboard — Monday integration configuration (Phase 6).
 *
 * Loads EVERY Monday setting from the environment (`.env`) and an optional mapping
 * file (board → column → canonical field). Nothing Monday-specific is hardcoded: no
 * token, no board IDs, no column IDs live in code. In Phase 6 sync is DISABLED by
 * default and no network call is made regardless of settings.
 *
 * `loadConfig()` is injectable (env + mapping) so tests run fully offline with no
 * real files or variables. The API key is never placed on the returned public object
 * (retrieve via getApiKey()); `hasApiKey` exposes only its presence.
 */

const fs = require('fs');
const path = require('path');
const { ConfigurationError } = require('./errors');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MAPPING_FILE = path.join('config', 'monday-mapping.json');

function toBool(v, def) {
  if (v == null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}
function toInt(v, def, { min = 0 } = {}) {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new ConfigurationError(`invalid numeric config value "${v}"`, { min });
  return Math.floor(n);
}

// Load + shallow-validate the mapping file. Returns null when absent (not configured).
function loadMapping(mappingPath) {
  const abs = path.isAbsolute(mappingPath) ? mappingPath : path.resolve(PROJECT_ROOT, mappingPath);
  if (!fs.existsSync(abs)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { throw new ConfigurationError(`mapping file is not valid JSON: ${e.message}`, { file: path.relative(PROJECT_ROOT, abs) }); }
  return raw;
}

/**
 * @param {object} [opts]
 * @param {object} [opts.env]           environment source (default process.env)
 * @param {object} [opts.mappingObject] inline mapping (bypasses file; for tests)
 * @param {string} [opts.mappingPath]   override mapping file path
 */
function loadConfig(opts = {}) {
  const env = opts.env || process.env;
  const mappingPath = opts.mappingPath || env.MONDAY_MAPPING_FILE || DEFAULT_MAPPING_FILE;
  const mapping = opts.mappingObject !== undefined ? opts.mappingObject : loadMapping(mappingPath);

  // Canonical token variable is MONDAY_API_KEY. MONDAY_API_TOKEN is supported as a
  // deprecated fallback (a one-time, VALUE-FREE warning is emitted when it is used).
  let apiKey = (env.MONDAY_API_KEY || '').trim();
  let usedDeprecatedTokenVar = false;
  if (!apiKey && (env.MONDAY_API_TOKEN || '').trim()) {
    apiKey = env.MONDAY_API_TOKEN.trim();
    usedDeprecatedTokenVar = true;
    if (!loadConfig._warnedTokenVar) {
      loadConfig._warnedTokenVar = true;
      // Never print the value — only the variable name guidance.
      // eslint-disable-next-line no-console
      console.warn('[monday] MONDAY_API_TOKEN is deprecated; rename it to MONDAY_API_KEY in your .env (the value is unchanged).');
    }
  }

  const config = {
    environment: (env.MONDAY_ENV || env.NODE_ENV || 'development').trim(),
    apiUrl: (env.MONDAY_API_URL || 'https://api.monday.com/v2').trim(),
    apiVersion: (env.MONDAY_API_VERSION || '2024-10').trim(),
    // Behaviour flags — sync is OFF by default in Phase 6.
    syncEnabled: toBool(env.MONDAY_SYNC_ENABLED, false),
    dryRun: toBool(env.MONDAY_DRY_RUN, true),
    // Timing / resilience.
    pollIntervalMs: toInt(env.MONDAY_POLL_INTERVAL_MS, 60 * 60 * 1000, { min: 1000 }),   // hourly default
    requestTimeoutMs: toInt(env.MONDAY_REQUEST_TIMEOUT_MS, 30 * 1000, { min: 1000 }),
    retryCount: toInt(env.MONDAY_RETRY_COUNT, 3, { min: 0 }),
    retryBaseMs: toInt(env.MONDAY_RETRY_BASE_MS, 500, { min: 1 }),
    rateLimitPerMin: toInt(env.MONDAY_RATE_LIMIT_PER_MIN, 60, { min: 1 }),
    maxPages: toInt(env.MONDAY_MAX_PAGES, 50, { min: 1 }),
    batchSize: toInt(env.MONDAY_BATCH_SIZE, 100, { min: 1 }),
    // Optional workspace scoping (informational; mapping is keyed by board).
    workspaceId: (env.MONDAY_WORKSPACE_ID || '').trim() || null,
    logLevel: (env.MONDAY_LOG_LEVEL || 'info').trim(),
    // Global last-known-good safety defaults (per-board `safety` in the mapping overrides).
    safety: {
      allowEmpty: toBool(env.MONDAY_ALLOW_EMPTY_BOARD, false),
      maxRecordDropPercent: toInt(env.MONDAY_MAX_RECORD_DROP_PERCENT, 50, { min: 0 }),
      minAcceptedRecords: toInt(env.MONDAY_MIN_ACCEPTED_RECORDS, 0, { min: 0 }),
    },
    mappingFile: mappingPath,
    mapping,
    hasApiKey: apiKey.length > 0,
    usedDeprecatedTokenVar,
    boardCount: mapping && mapping.boards ? Object.keys(mapping.boards).length : 0,
  };

  // Retrieve the secret only via this method; it is intentionally NOT on the object,
  // so logging/serialising the config can never leak it.
  Object.defineProperty(config, 'getApiKey', { value: () => apiKey, enumerable: false });

  return Object.freeze(config);
}

/** True only when a token AND at least one mapped board are present. */
function isConfigured(config) {
  return Boolean(config.hasApiKey && config.mapping && config.mapping.boards && config.boardCount > 0);
}

/** Would a live sync actually run? (Phase 6: always effectively no — see sync-engine.) */
function isSyncOperational(config) {
  return Boolean(isConfigured(config) && config.syncEnabled);
}

/** Structured, SECRET-FREE snapshot for health/logs (never includes the token). */
function describeConfig(config) {
  return {
    environment: config.environment,
    apiUrl: config.apiUrl,
    apiVersion: config.apiVersion,
    syncEnabled: config.syncEnabled,
    dryRun: config.dryRun,
    pollIntervalMs: config.pollIntervalMs,
    requestTimeoutMs: config.requestTimeoutMs,
    retryCount: config.retryCount,
    rateLimitPerMin: config.rateLimitPerMin,
    maxPages: config.maxPages,
    batchSize: config.batchSize,
    logLevel: config.logLevel,
    hasApiKey: config.hasApiKey,        // boolean only
    boardCount: config.boardCount,      // count only, never the IDs
    configured: isConfigured(config),
  };
}

module.exports = { loadConfig, isConfigured, isSyncOperational, describeConfig, DEFAULT_MAPPING_FILE, PROJECT_ROOT };
