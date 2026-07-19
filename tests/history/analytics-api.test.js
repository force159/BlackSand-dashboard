'use strict';
/** Phase 9.2A — analytics HTTP endpoints over real HTTP (app.listen(0)); temp DB, offline. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-analytics-api-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;
process.env.HISTORY_AUTOMATION_ENABLED = 'false';

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');

let db, server, port, psid = 0;
const get = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(d); } catch (_) { return null; } })() })); }).on('error', rej); });
function insProj(pk, date, occ) {
  return db.prepare(`INSERT INTO historical_project_snapshots (snapshot_id, run_id, project_key, business_date, timezone, captured_at_utc, source_type, schema_version, calculation_version, occupancy_percent, leased_area, created_at_utc) VALUES (?,?,?,?, 'Asia/Riyadh', ?, 'monday', 1, 'v1', ?, ?, ?)`)
    .run('snap_' + (++psid), 'r', pk, date, date + 'T02:00:00Z', occ, occ * 10, date + 'T02:00:00Z').lastInsertRowid;
}
function insBld(parent, pk, date, key, order, occ) {
  db.prepare(`INSERT INTO historical_building_snapshots (project_snapshot_id, snapshot_id, project_key, business_date, building_key, building_name, building_order, occupancy_percent, created_at_utc) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(parent, 's', pk, date, key, 'Building ' + key, order, occ, date + 'T02:00:00Z');
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {}
  resetForReinit(); db = initializeDatabase(); runMigrations(db);
  const a = insProj('town-center', '2026-07-17', 50);
  const b = insProj('town-center', '2026-07-19', 60);
  insBld(a, 'town-center', '2026-07-17', '1', 1, 40);
  insBld(b, 'town-center', '2026-07-19', '1', 1, 70);
  const { app } = require('../../server/server');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(() => { try { if (server) server.close(); } catch (_) {} try { closeDatabase(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {} });

test('GET /api/history/metrics → registry list', async () => {
  const r = await get('/api/history/metrics?level=project');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.data.some((m) => m.key === 'occupancyPercent'));
});
test('GET /api/history/compare (project) → change 10 / 20%', async () => {
  const r = await get('/api/history/compare?project=town-center&metric=occupancyPercent&from=2026-07-17&to=2026-07-19');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.change.absolute, 10);
  assert.strictEqual(r.json.data.change.percent, 20);
  assert.ok(!/occupancy_percent|business_date/.test(JSON.stringify(r.json))); // no raw SQL column names
});
test('GET /api/history/compare (building) → per-building batched', async () => {
  const r = await get('/api/history/compare?project=town-center&level=building&metric=occupancyPercent&from=2026-07-17&to=2026-07-19');
  assert.strictEqual(r.status, 200);
  const b1 = r.json.data.buildings.find((b) => b.buildingKey === '1');
  assert.strictEqual(b1.change.absolute, 30);
});
test('GET /api/history/compare policy=latest-vs-previous', async () => {
  const r = await get('/api/history/compare?project=town-center&metric=occupancyPercent&policy=latest-vs-previous');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.from, '2026-07-17'); assert.strictEqual(r.json.data.to, '2026-07-19');
});
test('GET /api/history/series + /trend', async () => {
  const s = await get('/api/history/series?project=town-center&metric=occupancyPercent&from=2026-07-01&to=2026-07-31');
  assert.strictEqual(s.status, 200);
  assert.deepStrictEqual(s.json.data.points.map((p) => p.value), [50, 60]);
  const t = await get('/api/history/trend?project=town-center&metric=occupancyPercent&from=2026-07-01&to=2026-07-31');
  assert.strictEqual(t.status, 200);
  assert.strictEqual(t.json.data.summary.change.absolute, 10);
  assert.strictEqual(t.json.data.summary.average, 55);
});
test('validation: missing project 400, unsupported metric 400, bad date 400, from>to 400, bad level 400', async () => {
  assert.strictEqual((await get('/api/history/compare?metric=occupancyPercent&from=2026-07-17&to=2026-07-19')).status, 400);
  const um = await get('/api/history/compare?project=town-center&metric=bogus&from=2026-07-17&to=2026-07-19');
  assert.strictEqual(um.status, 400); assert.strictEqual(um.json.error, 'UNSUPPORTED_METRIC');
  assert.strictEqual((await get('/api/history/compare?project=town-center&metric=occupancyPercent&from=2026-13-40&to=2026-07-19')).status, 400);
  const rng = await get('/api/history/compare?project=town-center&metric=occupancyPercent&from=2026-07-19&to=2026-07-17');
  assert.strictEqual(rng.status, 400); assert.strictEqual(rng.json.error, 'INVALID_RANGE');
  assert.strictEqual((await get('/api/history/series?project=town-center&level=nope&metric=occupancyPercent')).status, 400);
});
test('regression: existing /api/history/dates still works', async () => {
  const r = await get('/api/history/dates');
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.data.some((d) => d.date === '2026-07-19'));
});
