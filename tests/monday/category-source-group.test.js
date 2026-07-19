'use strict';
/**
 * REGRESSION (temp DB + offline fixtures, no network): guards the invariants that the
 * Business Address "Malath in Retail" investigation confirmed are load-bearing — the
 * live pipeline was CORRECT (it faithfully mirrored the board), so these lock in that
 * correctness rather than any tenant-specific value:
 *
 *   1. Category is derived from the Monday item GROUP (categorySource:'group') via the
 *      board groupMap — a unit's category follows the group it sits in on the board,
 *      by group id OR group title. (Why 2 units correctly landed in Retail.)
 *   2. The SAME tenant name may legitimately appear in BOTH categories; they stay in
 *      separate categories and are each counted once (never merged across categories,
 *      never double-counted).
 *   3. Non-active statuses (e.g. Vacant→terminated) are excluded from tenants + area.
 *   4. The dashboard reads ONLY leases WHERE source = current_data_source; seed rows are
 *      preserved in the DB but never mixed with Monday rows (no seed/Monday doubling).
 *   5. A sync keys leases on the stable Monday item id (external_id): re-syncing the same
 *      board produces NO duplicate external_id rows.
 *   6. An item in a group the board does not map is WARNED and excluded from BOTH
 *      categories (never silently mis-categorised into a default retail/office bucket);
 *      the previously-synced good data is unaffected.
 *
 * These assertions contain NO hardcoded tenant name or magic total — they use generic
 * fixtures and check structural behaviour only.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-monday-groupcat-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const dashboard = require('../../server/services/dashboard-service');
const M = require('../../server/monday');

let db;
const logger = M.createLogger({ level: 'error' });

// Board mirrors the real BA config shape: category comes from the GROUP, statusMap uses
// Leased→active / Vacant→terminated (as the live board does).
function mapping() {
  return {
    version: 1,
    boards: {
      BID_BA: {
        projectSlug: 'business-address', projectName: 'Business Address', address: 'Addr',
        itemGrain: 'lease', buildingSource: 'manual',
        categorySource: 'group',
        groupMap: { grp_retail: 'retail', Offices: 'office' }, // one mapped by id, one by title
        categories: [
          { code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1892 },
          { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 11267 },
        ],
        statusMap: { Leased: 'active', Vacant: 'terminated' },
        columns: {
          tenantName: { id: 'cn', type: 'text' },
          area: { id: 'ca', type: 'numbers' },
          status: { id: 'cs', type: 'status' },
        },
        safety: { allowEmpty: false, minAcceptedRecords: 1, maxRecordDropPercent: 90 },
      },
    },
  };
}
// group id + title both provided; groupMap resolves by id first, then title.
function item(id, name, groupId, groupTitle, area, status) {
  return {
    id, name, group: { id: groupId, title: groupTitle },
    column_values: [
      { id: 'cn', text: name },
      { id: 'ca', type: 'numbers', text: String(area) },
      { id: 'cs', type: 'status', text: status },
    ],
  };
}
function raw(items) { return { BID_BA: { id: 'BID_BA', name: 'BA', complete: true, items } }; }
function cfg() {
  return M.config.loadConfig({
    env: { MONDAY_API_KEY: 'x', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' },
    mappingObject: mapping(),
  });
}

const ba = () => dashboard.buildDashboardPayload(db).body.data.projects.find((p) => p.slug === 'business-address');
const seedLeaseCount = () => db.prepare("SELECT COUNT(*) n FROM leases WHERE source='seed'").get().n;
const externalIdDupes = () => db.prepare(
  "SELECT source, external_id, COUNT(*) n FROM leases WHERE external_id IS NOT NULL GROUP BY source, external_id HAVING n>1"
).all();

before(() => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit(); db = initializeDatabase(); runMigrations(db); seedDatabase(db, { now: '2026-07-15T00:00:00Z' });
});
after(() => {
  try { closeDatabase(); } catch (_) {}
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
});

// A representative board: one tenant appears in BOTH groups, plus a Vacant unit.
const boardItems = () => [
  item('r1', 'Acme', 'grp_retail', 'Retail', 100, 'Leased'), // retail by group id
  item('r2', 'Acme', 'grp_retail', 'Retail', 50, 'Leased'),  // same name, retail (2 units)
  item('o1', 'Acme', 'grp_office', 'Offices', 400, 'Leased'), // office by group title fallback
  item('o2', 'Acme', 'grp_office', 'Offices', 300, 'Leased'),
  item('o3', 'Acme', 'grp_office', 'Offices', 999, 'Vacant'),  // excluded (terminated)
  item('o4', 'Beta', 'grp_office', 'Offices', 200, 'Leased'),
];

test('1-3 group→category honored; same name split across categories; Vacant excluded', async () => {
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw(boardItems()) });
  assert.strictEqual(r.status, 'success');
  const p = ba();
  const retailAcme = p.retail.tenants.filter((t) => t.name === 'Acme');
  const officeAcme = p.office.tenants.filter((t) => t.name === 'Acme');
  // group id 'grp_retail' → retail; group title 'Offices' → office. Category follows group.
  assert.strictEqual(retailAcme.length, 2, 'both retail-group Acme units land in retail');
  assert.strictEqual(officeAcme.length, 2, 'active office-group Acme units land in office (Vacant excluded)');
  // Vacant unit is not present anywhere.
  assert.ok(!p.office.tenants.some((t) => Number(t.area) === 999), 'Vacant unit excluded from directory data');
  // Areas are NOT combined across categories (each lease counted once, in its own category).
  const retailSum = retailAcme.reduce((a, t) => a + Number(t.area), 0);
  const officeSum = officeAcme.reduce((a, t) => a + Number(t.area), 0);
  assert.strictEqual(retailSum, 150);
  assert.strictEqual(officeSum, 700);
  // tenant count = active lease rows (2 retail Acme + 2 office Acme + 1 Beta = 5), never merged.
  assert.strictEqual(p.metrics.totalTenants, 5);
});

test('4 dashboard reads ONLY source=current_data_source; seed preserved, not mixed', () => {
  assert.strictEqual(db.prepare('SELECT current_data_source s FROM projects WHERE slug=?').get('business-address').s, 'monday');
  assert.ok(seedLeaseCount() >= 72, 'seed leases preserved in DB');
  // If seed were mixed in, totalTenants would exceed the 5 active Monday leases.
  assert.strictEqual(ba().metrics.totalTenants, 5, 'no seed/Monday double-count');
});

test('5 re-sync of the same board produces NO duplicate external_id rows', async () => {
  const before = ba().metrics.totalTenants;
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw(boardItems()) });
  assert.ok(r.status === 'success' || r.status === 'no_change');
  assert.deepStrictEqual(externalIdDupes(), [], 'no duplicate (source, external_id) rows after resync');
  assert.strictEqual(ba().metrics.totalTenants, before, 'resync does not duplicate active leases');
});

test('6 an item in an UNMAPPED group is warned + excluded from both categories (not silently bucketed)', async () => {
  const withUnmapped = boardItems().concat([item('x1', 'Gamma', 'grp_unknown', 'Mystery', 10, 'Leased')]);
  const r = await M.syncEngine.runSync({ db, config: cfg(), logger, rawByBoard: raw(withUnmapped) });
  assert.ok(r.status === 'success' || r.status === 'no_change');
  // The unmapped-group item is flagged (never silently accepted without provenance)…
  assert.ok(r.validation.warnings.some((w) => /no category/i.test(w)), 'unmapped group produces a "no category" warning');
  const p = ba();
  // …and it is NOT dropped into retail or office (the real regression risk).
  assert.ok(!p.retail.tenants.some((t) => t.name === 'Gamma'), 'unmapped item not bucketed into retail');
  assert.ok(!p.office.tenants.some((t) => t.name === 'Gamma'), 'unmapped item not bucketed into office');
  // Mapped, good data is unaffected: still the same 5 active mapped leases.
  assert.strictEqual(p.metrics.totalTenants, 5);
});
