'use strict';
/**
 * Phase 9.1A — snapshot builder/validator/persistence/orchestrator (temp DB + offline
 * Monday fixtures; no network). Covers acceptance Scenarios 3–10 + DoD reuse/parity.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-hist-eng-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const { setCurrentDataSource } = require('../../server/monday/persistence');
const M = require('../../server/monday');
const dashboard = require('../../server/services/dashboard-service');
const { captureHistoricalSnapshots } = require('../../server/history/capture-orchestrator');
const { buildProjectSnapshot } = require('../../server/history/snapshot-builder');
const { validateProjectSnapshot } = require('../../server/history/snapshot-validator');
const { evaluateSourceEligibility } = require('../../server/history/eligibility');
const { aggregateProjectTenants, normalizeTenantName } = require('../../server/history/live-metrics');
const repo = require('../../server/history/history-repository');
const { captureContext } = require('../../server/history/riyadh-date');

let db;
const logger = M.createLogger({ level: 'error' });
const AT = '2026-07-19T09:00:00Z'; // fixed capture instant

function mapping() {
  const board = (slug, name) => ({
    projectSlug: slug, projectName: name, address: 'Addr ' + slug, itemGrain: 'lease', buildingSource: 'manual',
    categorySource: 'group', groupMap: { Retail: 'retail', Offices: 'office' },
    categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1000 },
      { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 2000 }],
    statusMap: { Leased: 'active', Vacant: 'terminated' },
    columns: { tenantName: { id: 'cn', type: 'text' }, area: { id: 'ca', type: 'numbers' }, status: { id: 'cs', type: 'status' }, leaseDate: { id: 'cd', type: 'date' } },
    safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 90 },
  });
  return { version: 1, boards: { BID_BA: board('business-address', 'Business Address'), BID_TC: board('town-center', 'Town Center') } };
}
function item(unit, group, area, status, tenant, date) {
  return { id: 'it-' + unit, name: unit, group: { id: group, title: group },
    column_values: [{ id: 'cn', text: tenant || (status === 'Leased' ? 'T ' + unit : '') }, { id: 'ca', type: 'numbers', text: String(area) },
      { id: 'cs', type: 'status', text: status }, { id: 'cd', type: 'date', text: date || '' }] };
}
function raw(ba, tc) { return { BID_BA: { id: 'BID_BA', name: 'BA', complete: true, items: ba }, BID_TC: { id: 'BID_TC', name: 'TC', complete: true, items: tc } }; }
function cfg() { return M.config.loadConfig({ env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: mapping() }); }

before(async () => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {}
  resetForReinit(); db = initializeDatabase(); runMigrations(db); seedDatabase(db, { now: '2026-07-15T00:00:00Z' });
  // BA: duplicate tenant "Acme" across 2 retail units + an office unit; C06 excluded; a vacant unit; recent + old dates.
  const ba = [
    item('R01', 'Retail', 100, 'Leased', 'Acme', '2026-07-01'),   // within 90d of 2026-07-19
    item('C01', 'Retail', 50, 'Leased', 'Acme', '2026-01-01'),    // old (outside window)
    item('D101', 'Offices', 200, 'Leased', 'Acme', '2026-07-10'), // within window; Building 1
    item('C06', 'Retail', 77, 'Leased', 'Excluded Co', '2026-07-05'), // EXCLUDED from buildings (small: keeps retail <100%)
    item('R02', 'Retail', 40, 'Vacant', '', ''),                  // vacant → counts to total, not leased
    item('D102', 'Offices', 300, 'Leased', 'Beta', '2026-07-15'), // Building 2
  ];
  const tc = [
    item('(A-GF-01)', 'Retail', 300, 'Leased', 'Gamma', '2026-07-12'), // Building 1
    item('(G-SF-01)', 'Offices', 500, 'Vacant', '', ''),               // Building 7 vacant
  ];
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw(ba, tc) });
  assert.strictEqual(r.status, 'success');
});
after(() => { try { closeDatabase(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {} });

const payloadProject = (slug) => dashboard.buildDashboardPayload(db, AT).body.data.projects.find((p) => p.slug === slug);

// ── builder parity + rules ──
test('SCENARIO 3/parity: tenant aggregation matches the live directory (duplicate names merge)', () => {
  const summary = captureHistoricalSnapshots({ db, projectKeys: ['business-address'], mode: 'dry-run', capturedAt: new Date(AT), logger });
  const snap = summary.results[0].snapshot;
  // Live payload directory aggregation (normalized) for parity.
  const ba = payloadProject('business-address');
  const norm = (arr) => { const m = {}; arr.forEach((t) => { const k = normalizeTenantName(t.name); m[k] = (m[k] || 0) + (Number(t.area) || 0); }); return m; };
  const live = {}; const all = ba.retail.tenants.concat(ba.office.tenants);
  all.forEach((t) => { const k = normalizeTenantName(t.name); live[k] = (live[k] || 0) + (Number(t.area) || 0); });
  const acme = snap.tenants.find((t) => t.tenantNormalizedName === 'acme');
  assert.ok(acme, 'Acme aggregated');
  assert.strictEqual(acme.totalLeasedArea, live['acme']);       // matches live directory total (100+50+200=350)
  assert.strictEqual(acme.totalLeasedArea, 350);
  assert.strictEqual(acme.leaseRecordCount, 3);                  // 3 active leases merged into one tenant
  // Active lease rows: R01,C01,D101,D102 + C06 (C06 is excluded from BUILDINGS but is a real active lease). = 5.
  assert.strictEqual(snap.project.tenantCountRaw, 5);
  assert.strictEqual(snap.project.tenantCountAggregated, 3);     // Acme, Beta, Excluded Co
});

test('C06 is EXCLUDED from buildings but preserved in project totals', () => {
  const summary = captureHistoricalSnapshots({ db, projectKeys: ['business-address'], mode: 'dry-run', capturedAt: new Date(AT), logger });
  const snap = summary.results[0].snapshot;
  assert.strictEqual(snap.project.excludedRecordCount, 1, 'C06 excluded');
  // Σ building areas exclude C06: R01(100,B2)+C01(50,B2)+D101(200,B1)+R02(40,B3 vacant)+D102(300,B2) = 690.
  const buildingArea = snap.buildings.reduce((s, b) => s + (b.totalArea || 0), 0);
  assert.strictEqual(buildingArea, 690, 'C06 area not in any building total');
  // But C06 IS preserved as a project lease row: 6 leases total (5 active + 1 vacant).
  assert.strictEqual(snap.project.totalUnitCount, 6);
});

test('velocity uses the rolling 90-day window (old lease excluded)', () => {
  const summary = captureHistoricalSnapshots({ db, projectKeys: ['business-address'], mode: 'dry-run', capturedAt: new Date(AT), logger });
  const p = summary.results[0].snapshot.project;
  // Within window: R01(100,07-01)+D101(200,07-10)+D102(300,07-15)+C06(77,07-05) = 677; C01(01-01) old excluded.
  assert.strictEqual(p.leasingVelocityArea90d, 677);
  assert.strictEqual(p.leasingVelocityLeaseCount90d, 4);
});

test('building metrics match the live payload (no drift) + TC mapping A→1, G→7', () => {
  const summary = captureHistoricalSnapshots({ db, projectKeys: ['town-center'], mode: 'dry-run', capturedAt: new Date(AT), logger });
  const snap = summary.results[0].snapshot;
  const tc = payloadProject('town-center');
  assert.deepStrictEqual(snap.buildings.map((b) => b.buildingKey), tc.buildings.map((b) => String(b.id)));
  const b1 = snap.buildings.find((b) => b.buildingKey === '1');
  const b7 = snap.buildings.find((b) => b.buildingKey === '7');
  assert.strictEqual(b1.retailLeasedArea, 300); // (A-GF-01) leased
  assert.strictEqual(b7.officeLeasedArea, 0);    // (G-SF-01) vacant → 0 leased
  assert.strictEqual(b7.officeTotalArea, 500);   // vacant counts toward total
});

test('no NaN/Infinity in a built snapshot', () => {
  const summary = captureHistoricalSnapshots({ db, projectKeys: ['business-address', 'town-center'], mode: 'dry-run', capturedAt: new Date(AT), logger });
  for (const r of summary.results) {
    const walk = (o) => Object.values(o).forEach((v) => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), 'finite');
      else if (v && typeof v === 'object') walk(v);
    });
    walk(r.snapshot.project); r.snapshot.buildings.forEach(walk); r.snapshot.tenants.forEach(walk);
  }
});

// ── validator ──
function goodSnap() {
  return {
    project: { projectKey: 'town-center', totalGla: 1000, leasedArea: 600, vacantArea: 400, occupancyPercent: 60,
      retailTotalArea: 0, retailLeasedArea: 0, retailVacantArea: 0, retailOccupancyPercent: 0,
      officeTotalArea: 1000, officeLeasedArea: 600, officeVacantArea: 400, officeOccupancyPercent: 60,
      activeLeaseCount: 2, tenantCountRaw: 2, tenantCountAggregated: 2, occupiedUnitCount: 2, vacantUnitCount: 0, totalUnitCount: 2,
      leasingVelocityArea90d: 0, leasingVelocityLeaseCount90d: 0, unassignedArea: 0, unassignedUnitCount: 0, excludedRecordCount: 0 },
    buildings: [{ buildingKey: '1', totalArea: 1000, leasedArea: 600, occupancyPercent: 60 }],
    tenants: [{ tenantKey: 'a', totalLeasedArea: 600, primaryCategory: 'office' }],
    provenance: { snapshotId: 's1', businessDate: '2026-07-19', capturedAtUtc: AT, sourceType: 'monday' },
    warnings: [],
  };
}
test('validator: good snapshot passes', () => assert.strictEqual(validateProjectSnapshot(goodSnap()).valid, true));
test('validator: rejects negative area, occupancy>100, dup keys, non-finite, missing key, bad source', () => {
  const bad = (mut) => { const s = goodSnap(); mut(s); return validateProjectSnapshot(s); };
  assert.ok(!bad((s) => { s.project.leasedArea = -1; }).valid);
  assert.ok(!bad((s) => { s.project.occupancyPercent = 150; }).valid);
  assert.ok(!bad((s) => { s.buildings.push({ buildingKey: '1', totalArea: 1, leasedArea: 0, occupancyPercent: 0 }); }).valid); // dup building key
  assert.ok(!bad((s) => { s.tenants.push({ tenantKey: 'a', totalLeasedArea: 1, primaryCategory: 'x' }); }).valid); // dup tenant key
  assert.ok(!bad((s) => { s.project.totalGla = Infinity; }).valid);
  assert.ok(!bad((s) => { s.project.projectKey = ''; }).valid);
  assert.ok(!bad((s) => { s.provenance.sourceType = 'seed'; }).valid);
  assert.ok(!bad((s) => { s.project.leasedArea = 5000; }).valid); // leased >> total GLA
});

// ── eligibility ──
test('eligibility: monday eligible; seed/none ineligible', () => {
  const meta = { dataVersion: 'v', lastSuccessfulSync: 't', source: 'sqlite' };
  const project = payloadProject('town-center');
  assert.ok(evaluateSourceEligibility({ project, meta, currentDataSource: 'monday' }).eligible);
  assert.ok(!evaluateSourceEligibility({ project, meta, currentDataSource: 'seed' }).eligible);
  assert.ok(!evaluateSourceEligibility({ project, meta: { source: 'sqlite' }, currentDataSource: 'monday' }).eligible); // no dataVersion
});

// ── orchestrator write / duplicate / audit (Scenarios 4,5,6) ──
test('SCENARIO 4/6: write both projects → one snapshot each + audit completed', () => {
  const s = captureHistoricalSnapshots({ db, mode: 'write', capturedAt: new Date(AT), logger });
  assert.strictEqual(s.created, 2);
  assert.ok(['completed', 'completed_with_skips'].includes(s.status));
  const ba = db.prepare("SELECT * FROM historical_project_snapshots WHERE project_key='business-address'").get();
  assert.ok(ba, 'BA parent row');
  const nb = db.prepare('SELECT COUNT(*) n FROM historical_building_snapshots WHERE project_snapshot_id=?').get(ba.id).n;
  const nt = db.prepare('SELECT COUNT(*) n FROM historical_tenant_snapshots WHERE project_snapshot_id=?').get(ba.id).n;
  assert.strictEqual(nb, 5); // BA buildings 1..5
  assert.ok(nt >= 3);        // Acme, Beta, Excluded Co
  const run = db.prepare("SELECT * FROM historical_snapshot_runs WHERE mode='write' ORDER BY id DESC").get();
  assert.ok(['completed', 'completed_with_skips'].includes(run.status));
  assert.ok(run.completed_at_utc, 'terminal timestamp set');
  assert.ok(!/eyJ|token/i.test(JSON.stringify(run)), 'no secret in audit');
});
test('SCENARIO 5: duplicate write → skipped, no overwrite, original immutable', () => {
  const before = db.prepare("SELECT snapshot_id, occupancy_percent FROM historical_project_snapshots WHERE project_key='business-address'").get();
  const s = captureHistoricalSnapshots({ db, projectKeys: ['business-address'], mode: 'write', capturedAt: new Date(AT), logger });
  assert.strictEqual(s.results[0].status, 'duplicate_skipped');
  assert.strictEqual(s.created, 0);
  const after = db.prepare("SELECT snapshot_id, occupancy_percent, COUNT(*) OVER() c FROM historical_project_snapshots WHERE project_key='business-address'").get();
  assert.strictEqual(after.snapshot_id, before.snapshot_id, 'not overwritten');
  assert.strictEqual(after.c, 1, 'no duplicate parent');
});

// ── persistence rollback + concurrent duplicate (Scenarios 9,10) — separate temp DB ──
test('SCENARIO 9: child insert failure rolls back the whole project snapshot', () => {
  const before = repo.countSnapshots(db);
  const ba = payloadProject('business-address');
  const cap = captureContext(new Date(AT)); cap.businessDate = '2099-01-01'; // unique date → no pre-existing dup
  const canonical = buildProjectSnapshot({ projectKey: 'business-address', projectName: ba.project, address: ba.address,
    metrics: ba.metrics, buildingsPayload: ba.buildings, allLeases: [], capture: cap,
    sourceContext: { sourceType: 'monday', sourceDataVersion: 'v', sourceSyncedAtUtc: 't' }, ids: { snapshotId: 'snap_rb', runId: 'run_rb' } });
  // Inject a duplicate building key → the 2nd building insert violates UNIQUE(project_snapshot_id, building_key).
  canonical.buildings.push({ ...canonical.buildings[0] });
  assert.throws(() => repo.persistProjectSnapshot(db, canonical, { runId: 'run_rb' }));
  assert.strictEqual(repo.countSnapshots(db), before, 'no parent left after rollback');
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM historical_project_snapshots WHERE business_date='2099-01-01'").get().n, 0);
});
test('SCENARIO 10: second snapshot for same project/date → duplicate_skipped via UNIQUE (no corruption)', () => {
  const ba = payloadProject('business-address');
  const cap = captureContext(new Date(AT));
  const mk = (sid) => buildProjectSnapshot({ projectKey: 'business-address', projectName: ba.project, address: ba.address,
    metrics: ba.metrics, buildingsPayload: ba.buildings, allLeases: [], capture: cap,
    sourceContext: { sourceType: 'monday', sourceDataVersion: 'v', sourceSyncedAtUtc: 't' }, ids: { snapshotId: sid, runId: 'r' } });
  // A BA snapshot already exists (from Scenario 4) for this business date → this must skip.
  const res = repo.persistProjectSnapshot(db, mk('snap_dupe_2'), { runId: 'r' });
  assert.strictEqual(res.status, 'duplicate_skipped');
  assert.strictEqual(res.created, false);
});

// ── demo/seed ineligible (Scenario 7) — flip BA to seed source ──
test('SCENARIO 7: seed/demo source → ineligible, no snapshot stored', () => {
  const proj = db.prepare("SELECT id FROM projects WHERE slug='town-center'").get();
  setCurrentDataSource(db, proj.id, 'seed', new Date(AT).toISOString());
  const s = captureHistoricalSnapshots({ db, projectKeys: ['town-center'], mode: 'write', capturedAt: new Date('2026-08-01T09:00:00Z'), logger });
  assert.strictEqual(s.results[0].status, 'source_ineligible');
  assert.strictEqual(s.created, 0);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM historical_project_snapshots WHERE project_key='town-center' AND business_date='2026-08-01'").get().n, 0);
  const run = db.prepare("SELECT status FROM historical_snapshot_runs ORDER BY id DESC").get();
  assert.strictEqual(run.status, 'source_ineligible');
  setCurrentDataSource(db, proj.id, 'monday', new Date(AT).toISOString()); // restore
});
