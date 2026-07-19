'use strict';
/**
 * Phase 9.1B/9.2A/9.2B — focused CORRECTION PASS regression tests.
 * Covers, with deterministic synthetic snapshots + offline Monday fixtures (temp DBs):
 *   A  executive-summary date scoping — no future-data leakage (middle/first/latest date + insights endpoint)
 *   B  scheduler lifecycle now tracks startup recovery (delayed / exception / serialized)
 *   C  execution-lock owner-checked renewal + orchestrator fail-closed on lost ownership
 *   D  compareBuildings single-pass presence — a stored NULL value is 'present', not added/removed
 *   E  series availability (NO_POINTS / NO_VALUED_POINTS / single point) + zero-lease exposure percent null
 */
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../server/db/migrations');

const tick = () => new Promise((r) => setTimeout(r, 5));
const rm = (f) => { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {} };

// ── shared synthetic-snapshot inserters ──
let PSID = 0;
function insProj(db, pk, date, occ, leased) {
  return db.prepare(`INSERT INTO historical_project_snapshots
    (snapshot_id, run_id, project_key, business_date, timezone, captured_at_utc, source_type, schema_version, calculation_version, occupancy_percent, leased_area, created_at_utc)
    VALUES (?,?,?,?, 'Asia/Riyadh', ?, 'monday', 1, 'v1', ?, ?, ?)`)
    .run('snap_' + (++PSID), 'run_x', pk, date, date + 'T02:00:00Z', occ, leased, date + 'T02:00:00Z').lastInsertRowid;
}
function insBld(db, parentId, pk, date, key, order, occ) {
  db.prepare(`INSERT INTO historical_building_snapshots
    (project_snapshot_id, snapshot_id, project_key, business_date, building_key, building_name, building_order, occupancy_percent, created_at_utc)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(parentId, 'snap_p', pk, date, key, 'Building ' + key, order, occ, date + 'T02:00:00Z');
}

// ════════════════════════════════════════════════════════════════════════════
describe('Correction A — executive summary is date-scoped (no future leakage)', () => {
  let db; const f = path.join(os.tmpdir(), `bs-corrA-${process.pid}.db`);
  const D1 = '2026-07-10', D2 = '2026-07-15', D3 = '2026-07-20';
  const exec = require('../../server/history/analytics/executive-summary');
  before(() => {
    rm(f); db = new Database(f); db.pragma('foreign_keys = ON'); runMigrations(db);
    insProj(db, 'town-center', D1, 40, 400);
    insProj(db, 'town-center', D2, 50, 500);
    insProj(db, 'town-center', D3, 90, 900); // the "future" date that must never leak into a D2 summary
  });
  after(() => { try { db.close(); } catch (_) {} rm(f); });

  test('middle date D2: comparison/trend never reference the later D3', () => {
    const s = exec.buildExecutiveSummary(db, { projectKey: 'town-center', date: D2 });
    assert.strictEqual(s.summaryDate, D2);
    assert.strictEqual(s.latestDate, D2);
    assert.strictEqual(s.previousDate, D1);
    assert.strictEqual(s.snapshotDateCount, 2);         // D1, D2 (through D)
    assert.strictEqual(s.totalSnapshotDateCount, 3);    // D1, D2, D3
    // comparison = previous → D (D1 → D2), occupancy 40 → 50
    assert.strictEqual(s.comparison.from, D1);
    assert.strictEqual(s.comparison.to, D2);
    assert.strictEqual(s.comparison.change.absolute, 10);
    // trend spans earliest eligible → D and contains NO point later than D2
    assert.strictEqual(s.trend.to, D2);
    assert.deepStrictEqual(s.trend.points.map((p) => p.date), [D1, D2]);
    assert.ok(s.trend.points.every((p) => p.date <= D2), 'no trend point later than the summary date');
    assert.strictEqual(s.trend.summary.last.value, 50); // not 90 (D3)
    // no insight evidence later than D2
    for (const i of s.insights) {
      const ev = JSON.stringify(i.evidence || {});
      assert.ok(!ev.includes(D3), 'insight evidence must not reference a future date');
    }
  });

  test('first date D1: comparison + movement structurally unavailable (INSUFFICIENT_HISTORY)', () => {
    const s = exec.buildExecutiveSummary(db, { projectKey: 'town-center', date: D1 });
    assert.strictEqual(s.summaryDate, D1);
    assert.strictEqual(s.previousDate, null);
    assert.strictEqual(s.snapshotDateCount, 1);
    assert.strictEqual(s.totalSnapshotDateCount, 3);
    assert.strictEqual(s.comparison.available, false);
    assert.strictEqual(s.comparison.reason, 'INSUFFICIENT_HISTORY');
    assert.strictEqual(s.movement.available, false);
    assert.strictEqual(s.movement.reason, 'INSUFFICIENT_HISTORY');
  });

  test('latest date (no date arg): resolves to D3, previous = D2, counts full history', () => {
    const s = exec.buildExecutiveSummary(db, { projectKey: 'town-center' });
    assert.strictEqual(s.summaryDate, D3);
    assert.strictEqual(s.previousDate, D2);
    assert.strictEqual(s.snapshotDateCount, 3);
    assert.strictEqual(s.totalSnapshotDateCount, 3);
    assert.strictEqual(s.comparison.from, D2);
    assert.strictEqual(s.comparison.to, D3);
  });

  test('insights endpoint is scoped to the same requested date (D2, not the latest)', () => {
    const r = exec.buildInsights(db, { projectKey: 'town-center', date: D2 });
    assert.strictEqual(r.date, D2);
    assert.strictEqual(r.summaryDate, D2);
    for (const i of r.insights) assert.ok(!JSON.stringify(i.evidence || {}).includes(D3));
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Correction B — startup recovery is lifecycle-tracked', () => {
  let db; const f = path.join(os.tmpdir(), `bs-corrB-${process.pid}.db`);
  const { createSnapshotScheduler } = require('../../server/history/automation/snapshot-scheduler');
  const { loadAutomationConfig } = require('../../server/history/automation/automation-config');
  const logger = { info() {}, warn() {}, error() {} };
  // snapshotTime 00:00 → hasScheduledTimePassed is always true (deterministic; no clock injection).
  const cfg = () => loadAutomationConfig({ HISTORY_SNAPSHOT_TIME: '00:00', HISTORY_AUTOMATION_ENABLED: 'true', HISTORY_STARTUP_RECOVERY_ENABLED: 'true' });
  before(() => { rm(f); db = new Database(f); db.pragma('foreign_keys = ON'); runMigrations(db); });
  after(() => { try { db.close(); } catch (_) {} rm(f); });

  test('stopAndWait waits for an in-flight recovery, then reports idle', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    let started = false, finished = false;
    const runAttempt = async () => { started = true; await gate; finished = true; return { status: 'completed', summary: { created: 1, businessDate: '2026-07-19' } }; };
    const s = createSnapshotScheduler({ getDb: () => db, config: cfg(), logger, runAttempt });
    const recoveryPromise = s.runStartupRecovery();
    await tick();
    assert.strictEqual(started, true, 'recovery attempt started');
    assert.strictEqual(s.getStatus().recoveryState, 'running');
    assert.strictEqual(s.getStatus().executionState, 'running');
    const stopPromise = s.stopAndWait(2000);
    assert.strictEqual(finished, false, 'recovery still in flight while stopAndWait is pending');
    release();
    const stopRes = await stopPromise;
    await recoveryPromise;
    assert.strictEqual(finished, true);
    assert.strictEqual(stopRes.idle, true, 'stopAndWait waited for recovery');
    assert.strictEqual(s.getStatus().recoveryState, 'idle');
    assert.strictEqual(s.getStatus().executionState, 'idle');
  });

  test('a hanging recovery makes stopAndWait time out (bounded, no corruption)', async () => {
    const runAttempt = () => new Promise(() => {}); // never resolves
    const s = createSnapshotScheduler({ getDb: () => db, config: cfg(), logger, runAttempt });
    s.runStartupRecovery();
    await tick();
    const stopRes = await s.stopAndWait(40);
    assert.strictEqual(stopRes.idle, false);
    assert.strictEqual(stopRes.timedOut, true);
  });

  test('a recovery exception is caught; state resets to idle in finally', async () => {
    const runAttempt = async () => { throw new Error('boom'); };
    const s = createSnapshotScheduler({ getDb: () => db, config: cfg(), logger, runAttempt });
    const res = await s.runStartupRecovery();
    assert.strictEqual(res.status, 'failed');
    assert.strictEqual(s.getStatus().recoveryState, 'idle');
    assert.strictEqual(s.getStatus().executionState, 'idle');
    const stopRes = await s.stopAndWait(1000);
    assert.strictEqual(stopRes.idle, true);
  });

  test('recovery and a scheduled run serialize — never overlap', async () => {
    const order = [];
    const runAttempt = async ({ trigger }) => { order.push('start:' + trigger); await tick(); order.push('end:' + trigger); return { status: 'completed', summary: { created: 0 } }; };
    const s = createSnapshotScheduler({ getDb: () => db, config: cfg(), logger, runAttempt });
    const p1 = s.runStartupRecovery();
    const p2 = s.executeRun('scheduled_daily');
    await Promise.all([p1, p2]);
    assert.deepStrictEqual(order, ['start:startup_recovery', 'end:startup_recovery', 'start:scheduled_daily', 'end:scheduled_daily']);
    assert.strictEqual(s.getStatus().executionState, 'idle');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Correction C — lock renewal + fail-closed capture', () => {
  let db; const f = path.join(os.tmpdir(), `bs-corrC-${process.pid}.db`);
  const lock = require('../../server/history/automation/execution-lock');
  const { seedDatabase } = require('../../server/seed/seed-database');
  const M = require('../../server/monday');
  const { captureHistoricalSnapshots } = require('../../server/history/capture-orchestrator');
  const { findProjectSnapshot } = require('../../server/history/history-repository');
  const logger = M.createLogger({ level: 'error' });

  const board = (slug, name) => ({ projectSlug: slug, projectName: name, address: 'A', itemGrain: 'lease', buildingSource: 'manual',
    categorySource: 'group', groupMap: { Retail: 'retail', Offices: 'office' },
    categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1000 }, { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 2000 }],
    statusMap: { Leased: 'active', Vacant: 'terminated' }, columns: { tenantName: { id: 'cn', type: 'text' }, area: { id: 'ca', type: 'numbers' }, status: { id: 'cs', type: 'status' } },
    safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 90 } });
  const mapping = () => ({ version: 1, boards: { BA: board('business-address', 'Business Address'), TC: board('town-center', 'Town Center') } });
  const item = (u, g, a, s) => ({ id: 'it-' + u, name: u, group: { id: g, title: g }, column_values: [{ id: 'cn', text: s === 'Leased' ? 'T' + u : '' }, { id: 'ca', type: 'numbers', text: String(a) }, { id: 'cs', type: 'status', text: s }] });

  before(async () => {
    rm(f); db = new Database(f); db.pragma('foreign_keys = ON'); runMigrations(db);
    seedDatabase(db, { now: '2026-07-15T00:00:00Z' });
    await M.syncEngine.runSync({ db, config: M.config.loadConfig({ env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: mapping() }), logger, rawByBoard: {
      BA: { id: 'BA', name: 'BA', complete: true, items: [item('R01', 'Retail', 100, 'Leased'), item('D101', 'Offices', 200, 'Leased')] },
      TC: { id: 'TC', name: 'TC', complete: true, items: [item('(A-GF-01)', 'Retail', 300, 'Leased')] },
    } });
  });
  after(() => { try { db.close(); } catch (_) {} rm(f); });

  test('renewDbLock: owner renews (true); wrong owner + released → false', () => {
    lock._resetInProcess();
    const now = '2026-07-19T09:00:00.000Z';
    assert.ok(lock.acquireDbLock(db, { ownerId: 'A', ttlSeconds: 60, nowUtc: now }).ok);
    assert.strictEqual(lock.renewDbLock(db, lock.LOCK_NAME, 'A', 120, now), true, 'owner renews');
    assert.strictEqual(lock.renewDbLock(db, lock.LOCK_NAME, 'B', 120, now), false, 'wrong owner cannot renew');
    assert.strictEqual(lock.releaseDbLock(db, lock.LOCK_NAME, 'A'), true);
    assert.strictEqual(lock.renewDbLock(db, lock.LOCK_NAME, 'A', 120, now), false, 'no lock row → cannot renew');
  });

  test('runExclusive exposes a working owner-checked renew()', () => {
    lock._resetInProcess();
    const out = lock.runExclusive(db, { ownerId: 'Z', ttlSeconds: 60 }, ({ renew }) => renew());
    assert.ok(out.ran);
    assert.strictEqual(out.result, true, 'the current owner can renew its own lease');
  });

  test('capture fails closed when the lease is lost mid-run (nothing persisted)', () => {
    const bd = '2026-08-01';
    const r = captureHistoricalSnapshots({ db, mode: 'write', triggerType: 'manual', forceBusinessDate: bd, lockContext: { ownerId: 'X', renew: () => false } });
    assert.strictEqual(r.status, 'failed');
    assert.strictEqual(r.results[0].errorCode, 'LOCK_OWNERSHIP_LOST');
    assert.strictEqual(r.results[0].underlyingCode, 'LOCK_OWNERSHIP_LOST');
    assert.strictEqual(findProjectSnapshot(db, 'town-center', bd), null);
    assert.strictEqual(findProjectSnapshot(db, 'business-address', bd), null);
  });

  test('capture proceeds normally when renew() keeps returning true', () => {
    const bd = '2026-08-02';
    let renewCalls = 0;
    const r = captureHistoricalSnapshots({ db, mode: 'write', triggerType: 'manual', forceBusinessDate: bd, lockContext: { ownerId: 'X', renew: () => { renewCalls += 1; return true; } } });
    assert.ok(renewCalls >= 1, 'renew is invoked at project boundaries');
    assert.ok(['completed', 'completed_with_skips'].includes(r.status));
    assert.ok(r.created >= 1, 'snapshots created when ownership holds');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Correction D — building presence by row existence (null value is present)', () => {
  let db; const f = path.join(os.tmpdir(), `bs-corrD-${process.pid}.db`);
  const cmp = require('../../server/history/analytics/comparison-service');
  const FROM = '2026-07-17', TO = '2026-07-19';
  before(() => {
    rm(f); db = new Database(f); db.pragma('foreign_keys = ON'); runMigrations(db);
    const pF = insProj(db, 'town-center', FROM, 50, 500);
    const pT = insProj(db, 'town-center', TO, 60, 600);
    insBld(db, pF, 'town-center', FROM, '1', 1, 40); insBld(db, pT, 'town-center', TO, '1', 1, 70);   // present both, valued
    insBld(db, pT, 'town-center', TO, '2', 2, 80);                                                     // added (only TO)
    insBld(db, pF, 'town-center', FROM, '3', 3, 55);                                                   // removed (only FROM)
    insBld(db, pF, 'town-center', FROM, '9', 9, null); insBld(db, pT, 'town-center', TO, '9', 9, null); // present both, NULL value
  });
  after(() => { try { db.close(); } catch (_) {} rm(f); });

  test('null-valued building on both dates is "both", not added/removed', () => {
    const r = cmp.compareBuildings(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: FROM, to: TO });
    const b = (k) => r.buildings.find((x) => x.buildingKey === k);
    assert.strictEqual(b('1').presence, 'both'); assert.strictEqual(b('1').change.absolute, 30);
    assert.strictEqual(b('2').presence, 'added'); assert.strictEqual(b('2').change.absolute, null);
    assert.strictEqual(b('3').presence, 'removed'); assert.strictEqual(b('3').change.absolute, null);
    // the key correction: a stored NULL value is still a PRESENT row
    assert.strictEqual(b('9').presence, 'both');
    assert.strictEqual(b('9').baseline, null);
    assert.strictEqual(b('9').comparison, null);
    assert.strictEqual(b('9').change.absolute, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Correction E — series availability + zero-lease exposure', () => {
  let db; const f = path.join(os.tmpdir(), `bs-corrE-${process.pid}.db`);
  const ser = require('../../server/history/analytics/series-service');
  const tenant = require('../../server/history/analytics/tenant-analytics');
  before(() => {
    rm(f); db = new Database(f); db.pragma('foreign_keys = ON'); runMigrations(db);
    insProj(db, 'valued', '2026-07-17', 50, 500);      // single valued point project
    insProj(db, 'nulls', '2026-07-17', null, null);    // all-null across two dates
    insProj(db, 'nulls', '2026-07-18', null, null);
    insProj(db, 'zerolease', '2026-07-17', 0, 0);      // a project date with NO tenant rows
  });
  after(() => { try { db.close(); } catch (_) {} rm(f); });

  test('empty range → available:false NO_POINTS', () => {
    const s = ser.projectSeries(db, { projectKey: 'valued', metric: 'occupancyPercent', from: '2030-01-01', to: '2030-12-31' });
    assert.strictEqual(s.available, false); assert.strictEqual(s.reason, 'NO_POINTS'); assert.deepStrictEqual(s.points, []);
  });
  test('snapshots exist but every value is null → available:false NO_VALUED_POINTS', () => {
    const s = ser.projectSeries(db, { projectKey: 'nulls', metric: 'occupancyPercent' });
    assert.strictEqual(s.available, false); assert.strictEqual(s.reason, 'NO_VALUED_POINTS'); assert.strictEqual(s.points.length, 2);
  });
  test('single valued point → available:true but change is null (no fake 0/0)', () => {
    const t = ser.projectTrend(db, { projectKey: 'valued', metric: 'occupancyPercent' });
    assert.strictEqual(t.available, true);
    assert.strictEqual(t.summary.valuedPointCount, 1);
    assert.strictEqual(t.summary.change.absolute, null);
    assert.strictEqual(t.summary.change.percent, null);
    assert.strictEqual(t.summary.change.direction, 'unknown');
  });
  test('zero leases → exposure percentages are null, not a misleading 100%', () => {
    const e = tenant.computeLeaseExposure(db, { projectKey: 'zerolease', date: '2026-07-17' });
    assert.strictEqual(e.available, false); assert.strictEqual(e.reason, 'LEASE_EXPIRY_NOT_CAPTURED');
    assert.strictEqual(e.leaseCount, 0);
    for (const b of e.buckets) assert.strictEqual(b.percentOfLeases, null);
  });
});
