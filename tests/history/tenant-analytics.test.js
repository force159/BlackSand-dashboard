'use strict';
/** Phase 9.2B — tenant portfolio / concentration / exposure / movement / insights /
 * executive summary + HTTP endpoints. Deterministic synthetic snapshots; temp DB; offline. */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-tenant-an-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;
process.env.HISTORY_AUTOMATION_ENABLED = 'false';

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const tenant = require('../../server/history/analytics/tenant-analytics');
const movement = require('../../server/history/analytics/tenant-movement');
const { evaluateInsights } = require('../../server/history/analytics/insight-rules');
const exec = require('../../server/history/analytics/executive-summary');

let db, server, port, psid = 0;
const FROM = '2026-07-17', TO = '2026-07-19';
const get = (p) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path: p }, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res({ status: r.statusCode, json: (() => { try { return JSON.parse(d); } catch (_) { return null; } })() })); }).on('error', rej); });

function insProj(pk, date, occ) {
  return db.prepare(`INSERT INTO historical_project_snapshots (snapshot_id, run_id, project_key, business_date, timezone, captured_at_utc, source_type, schema_version, calculation_version, occupancy_percent, created_at_utc) VALUES (?,?,?,?, 'Asia/Riyadh', ?, 'monday', 1, 'v1', ?, ?)`)
    .run('snap_' + (++psid), 'r', pk, date, date + 'T02:00:00Z', occ, date + 'T02:00:00Z').lastInsertRowid;
}
function insTenant(parent, pk, date, t) {
  db.prepare(`INSERT INTO historical_tenant_snapshots (project_snapshot_id, snapshot_id, project_key, business_date, tenant_key, tenant_display_name, tenant_normalized_name, total_leased_area, lease_record_count, unit_count, building_count, building_keys_json, primary_category, categories_json, rank_by_area, is_top_3, is_top_5, is_top_10, active_lease_count, created_at_utc)
    VALUES (@p,@sid,@pk,@d,@k,@disp,@norm,@area,@lr,@u,@bc,@bk,@cat,@cj,@rank,@t3,@t5,@t10,@al,@ca)`).run({
    p: parent, sid: 's', pk, d: date, k: t.key, disp: t.display || t.key, norm: t.key, area: t.area, lr: t.leases || 1, u: t.units || 1,
    bc: (t.buildings || []).length, bk: JSON.stringify(t.buildings || []), cat: 'retail', cj: JSON.stringify({ retail: t.area }),
    rank: t.rank || 1, t3: 1, t5: 1, t10: 1, al: t.leases || 1, ca: date + 'T02:00:00Z',
  });
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {}
  resetForReinit(); db = initializeDatabase(); runMigrations(db);
  const pf = insProj('town-center', FROM, 55);
  insTenant(pf, 'town-center', FROM, { key: 'alpha', area: 500, units: 5, leases: 5, buildings: ['1'], rank: 1 });
  insTenant(pf, 'town-center', FROM, { key: 'beta', area: 300, units: 3, leases: 3, buildings: ['2'], rank: 2 });
  insTenant(pf, 'town-center', FROM, { key: 'gamma', area: 200, units: 2, leases: 2, buildings: ['1'], rank: 3 });
  const pt = insProj('town-center', TO, 45); // low occupancy → insight
  insTenant(pt, 'town-center', TO, { key: 'alpha', area: 700, units: 6, leases: 6, buildings: ['1'], rank: 1 }); // expansion
  insTenant(pt, 'town-center', TO, { key: 'beta', area: 100, units: 1, leases: 1, buildings: ['2'], rank: 3 });  // contraction
  insTenant(pt, 'town-center', TO, { key: 'delta', area: 400, units: 4, leases: 4, buildings: ['3'], rank: 2 }); // entry (gamma exits)
  const { app } = require('../../server/server');
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  port = server.address().port;
});
after(() => { try { if (server) server.close(); } catch (_) {} try { closeDatabase(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(TMP_DB + s); } catch (_) {} });

// ── identity ──
test('identity is normalized-name / low confidence; nothing fabricated', () => {
  const id = tenant.tenantIdentityModel();
  assert.strictEqual(id.identityMethod, 'normalized-name'); assert.strictEqual(id.identityConfidence, 'low'); assert.strictEqual(id.sourceTenantId, null);
});

// ── portfolio ──
test('portfolio: counts + leased area; rent unavailable', () => {
  const p = tenant.buildPortfolio(db, { projectKey: 'town-center', date: TO });
  assert.strictEqual(p.aggregatedTenantCount, 3);
  assert.strictEqual(p.leasedArea, 1200); assert.strictEqual(p.leaseRowCount, 11); assert.strictEqual(p.unitCount, 11);
  assert.strictEqual(p.buildingCount, 3); assert.strictEqual(p.annualRent, null); assert.strictEqual(p.completeness.rentAvailable, false);
});

// ── concentration (Top-N + HHI) ──
test('concentration by area: top-N shares + HHI; rent dimension unavailable', () => {
  const c = tenant.computeConcentration(db, { projectKey: 'town-center', date: TO, dimension: 'area' });
  assert.strictEqual(c.available, true);
  assert.strictEqual(c.top1SharePercent, round2(700 / 1200 * 100)); // 58.33
  assert.strictEqual(c.top3SharePercent, 100);
  assert.ok(c.hhiPoints > 2500); // concentrated
  assert.strictEqual(c.coverage.tenantsCounted, 3);
  const rent = tenant.computeConcentration(db, { projectKey: 'town-center', date: TO, dimension: 'rent' });
  assert.strictEqual(rent.available, false); assert.strictEqual(rent.reason, 'RENT_NOT_CAPTURED');
});
function round2(n) { return Math.round(n * 100) / 100; }

// ── lease exposure (unavailable — expiry not captured; never uses today) ──
test('lease exposure: unavailable + missingExpiryCount = all leases', () => {
  const e = tenant.computeLeaseExposure(db, { projectKey: 'town-center', date: TO });
  assert.strictEqual(e.available, false); assert.strictEqual(e.reason, 'LEASE_EXPIRY_NOT_CAPTURED');
  assert.strictEqual(e.missingExpiryCount, 11);
  assert.ok(e.buckets.find((b) => b.bucket === 'unknown').leaseCount === 11);
});

// ── movement (low confidence; expansion/contraction/entry/exit; no rename inference) ──
test('movement: possible retained/entry/exit + expansion/contraction; possibleRename empty', () => {
  const m = movement.computeMovement(db, { projectKey: 'town-center', from: FROM, to: TO });
  assert.strictEqual(m.identityConfidence, 'low');
  assert.deepStrictEqual(m.counts, { possibleRetained: 2, possibleEntry: 1, possibleExit: 1, possibleRename: 0 });
  const alpha = m.possibleRetained.find((t) => t.tenantKey === 'alpha');
  const beta = m.possibleRetained.find((t) => t.tenantKey === 'beta');
  assert.strictEqual(alpha.leasedArea.absolute, 200); assert.strictEqual(alpha.movementType, 'expansion');
  assert.strictEqual(beta.leasedArea.absolute, -200); assert.strictEqual(beta.movementType, 'contraction');
  assert.strictEqual(m.possibleEntry[0].tenantKey, 'delta');
  assert.strictEqual(m.possibleExit[0].tenantKey, 'gamma');
});

// ── insight rules (deterministic + suppression) ──
test('insights: concentration.high + occupancy.critical-low + vacancy.high + data-quality; severity filter', () => {
  const ctx = {
    occupancy: { latest: { date: TO, value: 45, snapshotId: 's1' } },
    concentration: { available: true, dimension: 'area', top1SharePercent: 58.33, hhiPoints: 4583 },
    movement: { counts: { possibleExit: 1, possibleEntry: 1 }, from: FROM, to: TO },
    dataQuality: { rentAvailable: false, exposureAvailable: false, identityConfidence: 'low' },
  };
  const all = evaluateInsights(ctx);
  const keys = all.map((i) => i.ruleKey);
  assert.ok(keys.includes('concentration.high') && keys.includes('occupancy.critical-low') && keys.includes('vacancy.high'));
  assert.ok(keys.includes('data-quality.rent-unavailable') && keys.includes('data-quality.lease-expiry-unavailable'));
  assert.ok(all.every((i) => i.ruleKey && i.category && i.severity && i.thresholds && i.evidence));
  // Phase 9.3: every insight carries deterministic display text so the frontend renders it verbatim.
  assert.ok(all.every((i) => typeof i.title === 'string' && i.title.length > 0 && typeof i.message === 'string' && i.message.length > 0));
  const warningsOnly = evaluateInsights(ctx, { severity: 'warning' });
  assert.ok(warningsOnly.length > 0 && warningsOnly.every((i) => i.severity === 'warning'));
});

// ── executive summary (composition) ──
test('executive summary composes all services', () => {
  const s = exec.buildExecutiveSummary(db, { projectKey: 'town-center' });
  assert.strictEqual(s.latestDate, TO); assert.strictEqual(s.snapshotDateCount, 2);
  assert.ok(s.portfolio && s.concentration.available && s.leaseExposure.available === false && s.movement.counts && Array.isArray(s.insights));
  assert.strictEqual(s.comparison.change.absolute, -10); // occupancy 55 → 45
});

// ── HTTP endpoints ──
test('HTTP: 6 analytics endpoints + validation + no-writes', async () => {
  assert.strictEqual((await get('/api/history/tenants/portfolio?project=town-center&date=' + TO)).status, 200);
  const con = await get('/api/history/tenants/concentration?project=town-center&date=' + TO);
  assert.strictEqual(con.status, 200); assert.ok(con.json.data.hhiPoints > 2500);
  assert.strictEqual((await get('/api/history/tenants/lease-exposure?project=town-center&date=' + TO)).json.data.available, false);
  const mv = await get('/api/history/tenants/movements?project=town-center&from=' + FROM + '&to=' + TO);
  assert.strictEqual(mv.json.data.counts.possibleEntry, 1);
  assert.strictEqual((await get('/api/history/insights?project=town-center')).status, 200);
  assert.strictEqual((await get('/api/history/executive-summary?project=town-center')).status, 200);
  // validation
  assert.strictEqual((await get('/api/history/tenants/portfolio')).status, 400); // missing project
  assert.strictEqual((await get('/api/history/tenants/portfolio?project=town-center&date=2020-01-01')).status, 404); // no snapshot
  assert.strictEqual((await get('/api/history/tenants/concentration?project=town-center&date=' + TO + '&dimension=bogus')).status, 400);
  assert.strictEqual((await get('/api/history/insights?project=town-center&severity=nope')).status, 400);
  // no writes from GET
  const before = db.prepare('SELECT COUNT(*) n FROM historical_tenant_snapshots').get().n;
  await get('/api/history/executive-summary?project=town-center');
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM historical_tenant_snapshots').get().n, before);
});
