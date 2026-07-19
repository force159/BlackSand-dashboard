'use strict';
/**
 * Phase 9.4A — production configuration + validation. Offline, no server. Verifies alias
 * bridging (spec names → canonical), profile selection, and that validation is strict in
 * production (fatal) and lenient in development (warnings), with no secret exposure.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

const cfgMod = require('../../config');
const { validateConfig } = require('../../config/validation');

const ENV_KEYS = ['NODE_ENV', 'PORT', 'HOST', 'LOG_LEVEL', 'SQLITE_DB_PATH', 'DATABASE_PATH', 'HISTORY_SNAPSHOT_TIME', 'SNAPSHOT_SCHEDULE', 'HISTORY_TIMEZONE', 'TIMEZONE', 'MONDAY_SYNC_ENABLED', 'MONDAY_API_KEY', 'MONDAY_API_TOKEN', 'MONDAY_DRY_RUN'];
function withEnv(env, fn) {
  const saved = {}; ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
  try { Object.keys(env).forEach((k) => { process.env[k] = env[k]; }); return fn(); }
  finally { ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}
const tmpDb = () => path.join(os.tmpdir(), `bs-cfg-${process.pid}-${Math.floor(process.hrtime()[1])}`, 'dashboard.db');

test('defaults: development profile when NODE_ENV unset', () => {
  withEnv({ SQLITE_DB_PATH: tmpDb() }, () => {
    const c = cfgMod.loadConfig();
    assert.strictEqual(c.nodeEnv, 'development');
    assert.strictEqual(c.isProduction, false);
    assert.strictEqual(c.port, 3000);
    assert.strictEqual(c.logLevel, 'debug');       // dev default
    assert.strictEqual(c.timezone, 'Asia/Riyadh');
  });
});

test('alias bridging: DATABASE_PATH / SNAPSHOT_SCHEDULE / TIMEZONE → canonical env vars', () => {
  const dbp = tmpDb();
  withEnv({ NODE_ENV: 'production', DATABASE_PATH: dbp, SNAPSHOT_SCHEDULE: '03:30', TIMEZONE: 'Asia/Riyadh' }, () => {
    const c = cfgMod.loadConfig();
    assert.strictEqual(process.env.SQLITE_DB_PATH, dbp, 'DATABASE_PATH bridged to SQLITE_DB_PATH');
    assert.strictEqual(process.env.HISTORY_SNAPSHOT_TIME, '03:30');
    assert.strictEqual(process.env.HISTORY_TIMEZONE, 'Asia/Riyadh');
    assert.strictEqual(c.snapshotSchedule, '03:30');
    assert.ok(c.databasePathAbsolute.endsWith('dashboard.db'));
  });
});

test('canonical env wins over alias (explicit SQLITE_DB_PATH kept)', () => {
  const canon = tmpDb();
  withEnv({ SQLITE_DB_PATH: canon, DATABASE_PATH: '/should/not/win.db' }, () => {
    cfgMod.loadConfig();
    assert.strictEqual(process.env.SQLITE_DB_PATH, canon);
  });
});

test('production validation is FATAL for bad values', () => {
  withEnv({ NODE_ENV: 'production', PORT: '99999', LOG_LEVEL: 'chatty', SNAPSHOT_SCHEDULE: '25:99', TIMEZONE: 'UTC', SQLITE_DB_PATH: tmpDb() }, () => {
    const c = cfgMod.loadConfig();
    const r = validateConfig(c);
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /PORT/.test(e)));
    assert.ok(r.errors.some((e) => /LOG_LEVEL/.test(e)));
    assert.ok(r.errors.some((e) => /SNAPSHOT_SCHEDULE|HISTORY_SNAPSHOT_TIME/.test(e)));
    assert.ok(r.errors.some((e) => /Asia\/Riyadh/.test(e)));
  });
});

test('development validation is LENIENT (same issues become warnings, ok stays true for soft ones)', () => {
  withEnv({ NODE_ENV: 'development', MONDAY_SYNC_ENABLED: 'true', SQLITE_DB_PATH: tmpDb() }, () => {
    const c = cfgMod.loadConfig();
    const r = validateConfig(c);
    // sync enabled w/o token is a WARNING in dev, not fatal
    assert.strictEqual(r.ok, true);
    assert.ok(r.warnings.some((w) => /token/i.test(w)));
  });
});

test('production: sync enabled without token is FATAL', () => {
  withEnv({ NODE_ENV: 'production', MONDAY_SYNC_ENABLED: 'true', SQLITE_DB_PATH: tmpDb() }, () => {
    const r = validateConfig(cfgMod.loadConfig());
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /token/i.test(e)));
  });
});

test('validateConfigOrExit: exits(1) on invalid production, not on valid', () => {
  // invalid → exit called
  withEnv({ NODE_ENV: 'production', PORT: 'nope', SQLITE_DB_PATH: tmpDb() }, () => {
    let code = null; const logs = [];
    const log = { warn: (m) => logs.push(m), error: (m) => logs.push(m) };
    cfgMod.validateConfigOrExit(cfgMod.loadConfig(), { logger: log, exit: (c) => { code = c; } });
    assert.strictEqual(code, 1);
    assert.ok(logs.join('\n').includes('refusing to start'));
  });
  // valid → no exit
  withEnv({ NODE_ENV: 'production', SQLITE_DB_PATH: tmpDb() }, () => {
    let code = null;
    cfgMod.validateConfigOrExit(cfgMod.loadConfig(), { logger: { warn() {}, error() {} }, exit: (c) => { code = c; } });
    assert.strictEqual(code, null);
  });
});

test('describe() carries no secret value', () => {
  withEnv({ NODE_ENV: 'production', MONDAY_API_KEY: 'super-secret-token-value', SQLITE_DB_PATH: tmpDb() }, () => {
    const s = cfgMod.describe(cfgMod.loadConfig());
    assert.ok(!s.includes('super-secret-token-value'));
    assert.ok(/token=set/.test(s));
  });
});
