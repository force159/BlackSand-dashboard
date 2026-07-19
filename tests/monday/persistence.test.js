'use strict';
/**
 * Monday persistence tests — atomic writes on a TEMP database. Verifies insert/update/
 * soft-delete via the diff, idempotency, transaction rollback preserving prior state,
 * and that source='seed' rows are never touched.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-monday-persist-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const M = require('../../server/monday');

let db;
const now = '2026-07-15T00:00:00.000Z';

function model(leases) {
  return { source: 'monday', projects: [{ slug: 'business-address', name: 'Business Address', address: 'Addr', externalId: 'BID', categories: [{ code: 'retail', label: 'Retail', totalArea: 0, occupancySource: 'leases', explicitLeasedPct: null, sortOrder: 0 }, { code: 'office', label: 'Offices', totalArea: 0, occupancySource: 'leases', explicitLeasedPct: null, sortOrder: 1 }], buildings: [], leases }] };
}
const lease = (id, area, extra = {}) => ({ externalId: id, categoryCode: 'retail', tenantName: 'T' + id, tenantType: null, area, leaseDate: null, status: 'active', isActive: 1, logoPath: null, sourceUpdatedAt: null, ...extra });
const countMonday = () => db.prepare("SELECT COUNT(*) n FROM leases WHERE source='monday' AND is_active=1").get().n;
const countSeed = () => db.prepare("SELECT COUNT(*) n FROM leases WHERE source='seed'").get().n;

before(() => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit();
  db = initializeDatabase();
  runMigrations(db);
  // Plant a source='seed' project + lease that Monday must never touch.
  db.prepare("INSERT INTO projects(slug,name,is_active,source,created_at,updated_at) VALUES ('seed-proj','Seed',1,'seed',?,?)").run(now, now);
  const sp = db.prepare("SELECT id FROM projects WHERE slug='seed-proj'").get().id;
  db.prepare("INSERT INTO leases(project_id,tenant_name,area,source,is_active,created_at,updated_at) VALUES (?,?,?,'seed',1,?,?)").run(sp, 'SeedTenant', 42, now, now);
});
after(() => {
  try { closeDatabase(); } catch (_) {}
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
});

test('first write inserts monday leases; seed rows untouched', () => {
  const r = M.persistence.writeMondayDataset(db, model([lease('1', 5), lease('2', 9)]), { now });
  assert.strictEqual(r.totals.inserted, 2);
  assert.strictEqual(countMonday(), 2);
  assert.strictEqual(countSeed(), 1);
});

test('identical rewrite is idempotent (unchanged, no writes)', () => {
  const r = M.persistence.writeMondayDataset(db, model([lease('1', 5), lease('2', 9)]), { now });
  assert.strictEqual(r.totals.unchanged, 2);
  assert.strictEqual(r.totals.changed, 0);
  assert.strictEqual(countMonday(), 2);
});

test('changed area → update; removed lease → soft-delete', () => {
  const r = M.persistence.writeMondayDataset(db, model([lease('1', 999)]), { now });
  assert.strictEqual(r.totals.updated, 1);
  assert.strictEqual(r.totals.deleted, 1); // lease '2' missing → deactivated
  assert.strictEqual(countMonday(), 1);
  assert.strictEqual(countSeed(), 1);
});

test('invalid model (negative area) rolls back; prior state preserved', () => {
  const before = countMonday();
  assert.throws(() => M.persistence.writeMondayDataset(db, model([lease('1', 999), lease('BAD', -5)]), { now }), (e) => e.code === 'PERSISTENCE_ERROR');
  assert.strictEqual(countMonday(), before, 'no partial write survived the rollback');
  assert.strictEqual(countSeed(), 1);
});
