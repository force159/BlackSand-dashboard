'use strict';
/**
 * DB-level seed tests. Runs against a TEMPORARY database (never the dev DB), set via
 * SQLITE_DB_PATH before the connection module is required. node --test runs each file
 * in its own process, so this file owns a clean singleton connection.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the connection at a throwaway DB BEFORE requiring the connection module.
const TMP_DB = path.join(os.tmpdir(), `bs-seed-test-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const seedCoordinator = require('../../server/seed/seed-database');
const leasesRepo = require('../../server/db/repositories/leases-repository');
const projectsRepo = require('../../server/db/repositories/projects-repository');

const realSeed = require('../../server/seed/current-dashboard-data');
const clone = (o) => JSON.parse(JSON.stringify(o));

let db;

before(() => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit();
  db = initializeDatabase();
  runMigrations(db);
});

after(() => {
  try { closeDatabase(); } catch (_) {}
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
});

let firstVersion;

test('first seed writes expected rows', () => {
  const r = seedCoordinator.seedDatabase(db, { now: '2026-07-15T00:00:00.000Z' });
  assert.strictEqual(r.ok, true, JSON.stringify(r.validation && r.validation.errors));
  firstVersion = r.dataVersion;
  assert.strictEqual(leasesRepo.countLeases(db), 72);
  assert.strictEqual(projectsRepo.countProjects(db), 2);
});

test('second identical seed does not duplicate rows and keeps the same version', () => {
  const r = seedCoordinator.seedDatabase(db, { now: '2026-07-15T01:00:00.000Z' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.dataVersion, firstVersion, 'same data → same hash');
  assert.strictEqual(leasesRepo.countLeases(db), 72, 'no duplicates');
  assert.strictEqual(r.dataChanged, false, 'identical reseed is not a data change');
});

test('seed never touches source=monday rows', () => {
  const ba = projectsRepo.findProjectBySlug(db, 'business-address');
  db.prepare(
    `INSERT INTO leases (project_id, tenant_name, area, source, source_record_key, is_active, created_at, updated_at)
     VALUES (?, 'MONDAY TENANT', 42, 'monday', NULL, 1, ?, ?)`
  ).run(ba.id, '2026-07-15T00:00:00Z', '2026-07-15T00:00:00Z');

  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'monday'), 1);
  const r = seedCoordinator.seedDatabase(db, { now: '2026-07-15T02:00:00.000Z' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'monday'), 1, 'monday row survived reseed');
  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'seed'), 72, 'seed rows correct');
});

test('removing a lease from the fixture removes only that seed row (monday untouched)', () => {
  const fixture = clone(realSeed);
  // Drop the first Business Address retail lease (Tita).
  const ba = fixture.projects.find((p) => p.slug === 'business-address');
  const before = ba.leases.length;
  ba.leases = ba.leases.filter((l) => !(l.categoryCode === 'retail' && l.tenantName === 'Tita'));
  assert.strictEqual(ba.leases.length, before - 1);

  const r = seedCoordinator.seedDatabase(db, { rawSeed: fixture, now: '2026-07-15T03:00:00.000Z' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'seed'), 71, 'one seed lease removed');
  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'monday'), 1, 'monday row still present');
  assert.notStrictEqual(r.dataVersion, firstVersion, 'changed fixture → changed version');
});

test('transaction rollback preserves previous state on a mid-write failure', () => {
  const seedBefore = leasesRepo.countLeasesBySource(db, 'seed');
  const mondayBefore = leasesRepo.countLeasesBySource(db, 'monday');

  const original = leasesRepo.insertSeedLease;
  let calls = 0;
  leasesRepo.insertSeedLease = (...args) => { calls++; if (calls === 3) throw new Error('injected failure'); return original(...args); };
  try {
    const r = seedCoordinator.seedDatabase(db, { now: '2026-07-15T04:00:00.000Z' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.phase, 'transaction');
  } finally {
    leasesRepo.insertSeedLease = original;
  }

  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'seed'), seedBefore, 'seed rows unchanged after rollback');
  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'monday'), mondayBefore, 'monday rows unchanged after rollback');
});

test('re-seeding real data after tests restores the full 72 seed rows', () => {
  const r = seedCoordinator.seedDatabase(db, { now: '2026-07-15T05:00:00.000Z' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.dataVersion, firstVersion);
  assert.strictEqual(leasesRepo.countLeasesBySource(db, 'seed'), 72);
});
