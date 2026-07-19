'use strict';
/**
 * Phase 9.1B — validated historical-automation configuration.
 *
 * Read from env (via the already-loaded .env), validated at load. Nothing secret is read
 * or logged here. Tests override by passing an explicit `env` object. Invalid values throw
 * a clear error so misconfiguration fails fast at startup (never silently mis-schedules).
 */

const { parseHHmm } = require('../riyadh-date');

const bool = (v, def) => (v == null || v === '') ? def : /^(1|true|yes|on)$/i.test(String(v));
const intIn = (v, def, min, max, name) => {
  if (v == null || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid ${name}: ${v} (expected integer ${min}..${max})`);
  return n;
};

function loadAutomationConfig(env) {
  const e = env || process.env;
  const time = (e.HISTORY_SNAPSHOT_TIME || '02:00').trim();
  if (!parseHHmm(time)) throw new Error(`invalid HISTORY_SNAPSHOT_TIME "${time}" (expected HH:mm 24h)`);
  const tz = (e.HISTORY_TIMEZONE || 'Asia/Riyadh').trim();
  if (tz !== 'Asia/Riyadh') throw new Error(`HISTORY_TIMEZONE must be Asia/Riyadh (got "${tz}")`);

  const apiDefaultLimit = intIn(e.HISTORY_API_DEFAULT_LIMIT, 50, 1, 1000, 'HISTORY_API_DEFAULT_LIMIT');
  const apiMaxLimit = intIn(e.HISTORY_API_MAX_LIMIT, 200, 1, 5000, 'HISTORY_API_MAX_LIMIT');
  if (apiMaxLimit < apiDefaultLimit) throw new Error('HISTORY_API_MAX_LIMIT must be >= HISTORY_API_DEFAULT_LIMIT');

  return {
    enabled: bool(e.HISTORY_AUTOMATION_ENABLED, true),
    snapshotTime: time,
    timezone: tz,
    startupRecoveryEnabled: bool(e.HISTORY_STARTUP_RECOVERY_ENABLED, true),
    recoveryLookbackDays: intIn(e.HISTORY_RECOVERY_LOOKBACK_DAYS, 1, 0, 7, 'HISTORY_RECOVERY_LOOKBACK_DAYS'),
    postSyncCaptureEnabled: bool(e.HISTORY_POST_SYNC_CAPTURE_ENABLED, true),
    maxSourceAgeMinutes: intIn(e.HISTORY_MAX_SOURCE_AGE_MINUTES, 1500, 1, 100000, 'HISTORY_MAX_SOURCE_AGE_MINUTES'),
    retryAttempts: intIn(e.HISTORY_RETRY_ATTEMPTS, 1, 0, 2, 'HISTORY_RETRY_ATTEMPTS'),
    retryDelayMs: intIn(e.HISTORY_RETRY_DELAY_MS, 2000, 0, 60000, 'HISTORY_RETRY_DELAY_MS'),
    lockTimeoutSeconds: intIn(e.HISTORY_LOCK_TIMEOUT_SECONDS, 300, 10, 3600, 'HISTORY_LOCK_TIMEOUT_SECONDS'),
    apiDefaultLimit,
    apiMaxLimit,
    apiMaxDateRangeDays: intIn(e.HISTORY_API_MAX_DATE_RANGE_DAYS, 400, 1, 3660, 'HISTORY_API_MAX_DATE_RANGE_DAYS'),
  };
}

// Non-secret effective config for a startup log line.
function describeConfig(c) {
  return `automation=${c.enabled} time=${c.snapshotTime} ${c.timezone} recovery=${c.startupRecoveryEnabled}(${c.recoveryLookbackDays}d) postSync=${c.postSyncCaptureEnabled} retries=${c.retryAttempts}`;
}

module.exports = { loadAutomationConfig, describeConfig };
