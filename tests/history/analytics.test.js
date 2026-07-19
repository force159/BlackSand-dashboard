'use strict';
/** Phase 9.2A — comparison/series/trend analytics (deterministic; synthetic snapshot rows). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../server/db/migrations');
const { computeChange, direction } = require('../../server/history/analytics/change-math');
const cmp = require('../../server/history/analytics/comparison-service');
const ser = require('../../server/history/analytics/series-service');
const registry = require('../../server/history/analytics/metric-registry');

let db;
const f = path.join(os.tmpdir(), `bs-analytics-${process.pid}.db`);
let psid = 0;
function insProj(projectKey, date, { occ, leased }) {
  const r = db.prepare(`INSERT INTO historical_project_snapshots
    (snapshot_id, run_id, project_key, business_date, timezone, captured_at_utc, source_type, schema_version, calculation_version, occupancy_percent, leased_area, created_at_utc)
    VALUES (?,?,?,?, 'Asia/Riyadh', ?, 'monday', 1, 'v1', ?, ?, ?)`)
    .run('snap_' + (++psid), 'run_x', projectKey, date, date + 'T02:00:00Z', occ, leased, date + 'T02:00:00Z');
  return r.lastInsertRowid;
}
function insBld(parentId, projectKey, date, buildingKey, order, { occ }) {
  db.prepare(`INSERT INTO historical_building_snapshots
    (project_snapshot_id, snapshot_id, project_key, business_date, building_key, building_name, building_order, occupancy_percent, created_at_utc)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(parentId, 'snap_p', projectKey, date, buildingKey, 'Building ' + buildingKey, order, occ, date + 'T02:00:00Z');
}

before(() => {
  for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {}
  db = new Database(f); db.pragma('foreign_keys = ON'); runMigrations(db);
  // Town-center project: 3 dates, occupancy 50 → 55 → 60, leased 500 → 0 → 600.
  const p17 = insProj('town-center', '2026-07-17', { occ: 50, leased: 500 });
  const p18 = insProj('town-center', '2026-07-18', { occ: 55, leased: 0 });
  const p19 = insProj('town-center', '2026-07-19', { occ: 60, leased: 600 });
  insBld(p17, 'town-center', '2026-07-17', '1', 1, { occ: 40 });
  insBld(p19, 'town-center', '2026-07-19', '1', 1, { occ: 70 });
  insBld(p19, 'town-center', '2026-07-19', '2', 2, { occ: 80 }); // building 2 only on the later date (added)
  // a date with occupancy 0 for zero-baseline tests
  insProj('town-center', '2026-07-10', { occ: 0, leased: 0 });
});
after(() => { try { db.close(); } catch (_) {} for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {} });

// ── change math ──
test('change math: absolute + percent; zero-baseline rules; never NaN/Infinity', () => {
  assert.deepStrictEqual(computeChange(50, 60), { absolute: 10, percent: 20 });
  assert.deepStrictEqual(computeChange(60, 50), { absolute: -10, percent: round2(-16.67) }); // -10/60*100
  assert.deepStrictEqual(computeChange(0, 0), { absolute: 0, percent: 0 });         // 0 & 0 → 0%
  assert.deepStrictEqual(computeChange(0, 5), { absolute: 5, percent: null });      // 0 baseline, nonzero → null
  assert.deepStrictEqual(computeChange(null, 5), { absolute: null, percent: null });// missing side
  assert.deepStrictEqual(computeChange(5, null), { absolute: null, percent: null });
  assert.strictEqual(direction(10), 'up'); assert.strictEqual(direction(-1), 'down'); assert.strictEqual(direction(0), 'flat'); assert.strictEqual(direction(null), 'unknown');
});
function round2(n) { return Math.round(n * 100) / 100; }

// ── project comparison ──
test('project comparison: happy path', () => {
  const r = cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2026-07-17', to: '2026-07-19' });
  assert.strictEqual(r.baseline.value, 50); assert.strictEqual(r.comparison.value, 60);
  assert.strictEqual(r.change.absolute, 10); assert.strictEqual(r.change.percent, 20); assert.strictEqual(r.change.direction, 'up');
});
test('project comparison: same snapshot twice → zero change', () => {
  const r = cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2026-07-19', to: '2026-07-19' });
  assert.strictEqual(r.sameSelection, true); assert.strictEqual(r.change.absolute, 0); assert.strictEqual(r.change.direction, 'flat');
});
test('project comparison: missing snapshot → present false + null change (no fabrication)', () => {
  const r = cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2020-01-01', to: '2026-07-19' });
  assert.strictEqual(r.baseline.present, false); assert.strictEqual(r.baselineMissing, true);
  assert.strictEqual(r.change.absolute, null); assert.strictEqual(r.change.percent, null);
});
test('project comparison: zero baseline → percent null; leased 0→600', () => {
  const r = cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'leasedArea', from: '2026-07-18', to: '2026-07-19' });
  assert.strictEqual(r.baseline.value, 0); assert.strictEqual(r.change.absolute, 600); assert.strictEqual(r.change.percent, null);
});
test('project comparison: unsupported metric → error', () => {
  assert.throws(() => cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'bogus', from: '2026-07-17', to: '2026-07-19' }), /unsupported/);
});
test('selection policy latest-vs-previous / latest-vs-first', () => {
  const prev = cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'occupancyPercent', policy: 'latest-vs-previous' });
  assert.strictEqual(prev.from, '2026-07-18'); assert.strictEqual(prev.to, '2026-07-19');
  const first = cmp.compareProjectMetric(db, { projectKey: 'town-center', metric: 'occupancyPercent', policy: 'latest-vs-first' });
  assert.strictEqual(first.from, '2026-07-10'); assert.strictEqual(first.to, '2026-07-19');
});

// ── building comparison (batched; added/removed) ──
test('building comparison: added building flagged, change null; existing building computed', () => {
  const r = cmp.compareBuildings(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2026-07-17', to: '2026-07-19' });
  const b1 = r.buildings.find((b) => b.buildingKey === '1');
  const b2 = r.buildings.find((b) => b.buildingKey === '2');
  assert.strictEqual(b1.presence, 'both'); assert.strictEqual(b1.change.absolute, 30); // 40→70
  assert.strictEqual(b2.presence, 'added'); assert.strictEqual(b2.change.absolute, null);
});

// ── series + trend ──
test('series: sparse points across range', () => {
  const s = ser.projectSeries(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2026-07-17', to: '2026-07-19' });
  assert.deepStrictEqual(s.points.map((p) => p.date), ['2026-07-17', '2026-07-18', '2026-07-19']);
  assert.deepStrictEqual(s.points.map((p) => p.value), [50, 55, 60]);
});
test('trend: descriptive summary (first/last/min/max/avg/change/direction)', () => {
  const t = ser.projectTrend(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2026-07-17', to: '2026-07-19' });
  assert.strictEqual(t.summary.first.value, 50); assert.strictEqual(t.summary.last.value, 60);
  assert.strictEqual(t.summary.min.value, 50); assert.strictEqual(t.summary.max.value, 60);
  assert.strictEqual(t.summary.average, 55); assert.strictEqual(t.summary.change.absolute, 10); assert.strictEqual(t.summary.change.direction, 'up');
});
test('trend: empty series → null summary (no crash)', () => {
  const t = ser.projectTrend(db, { projectKey: 'town-center', metric: 'occupancyPercent', from: '2030-01-01', to: '2030-12-31' });
  assert.strictEqual(t.summary.valuedPointCount, 0); assert.strictEqual(t.summary.average, null); assert.strictEqual(t.summary.change.direction, 'unknown');
});

// ── registry ──
test('metric registry: project + building metric lists, safe column lookup', () => {
  assert.ok(registry.listMetrics('project').some((m) => m.key === 'occupancyPercent'));
  assert.strictEqual(registry.assertRegistryColumn('project', 'leasedArea'), 'leased_area');
  assert.throws(() => registry.assertRegistryColumn('project', 'bogus'), /unsupported metric/);
});
