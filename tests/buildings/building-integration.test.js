'use strict';
/**
 * PHASE 8 (buildings) — end-to-end integration (temp DB + offline fixtures, no network).
 * Proves: after a Monday sync + cutover, GET-payload building data is LIVE (from unit
 * codes), Town Center outputs 7 buildings, Business Address outputs 5 (never 6/7),
 * C06/C07 are excluded, seed manual buildings are NOT used post-cutover, and the API
 * building SHAPE stays backward-compatible.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-buildings-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const dashboard = require('../../server/services/dashboard-service');
const M = require('../../server/monday');

let db;
const logger = M.createLogger({ level: 'error' });

// Two group-based boards (mirrors the real config: category from group, unit code = item name).
function mapping() {
  const board = (slug, name) => ({
    projectSlug: slug, projectName: name, address: 'Addr', itemGrain: 'lease', buildingSource: 'manual',
    categorySource: 'group', groupMap: { Retail: 'retail', Offices: 'office' },
    categories: [
      { code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1000 },
      { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 2000 },
    ],
    statusMap: { Leased: 'active', Vacant: 'terminated' },
    columns: { tenantName: { id: 'cn', type: 'text' }, area: { id: 'ca', type: 'numbers' }, status: { id: 'cs', type: 'status' } },
    safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 90 },
  });
  return { version: 1, boards: { BID_BA: board('business-address', 'Business Address'), BID_TC: board('town-center', 'Town Center') } };
}
// item name = UNIT CODE; group title = category; tenant column may be blank for vacant.
function item(unit, groupTitle, area, status, tenant) {
  return {
    id: 'it-' + unit, name: unit, group: { id: groupTitle, title: groupTitle },
    column_values: [{ id: 'cn', text: tenant || (status === 'Leased' ? 'T ' + unit : '') },
      { id: 'ca', type: 'numbers', text: String(area) }, { id: 'cs', type: 'status', text: status }],
  };
}
function raw(baItems, tcItems) {
  return {
    BID_BA: { id: 'BID_BA', name: 'BA', complete: true, items: baItems },
    BID_TC: { id: 'BID_TC', name: 'TC', complete: true, items: tcItems },
  };
}
function cfg() {
  return M.config.loadConfig({ env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: mapping() });
}

const payloadFor = (slug) => dashboard.buildDashboardPayload(db).body.data.projects.find((p) => p.slug === slug);

before(async () => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit(); db = initializeDatabase(); runMigrations(db); seedDatabase(db, { now: '2026-07-15T00:00:00Z' });

  const baItems = [
    item('S01', 'Offices', 100, 'Leased'),   // truth-guide retail but Monday office → allocated office, reported
    item('D101', 'Offices', 200, 'Leased'),  // Building 1 office
    item('R01', 'Retail', 50, 'Leased'),     // Building 2 retail
    item('C02', 'Retail', 30, 'Vacant'),     // Building 2 retail, vacant
    item('C06', 'Retail', 999, 'Leased'),    // EXCLUDED
    item('C07', 'Retail', 999, 'Vacant'),    // EXCLUDED
    item('R05', 'Retail', 70, 'Leased'),     // Building 5 retail
  ];
  const tcItems = [
    item('(A-GF-01)', 'Retail', 300, 'Leased'),  // Building 1
    item('(D-FF-01)', 'Offices', 400, 'Leased'), // Building 4
    item('(G-SF-10)', 'Offices', 500, 'Vacant'), // Building 7, vacant
  ];
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw(baItems, tcItems) });
  assert.strictEqual(r.status, 'success');
});
after(() => { try { closeDatabase(); } catch (_) {} for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} } });

test('48-49 API returns LIVE building values in the backward-compatible shape', () => {
  const ba = payloadFor('business-address');
  const b2 = ba.buildings.find((b) => b.id === '2');
  assert.ok(b2 && b2.departments && b2.departments.retail && b2.departments.offices, 'building shape preserved');
  assert.strictEqual(b2.departments.retail.total, 80);   // R01 50 + C02 30
  assert.strictEqual(b2.departments.retail.leased, 50);  // only R01 (C02 vacant)
  assert.strictEqual(b2.departments.retail.label, 'Retail');
});

test('51 Town Center outputs 7 buildings in order', () => {
  assert.deepStrictEqual(payloadFor('town-center').buildings.map((b) => b.id), ['1', '2', '3', '4', '5', '6', '7']);
});

test('52-53 Business Address outputs 5 buildings, never 6 or 7', () => {
  const ids = payloadFor('business-address').buildings.map((b) => b.id);
  assert.deepStrictEqual(ids, ['1', '2', '3', '4', '5']);
  assert.ok(!ids.includes('6') && !ids.includes('7'));
});

test('C06/C07 excluded from BA building totals (contribute nothing)', () => {
  const ba = payloadFor('business-address');
  const grandTotal = ba.buildings.reduce((s, b) => s + b.departments.retail.total + b.departments.offices.total, 0);
  // S01 100 + D101 200 + R01 50 + C02 30 + R05 70 = 450 ; C06/C07 (1998) excluded.
  assert.strictEqual(grandTotal, 450);
});

test('56 live mode uses allocation, NOT the manual seed buildings table', () => {
  // Seed BA had buildings named "1".."5","C-06","C-07" (7). Post-cutover we get exactly 5
  // numeric ids from allocation — proof the manual table is not used for a monday project.
  assert.strictEqual(payloadFor('business-address').buildings.length, 5);
  assert.strictEqual(payloadFor('town-center').buildings.length, 7);
});

test('TC live building values are correct (vacant counts toward total only)', () => {
  const tc = payloadFor('town-center');
  const b7 = tc.buildings.find((b) => b.id === '7');
  assert.strictEqual(b7.departments.offices.total, 500);  // (G-SF-10) vacant
  assert.strictEqual(b7.departments.offices.leased, 0);   // vacant → not leased
  const b1 = tc.buildings.find((b) => b.id === '1');
  assert.strictEqual(b1.departments.retail.total, 300);
  assert.strictEqual(b1.departments.retail.leased, 300);
});
