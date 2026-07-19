'use strict';
/** Phase 9.1B — read-only history API over real HTTP (app.listen(0)). Validation, envelopes,
 * 404 vs 400, pagination, injection-as-data, and no-writes-from-GET. Temp DB, offline. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-hist-api-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;
process.env.HISTORY_AUTOMATION_ENABLED = 'false'; // don't arm timers under test

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const M = require('../../server/monday');
const { captureHistoricalSnapshots } = require('../../server/history/capture-orchestrator');
const { countSnapshots } = require('../../server/history/history-repository');

let db, server, port;
const logger = M.createLogger({ level: 'error' });
const AT = new Date('2026-07-19T09:00:00Z'); // Riyadh date 2026-07-19
const DATE = '2026-07-19';

const item = (u, g, a, s) => ({ id: 'it-' + u, name: u, group: { id: g, title: g }, column_values: [{ id: 'cn', text: s === 'Leased' ? 'T' + u : '' }, { id: 'ca', type: 'numbers', text: String(a) }, { id: 'cs', type: 'status', text: s }] });
function mapping() {
  const b = (slug, name) => ({ projectSlug: slug, projectName: name, address: 'A', itemGrain: 'lease', buildingSource: 'manual', categorySource: 'group', groupMap: { Retail: 'retail', Offices: 'office' }, categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1000 }, { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 2000 }], statusMap: { Leased: 'active', Vacant: 'terminated' }, columns: { tenantName: { id: 'cn', type: 'text' }, area: { id: 'ca', type: 'numbers' }, status: { id: 'cs', type: 'status' } }, safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 90 } });
  return { version: 1, boards: { BA: b('business-address', 'Business Address'), TC: b('town-center', 'Town Center') } };
}
const get = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(d); } catch (_) { return null; } })() })); }).on('error', rej); });

before(async () => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {}
  resetForReinit(); db = initializeDatabase(); runMigrations(db); seedDatabase(db, { now: '2026-07-15T00:00:00Z' });
  await M.syncEngine.runSync({ db, config: M.config.loadConfig({ env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: mapping() }), logger, rawByBoard: {
    BA: { id: 'BA', name: 'BA', complete: true, items: [item('R01', 'Retail', 100, 'Leased'), item('D101', 'Offices', 200, 'Leased')] },
    TC: { id: 'TC', name: 'TC', complete: true, items: [item('(A-GF-01)', 'Retail', 300, 'Leased')] },
  } });
  captureHistoricalSnapshots({ db, mode: 'write', capturedAt: AT, triggerType: 'test', logger });
  const { app } = require('../../server/server');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(() => { try { if (server) server.close(); } catch (_) {} try { closeDatabase(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {} });

test('GET /api/history/status → 200 with safe operational data', async () => {
  const r = await get('/api/history/status');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.data.successfulProjectSnapshotCount >= 2);
  assert.strictEqual(r.json.data.successfulSnapshotDateCount, 1);
  assert.strictEqual(r.json.data.timezone, 'Asia/Riyadh');
  assert.ok(!/token|eyJ|\.db|SELECT/i.test(JSON.stringify(r.json)));
});
test('GET /api/history/dates → today present + pagination meta', async () => {
  const r = await get('/api/history/dates');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.data.some((d) => d.date === DATE && d.projectCount === 2));
  assert.ok(r.json.meta && typeof r.json.meta.hasMore === 'boolean');
});
test('GET /api/history/snapshots/:date → 200 both projects; missing date → 404; bad date → 400', async () => {
  const ok = await get('/api/history/snapshots/' + DATE);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.data.projects.length, 2);
  assert.strictEqual((await get('/api/history/snapshots/2020-01-01')).status, 404);
  const bad = await get('/api/history/snapshots/2026-13-40');
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.json.error, 'INVALID_DATE');
});
test('GET buildings → rows, project filter, invalid orderBy → 400', async () => {
  const r = await get('/api/history/snapshots/' + DATE + '/buildings?project=town-center');
  assert.strictEqual(r.status, 200);
  // Mapped public contract: camelCase projectKey, nested retail/office, no raw *_json.
  assert.ok(r.json.data.length >= 1 && r.json.data.every((b) => b.projectKey === 'town-center'));
  assert.ok(r.json.data.every((b) => b.retail && typeof b.buildingKey === 'string' && !('project_key' in b) && !('warnings_json' in b)));
  assert.strictEqual((await get('/api/history/snapshots/' + DATE + '/buildings?orderBy=drop_table')).status, 400);
});
test('GET tenants → injection treated as data (no error, 0 rows), limit capped', async () => {
  const inj = await get('/api/history/snapshots/' + DATE + '/tenants?search=' + encodeURIComponent("' OR 1=1;--"));
  assert.strictEqual(inj.status, 200);
  assert.strictEqual(inj.json.data.length, 0); // literal search, no injection
  assert.strictEqual(inj.json.meta.rowType, 'aggregated-tenant-directory');
  const cap = await get('/api/history/snapshots/' + DATE + '/tenants?limit=99999');
  assert.strictEqual(cap.status, 200);
  assert.ok(cap.json.meta.limit <= 200);
});
test('GET /api/history/runs → filters + range validation', async () => {
  assert.strictEqual((await get('/api/history/runs')).status, 200);
  assert.strictEqual((await get('/api/history/runs?status=bogus')).status, 400);
  const range = await get('/api/history/runs?from=2026-02-01&to=2026-01-01');
  assert.strictEqual(range.status, 400);
  assert.strictEqual(range.json.error, 'INVALID_RANGE');
});
test('GET routes never write to history tables', async () => {
  const before = countSnapshots(db);
  for (const p of ['/api/history/status', '/api/history/dates', '/api/history/snapshots/' + DATE, '/api/history/snapshots/' + DATE + '/buildings', '/api/history/snapshots/' + DATE + '/tenants', '/api/history/runs']) await get(p);
  assert.strictEqual(countSnapshots(db), before);
});
