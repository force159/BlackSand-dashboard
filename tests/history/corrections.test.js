'use strict';
/** Phase 9.1B correction pass — freshness (CP2), retry classification (CP4), audit
 * timestamps (CP5), API mappers (CP8), lock renewal (CP3). Temp DB + offline fixtures. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-hist-corr-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const M = require('../../server/monday');
const { evaluateSourceEligibility } = require('../../server/history/eligibility');
const { isRetryableHistoricalError } = require('../../server/history/errors');
const lock = require('../../server/history/automation/execution-lock');
const mappers = require('../../server/history/response-mappers');
const { captureHistoricalSnapshots } = require('../../server/history/capture-orchestrator');

let db;
const logger = M.createLogger({ level: 'error' });
const NOW = '2026-07-19T09:00:00Z';
const project = { retail: { tenants: [] }, office: { tenants: [] }, metrics: {} };

before(async () => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {}
  resetForReinit(); db = initializeDatabase(); runMigrations(db); seedDatabase(db, { now: '2026-07-15T00:00:00Z' });
  const item = (u, g, a, s) => ({ id: 'it-' + u, name: u, group: { id: g, title: g }, column_values: [{ id: 'cn', text: s === 'Leased' ? 'T' + u : '' }, { id: 'ca', type: 'numbers', text: String(a) }, { id: 'cs', type: 'status', text: s }] });
  const b = (slug, name) => ({ projectSlug: slug, projectName: name, address: 'A', itemGrain: 'lease', buildingSource: 'manual', categorySource: 'group', groupMap: { Retail: 'retail', Offices: 'office' }, categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1000 }, { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 2000 }], statusMap: { Leased: 'active', Vacant: 'terminated' }, columns: { tenantName: { id: 'cn', type: 'text' }, area: { id: 'ca', type: 'numbers' }, status: { id: 'cs', type: 'status' } }, safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 90 } });
  await M.syncEngine.runSync({ db, config: M.config.loadConfig({ env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: { version: 1, boards: { BA: b('business-address', 'Business Address'), TC: b('town-center', 'Town Center') } } }), logger, rawByBoard: {
    BA: { id: 'BA', name: 'BA', complete: true, items: [item('R01', 'Retail', 100, 'Leased')] }, TC: { id: 'TC', name: 'TC', complete: true, items: [item('(A-GF-01)', 'Retail', 300, 'Leased')] },
  } });
});
after(() => { try { closeDatabase(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {} });

// ── CP2 freshness ──
test('CP2: scheduled with STALE sync → SOURCE_STALE; fresh → SOURCE_FRESH', () => {
  const meta = { source: 'sqlite', dataVersion: 'v', lastSuccessfulSync: '2026-07-01T00:00:00Z' }; // ~18d old
  const stale = evaluateSourceEligibility({ project, meta, currentDataSource: 'monday', trigger: 'scheduled_daily', nowUtc: NOW, maxSourceAgeMinutes: 1500 });
  assert.strictEqual(stale.eligible, false); assert.strictEqual(stale.decisionCode, 'SOURCE_STALE');
  const fresh = evaluateSourceEligibility({ project, meta: { ...meta, lastSuccessfulSync: '2026-07-19T02:00:00Z' }, currentDataSource: 'monday', trigger: 'scheduled_daily', nowUtc: NOW, maxSourceAgeMinutes: 1500 });
  assert.strictEqual(fresh.eligible, true); assert.strictEqual(fresh.decisionCode, 'SOURCE_FRESH');
});
test('CP2: age boundary (exactly at / just over the limit)', () => {
  const base = { source: 'sqlite', dataVersion: 'v' };
  const at = evaluateSourceEligibility({ project, meta: { ...base, lastSuccessfulSync: '2026-07-19T08:00:00Z' }, currentDataSource: 'monday', trigger: 'scheduled_daily', nowUtc: NOW, maxSourceAgeMinutes: 60 }); // exactly 60 min
  assert.strictEqual(at.eligible, true);
  const over = evaluateSourceEligibility({ project, meta: { ...base, lastSuccessfulSync: '2026-07-19T07:59:00Z' }, currentDataSource: 'monday', trigger: 'scheduled_daily', nowUtc: NOW, maxSourceAgeMinutes: 60 }); // 61 min
  assert.strictEqual(over.eligible, false); assert.strictEqual(over.decisionCode, 'SOURCE_STALE');
});
test('CP2: post_sync is fresh regardless of age; manual is lenient (warns)', () => {
  const meta = { source: 'sqlite', dataVersion: 'v', lastSuccessfulSync: '2026-01-01T00:00:00Z' };
  assert.strictEqual(evaluateSourceEligibility({ project, meta, currentDataSource: 'monday', trigger: 'post_sync', nowUtc: NOW }).eligible, true);
  const man = evaluateSourceEligibility({ project, meta, currentDataSource: 'monday', trigger: 'manual_cli', nowUtc: NOW, maxSourceAgeMinutes: 1500 });
  assert.strictEqual(man.eligible, true); assert.ok(man.warnings.some((w) => /stale/i.test(w)));
});
test('CP2: seed source still ineligible regardless of trigger', () => {
  assert.strictEqual(evaluateSourceEligibility({ project, meta: { dataVersion: 'v' }, currentDataSource: 'seed', trigger: 'post_sync', nowUtc: NOW }).eligible, false);
});

// ── CP4 retry classification ──
test('CP4: transient SQLite errors retryable; permanent codes not', () => {
  assert.strictEqual(isRetryableHistoricalError({ code: 'SQLITE_BUSY' }), true);
  assert.strictEqual(isRetryableHistoricalError(Object.assign(new Error('x'), { code: 'SQLITE_LOCKED' })), true);
  assert.strictEqual(isRetryableHistoricalError({ errorCode: 'SNAPSHOT_VALIDATION_FAILED' }), false);
  assert.strictEqual(isRetryableHistoricalError({ errorCode: 'SNAPSHOT_DUPLICATE' }), false);
  assert.strictEqual(isRetryableHistoricalError({ errorCode: 'SOURCE_STALE' }), false);
  assert.strictEqual(isRetryableHistoricalError(new TypeError('bug')), false);
  assert.strictEqual(isRetryableHistoricalError({ errorCode: 'SNAPSHOT_PERSISTENCE_FAILED', errorMessage: 'database is locked' }), true);
  assert.strictEqual(isRetryableHistoricalError({ errorCode: 'SNAPSHOT_PERSISTENCE_FAILED', errorMessage: 'bad column' }), false);
});

// ── CP5 audit timestamps ──
test('CP5: run completed_at is real wall-clock (not the business capture instant) + duration >= 0', () => {
  const past = new Date('2026-07-19T09:00:00Z'); // fixed business capture instant (past)
  const summary = captureHistoricalSnapshots({ db, mode: 'write', capturedAt: past, triggerType: 'test', logger });
  assert.strictEqual(summary.capturedAtUtc, '2026-07-19T09:00:00.000Z');
  assert.notStrictEqual(summary.completedAtUtc, summary.capturedAtUtc, 'completion != business capture instant');
  assert.ok(Math.abs(Date.now() - Date.parse(summary.completedAtUtc)) < 60000, 'completion is the real wall clock');
  assert.ok(summary.durationMs >= 0);
  const run = db.prepare("SELECT started_at_utc, completed_at_utc FROM historical_snapshot_runs WHERE run_id=?").get(summary.runId);
  assert.ok(Date.parse(run.completed_at_utc) >= Date.parse(run.started_at_utc));
});

// ── CP3 lock renewal ──
test('CP3: owner renews + extends expiry; non-owner cannot renew', () => {
  lock._resetInProcess();
  lock.acquireDbLock(db, { ownerId: 'A', ttlSeconds: 60, nowUtc: '2026-07-19T09:00:00.000Z' });
  const before = lock.currentLock(db).expires_at_utc;
  assert.strictEqual(lock.renewDbLock(db, lock.LOCK_NAME, 'B', 60, '2026-07-19T09:00:30.000Z'), false); // non-owner
  assert.strictEqual(lock.renewDbLock(db, lock.LOCK_NAME, 'A', 300, '2026-07-19T09:00:30.000Z'), true);  // owner
  const after = lock.currentLock(db).expires_at_utc;
  assert.ok(Date.parse(after) > Date.parse(before), 'expiry extended');
  lock.releaseDbLock(db, lock.LOCK_NAME, 'A');
});

// ── CP1 post-sync capture ──
test('CP1: post-sync capture runs through the coordinator; disabled → POST_SYNC_DISABLED', async () => {
  lock._resetInProcess();
  const { capturePostSync } = require('../../server/history/automation/post-sync');
  const { loadAutomationConfig } = require('../../server/history/automation/automation-config');
  const off = await capturePostSync({ db, config: loadAutomationConfig({ HISTORY_POST_SYNC_CAPTURE_ENABLED: 'false' }), logger, syncRunId: 'sv1' });
  assert.strictEqual(off.status, 'skipped'); assert.strictEqual(off.decisionCode, 'POST_SYNC_DISABLED');
  const on = await capturePostSync({ db, config: loadAutomationConfig(), logger, syncRunId: 'sv1' });
  assert.ok(['completed', 'failed'].includes(on.status)); // post_sync trigger → fresh (not skipped by staleness)
  assert.strictEqual(on.trigger, 'post_sync');
});

// ── CP8 mappers ──
test('CP8: mappers produce camelCase, parsed JSON, booleans; no raw *_json', () => {
  const b = mappers.mapBuilding({ building_key: '1', building_name: 'Building 1', building_order: 1, project_key: 'tc', total_area: 100.5, occupancy_percent: 90, retail_total_area: 100.5 });
  assert.strictEqual(b.buildingKey, '1'); assert.strictEqual(b.projectKey, 'tc'); assert.strictEqual(typeof b.totalArea, 'number');
  assert.ok(b.retail && !('building_key' in b) && !('warnings_json' in b));
  const t = mappers.mapTenant({ tenant_key: 'acme', is_top_3: 1, is_top_10: 0, categories_json: '{"retail":100}', building_keys_json: '["1","2"]', metadata_json: '{"identityMethod":"normalized-name"}' });
  assert.strictEqual(t.isTop3, true); assert.strictEqual(t.isTop10, false);
  assert.deepStrictEqual(t.categories, { retail: 100 }); assert.deepStrictEqual(t.buildingKeys, ['1', '2']);
  assert.strictEqual(t.identityMethod, 'normalized-name');
  // malformed JSON → null + integrity warning (never throws, never leaks raw string)
  const bad = mappers.mapTenant({ tenant_key: 'x', categories_json: '{not json' });
  assert.deepStrictEqual(bad.categories, {}); assert.ok(bad.dataIntegrityWarnings && bad.dataIntegrityWarnings.length);
});
