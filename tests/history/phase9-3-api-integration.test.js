'use strict';
/**
 * Phase 9.3 — HISTORICAL DASHBOARD API INTEGRATION. Drives the EXACT read-only endpoints the
 * Historical Analytics frontend consumes, against a real in-process app with seeded synthetic
 * snapshots (two dates), and asserts the contract the UI depends on — including the deterministic
 * insight title/message (rendered verbatim by the client), empty-history 404s, and invalid
 * comparison 400s. No writes from any GET. Offline (no Monday, no network).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-p93-api-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;
process.env.HISTORY_AUTOMATION_ENABLED = 'false';

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');

let db, server, port, psid = 0;
const PROJECT = 'town-center', D1 = '2026-07-15', D2 = '2026-07-20';
const get = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(d); } catch (_) { return null; } })() })); }).on('error', rej); });

function insProj(pk, date, o) {
  return db.prepare(`INSERT INTO historical_project_snapshots
    (snapshot_id, run_id, project_key, project_name, business_date, timezone, captured_at_utc, source_type, source_data_version, schema_version, calculation_version,
     total_gla, leased_area, vacant_area, occupancy_percent, tenant_count_raw, tenant_count_aggregated, active_lease_count, occupied_unit_count, vacant_unit_count, total_unit_count, created_at_utc)
    VALUES (@sid,@rid,@pk,@pn,@d,'Asia/Riyadh',@cap,'monday',@dv,1,'historical-calculations-v1',@gla,@leased,@vac,@occ,@traw,@tagg,@alc,@occu,@vacu,@totu,@cap)`)
    .run({ sid: 'snap_' + (++psid), rid: 'run_' + psid, pk, pn: 'Town Center', d: date, cap: date + 'T02:00:00Z', dv: 'dv-' + date,
      gla: o.gla, leased: o.leased, vac: o.gla - o.leased, occ: o.occ, traw: o.traw, tagg: o.tagg, alc: o.traw, occu: o.occu, vacu: o.vacu, totu: o.occu + o.vacu }).lastInsertRowid;
}
function insBld(parent, pk, date, key, order, o) {
  db.prepare(`INSERT INTO historical_building_snapshots
    (project_snapshot_id, snapshot_id, project_key, business_date, building_key, building_name, building_order, total_area, leased_area, vacant_area, occupancy_percent, unit_count, occupied_unit_count, vacant_unit_count, created_at_utc)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(parent, 'sp', pk, date, key, 'Building ' + key, order, o.total, o.leased, o.total - o.leased, o.occ, o.units, o.occu, o.units - o.occu, date + 'T02:00:00Z');
}
function insTenant(parent, pk, date, t) {
  db.prepare(`INSERT INTO historical_tenant_snapshots (project_snapshot_id, snapshot_id, project_key, business_date, tenant_key, tenant_display_name, tenant_normalized_name, total_leased_area, lease_record_count, unit_count, building_count, building_keys_json, primary_category, categories_json, rank_by_area, is_top_3, is_top_5, is_top_10, active_lease_count, created_at_utc)
    VALUES (@p,'s',@pk,@d,@k,@disp,@norm,@area,@lr,@u,@bc,@bk,@cat,@cj,@rank,@t3,@t5,@t10,@al,@ca)`).run({
    p: parent, pk, d: date, k: t.key, disp: t.disp || t.key, norm: t.key, area: t.area, lr: t.leases || 1, u: t.units || 1,
    bc: 1, bk: JSON.stringify(['1']), cat: 'retail', cj: JSON.stringify({ retail: t.area }), rank: t.rank, t3: t.rank <= 3 ? 1 : 0, t5: 1, t10: 1, al: t.leases || 1, ca: date + 'T02:00:00Z',
  });
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {}
  resetForReinit(); db = initializeDatabase(); runMigrations(db);
  // Two snapshots: occupancy 55 → 45 (a decline → executive insight), concentrated tenants.
  const p1 = insProj(PROJECT, D1, { gla: 10000, leased: 5500, occ: 55, traw: 8, tagg: 5, occu: 20, vacu: 16 });
  insBld(p1, PROJECT, D1, '1', 1, { total: 6000, leased: 3600, occ: 60, units: 24, occu: 14 });
  insBld(p1, PROJECT, D1, '2', 2, { total: 4000, leased: 1900, occ: 47.5, units: 16, occu: 6 });
  insTenant(p1, PROJECT, D1, { key: 'alpha', disp: 'Alpha Holding', area: 3000, units: 8, leases: 8, rank: 1 });
  insTenant(p1, PROJECT, D1, { key: 'beta', disp: 'Beta Retail', area: 1500, units: 4, leases: 4, rank: 2 });
  insTenant(p1, PROJECT, D1, { key: 'gamma', disp: 'Gamma Co', area: 1000, units: 3, leases: 3, rank: 3 });
  const p2 = insProj(PROJECT, D2, { gla: 10000, leased: 4500, occ: 45, traw: 7, tagg: 4, occu: 18, vacu: 18 });
  insBld(p2, PROJECT, D2, '1', 1, { total: 6000, leased: 3200, occ: 53.3, units: 24, occu: 13 });
  insBld(p2, PROJECT, D2, '2', 2, { total: 4000, leased: 1300, occ: 32.5, units: 16, occu: 5 });
  insTenant(p2, PROJECT, D2, { key: 'alpha', disp: 'Alpha Holding', area: 3200, units: 9, leases: 9, rank: 1 }); // expansion
  insTenant(p2, PROJECT, D2, { key: 'beta', disp: 'Beta Retail', area: 800, units: 2, leases: 2, rank: 2 });    // contraction
  insTenant(p2, PROJECT, D2, { key: 'delta', disp: 'Delta Group', area: 500, units: 2, leases: 2, rank: 3 });   // entry (gamma exits)
  const { app } = require('../../server/server');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(() => { try { if (server) server.close(); } catch (_) {} try { closeDatabase(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {} });

// ── snapshot date list (UI reads the occupancy series to build its selector) ──
test('series drives the snapshot selector: two ascending dated points', async () => {
  const r = await get('/api/history/series?project=' + PROJECT + '&metric=occupancyPercent');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.available, true);
  assert.deepStrictEqual(r.json.data.points.map((p) => p.date), [D1, D2]);
  assert.deepStrictEqual(r.json.data.points.map((p) => p.value), [55, 45]);
});

// ── executive overview: snapshot figures + backend insight TEXT rendered verbatim ──
test('executive-summary: scoped context + insights carry title/message', async () => {
  const r = await get('/api/history/executive-summary?project=' + PROJECT + '&date=' + D2);
  assert.strictEqual(r.status, 200);
  const d = r.json.data;
  assert.strictEqual(d.summaryDate, D2);
  assert.strictEqual(d.previousDate, D1);
  assert.strictEqual(d.snapshotDateCount, 2);
  assert.strictEqual(d.totalSnapshotDateCount, 2);
  assert.strictEqual(d.comparison.from, D1);
  assert.strictEqual(d.comparison.to, D2);
  assert.strictEqual(d.comparison.change.absolute, -10); // 55 → 45, backend-computed
  assert.ok(Array.isArray(d.insights) && d.insights.length > 0);
  assert.ok(d.insights.every((i) => typeof i.title === 'string' && i.title && typeof i.message === 'string' && i.message));
  assert.ok(d.insights.some((i) => i.ruleKey === 'occupancy.critical-low'), 'occupancy 45% → critical-low insight');
});

test('snapshots/:date exposes the headline figures the overview shows', async () => {
  const r = await get('/api/history/snapshots/' + D2);
  assert.strictEqual(r.status, 200);
  const p = r.json.data.projects.find((x) => x.projectKey === PROJECT);
  assert.ok(p);
  assert.strictEqual(p.occupancyPercent, 45);
  assert.strictEqual(p.vacantArea, 5500);
  assert.strictEqual(p.totalGla, 10000);
  assert.strictEqual(p.tenantCountRaw, 7);
});

// ── building analytics ──
test('buildings + building comparison (latest-vs-previous)', async () => {
  const b = await get('/api/history/snapshots/' + D2 + '/buildings?project=' + PROJECT);
  assert.strictEqual(b.status, 200);
  assert.strictEqual(b.json.data.length, 2);
  const cmp = await get('/api/history/compare?project=' + PROJECT + '&level=building&metric=occupancyPercent&policy=latest-vs-previous');
  assert.strictEqual(cmp.status, 200);
  const b1 = cmp.json.data.buildings.find((x) => x.buildingKey === '1');
  assert.strictEqual(b1.presence, 'both');
  assert.ok(b1.change.absolute < 0); // 60 → 53.3
});

// ── tenant analytics ──
test('tenants: largest, portfolio, concentration, movement, exposure-unavailable', async () => {
  const largest = await get('/api/history/snapshots/' + D2 + '/tenants?project=' + PROJECT + '&orderBy=rank_by_area&order=asc&limit=10');
  assert.strictEqual(largest.status, 200);
  assert.strictEqual(largest.json.data[0].displayName, 'Alpha Holding');
  const portfolio = await get('/api/history/tenants/portfolio?project=' + PROJECT + '&date=' + D2);
  assert.strictEqual(portfolio.json.data.aggregatedTenantCount, 3);
  const con = await get('/api/history/tenants/concentration?project=' + PROJECT + '&date=' + D2);
  assert.strictEqual(con.json.data.available, true);
  assert.ok(con.json.data.hhiPoints > 0);
  const mv = await get('/api/history/tenants/movements?project=' + PROJECT + '&policy=latest-vs-previous');
  assert.strictEqual(mv.json.data.counts.possibleEntry, 1); // delta
  assert.strictEqual(mv.json.data.counts.possibleExit, 1);  // gamma
  const exp = await get('/api/history/tenants/lease-exposure?project=' + PROJECT + '&date=' + D2);
  assert.strictEqual(exp.json.data.available, false);
  assert.strictEqual(exp.json.data.reason, 'LEASE_EXPIRY_NOT_CAPTURED');
});

// ── snapshot comparison (project metric) ──
test('compare project metric returns backend-computed change', async () => {
  const r = await get('/api/history/compare?project=' + PROJECT + '&metric=leasedArea&from=' + D1 + '&to=' + D2);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.baseline.value, 5500);
  assert.strictEqual(r.json.data.comparison.value, 4500);
  assert.strictEqual(r.json.data.change.absolute, -1000);
});

// ── data quality ──
test('status reports collection counts for the Data Quality view', async () => {
  const r = await get('/api/history/status');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data.successfulSnapshotDateCount, 2);
  assert.strictEqual(r.json.data.latestSuccessfulSnapshotDate, D2);
  assert.strictEqual(r.json.data.earliestSuccessfulSnapshotDate, D1);
});

// ── error/empty states the UI must handle ──
test('empty history → 404 (valid-but-absent); invalid comparison range → 400', async () => {
  const empty = await get('/api/history/snapshots/2000-01-01');
  assert.strictEqual(empty.status, 404);
  const badRange = await get('/api/history/compare?project=' + PROJECT + '&metric=occupancyPercent&from=' + D2 + '&to=' + D1);
  assert.strictEqual(badRange.status, 400);
  const unknownProject = await get('/api/history/tenants/portfolio'); // missing project
  assert.strictEqual(unknownProject.status, 400);
});

// ── no writes from GET ──
test('GET traffic never writes snapshots', async () => {
  const before = db.prepare('SELECT COUNT(*) n FROM historical_project_snapshots').get().n;
  await get('/api/history/executive-summary?project=' + PROJECT);
  await get('/api/history/series?project=' + PROJECT + '&metric=occupancyPercent');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM historical_project_snapshots').get().n, before);
});
