'use strict';
/**
 * Monday FIRST-CUTOVER integration (temp DB + offline fixtures). Proves the source-
 * ownership invariants end-to-end through the dashboard service: seed → first Monday
 * cutover → identical resync → failed resync → empty resync → collapse resync → seed
 * fallback. No network.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-monday-cutover-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const dashboard = require('../../server/services/dashboard-service');
const { setCurrentDataSource } = require('../../server/monday/persistence');
const M = require('../../server/monday');

let db;
const logger = M.createLogger({ level: 'error' });

// Monday mapping: one board → business-address (Town Center stays seed).
function mapping() {
  return { version: 1, boards: { BID_BA: {
    projectSlug: 'business-address', projectName: 'Business Address', address: 'Addr', itemGrain: 'lease', buildingSource: 'manual',
    categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1892 }, { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 11267 }],
    statusMap: { Active: 'active', Terminated: 'terminated' },
    columns: { tenantName: { id: 'cn', type: 'text' }, category: { id: 'cc', type: 'status', map: { Retail: 'retail', Offices: 'office' } }, area: { id: 'ca', type: 'numbers' }, status: { id: 'cs', type: 'status' } },
    safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 50 },
  } } };
}
function item(id, name, cat, area, status) { return { id, name, column_values: [{ id: 'cn', text: name }, { id: 'cc', type: 'status', text: cat }, { id: 'ca', type: 'numbers', text: String(area) }, { id: 'cs', type: 'status', text: status }] }; }
function raw(items) { return { BID_BA: { id: 'BID_BA', name: 'BA', complete: true, items } }; }
function cfg(over = {}) { return M.config.loadConfig({ env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false', ...over }, mappingObject: mapping() }); }

const baPayload = () => dashboard.buildDashboardPayload(db).body.data.projects.find((p) => p.slug === 'business-address');
const tcPayload = () => dashboard.buildDashboardPayload(db).body.data.projects.find((p) => p.slug === 'town-center');
const seedLeaseCount = () => db.prepare("SELECT COUNT(*) n FROM leases WHERE source='seed'").get().n;
const currentSource = (slug) => db.prepare('SELECT current_data_source s FROM projects WHERE slug=?').get(slug).s;

before(() => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit(); db = initializeDatabase(); runMigrations(db); seedDatabase(db, { now: '2026-07-15T00:00:00Z' });
});
after(() => { try { closeDatabase(); } catch (_) {} for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} } });

test('INITIAL: dashboard shows seed data; source=seed', () => {
  assert.strictEqual(currentSource('business-address'), 'seed');
  assert.strictEqual(baPayload().metrics.totalTenants, 16); // seed BA lease rows
});

let versionAfterCutover;
test('FIRST cutover: source→monday, only Monday leases shown, seed preserved, no doubling', async () => {
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw([item('m1', 'MRetail', 'Retail', 100, 'Active'), item('m2', 'MOffice', 'Offices', 200, 'Active')]) });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.cutover, true);
  assert.strictEqual(currentSource('business-address'), 'monday');
  const ba = baPayload();
  assert.strictEqual(ba.metrics.totalTenants, 2, 'only 2 Monday leases counted (no seed doubling)');
  assert.strictEqual(ba.retail.tenants.length + ba.office.tenants.length, 2);
  assert.ok(seedLeaseCount() >= 72, 'seed leases still stored');
  // Town Center untouched (still seed).
  assert.strictEqual(currentSource('town-center'), 'seed');
  assert.strictEqual(tcPayload().metrics.totalTenants, 56);
  versionAfterCutover = M.syncEngine.computeModelVersion; // sanity: fn exists
  assert.strictEqual(typeof r.dataVersion, 'string');
});

test('BUILDINGS: manual TABLES untouched by sync; PAYLOAD buildings now come from allocation (Phase 8)', () => {
  // The Monday lease cutover must NOT write/alter the manual buildings tables
  // (buildingSource='manual' — persistence never creates Monday buildings).
  const buildings = db.prepare("SELECT COUNT(*) n FROM buildings").get().n;
  const depts = db.prepare("SELECT COUNT(*) n FROM building_departments").get().n;
  assert.strictEqual(buildings, 14, 'manual buildings table unchanged');
  assert.strictEqual(depts, 25, 'manual departments table unchanged');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM buildings WHERE source='monday'").get().n === 0, 'no Monday-sourced buildings created');
  // Phase 8: for a Monday-authoritative project the PAYLOAD buildings are derived from the
  // unit→building ALLOCATION (Business Address → canonical 5), NOT the 7-row manual table.
  // (This fixture's unit codes 'MRetail'/'MOffice' don't match the BA lookup → the 5
  // canonical buildings render with zero inventory, but there are 5, not the manual 7.)
  assert.strictEqual(baPayload().buildings.length, 5, 'BA payload renders 5 allocated buildings, not the manual 7');
});

test('IDENTICAL resync: no_change, no rewrite', async () => {
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw([item('m1', 'MRetail', 'Retail', 100, 'Active'), item('m2', 'MOffice', 'Offices', 200, 'Active')]) });
  assert.strictEqual(r.status, 'no_change');
  assert.strictEqual(r.dataChanged, false);
  assert.strictEqual(baPayload().metrics.totalTenants, 2);
});

test('FAILED resync (incomplete fetch): rejected, Monday data preserved, source stays monday', async () => {
  const incomplete = raw([item('m1', 'MRetail', 'Retail', 100, 'Active')]);
  incomplete.BID_BA.complete = false; // simulate partial pagination
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: incomplete });
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(currentSource('business-address'), 'monday');
  assert.strictEqual(baPayload().metrics.totalTenants, 2, 'previous Monday data preserved');
});

test('EMPTY resync: rejected by safety, data preserved', async () => {
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw([]) });
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(r.reason, 'safety');
  assert.strictEqual(baPayload().metrics.totalTenants, 2);
});

test('COLLAPSE resync: >50% drop rejected, data preserved', async () => {
  // Grow to 4 leases first so a drop to 1 is a >50% collapse.
  await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw([item('m1', 'A', 'Retail', 10, 'Active'), item('m2', 'B', 'Retail', 10, 'Active'), item('m3', 'C', 'Retail', 10, 'Active'), item('m4', 'D', 'Retail', 10, 'Active')]) });
  assert.strictEqual(baPayload().metrics.totalTenants, 4);
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw([item('m1', 'A', 'Retail', 10, 'Active')]) });
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(baPayload().metrics.totalTenants, 4, 'collapse rejected; data preserved');
});

test('SEED FALLBACK: flipping source back to seed restores seed data (no data lost)', () => {
  const ba = db.prepare("SELECT id FROM projects WHERE slug='business-address'").get().id;
  setCurrentDataSource(db, ba, 'seed', '2026-07-15T09:00:00Z');
  assert.strictEqual(currentSource('business-address'), 'seed');
  assert.strictEqual(baPayload().metrics.totalTenants, 16, 'seed data recovered intact');
  // restore monday authority for cleanliness
  setCurrentDataSource(db, ba, 'monday', '2026-07-15T09:01:00Z');
});
