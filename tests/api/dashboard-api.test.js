'use strict';
/**
 * Phase 3 API tests. Runs the Express app in-process on an ephemeral port against a
 * TEMPORARY seeded database (never the dev DB), set via SQLITE_DB_PATH before the
 * connection module loads.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-api-test-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { seedDatabase } = require('../../server/seed/seed-database');
const { app } = require('../../server/server');

let server, base, db;

before(async () => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit();
  db = initializeDatabase();
  runMigrations(db);
  seedDatabase(db, { now: '2026-07-15T00:00:00.000Z' });
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { closeDatabase(); } catch (_) {}
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
});

const getJson = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, headers: r.headers, body: await r.json() }; };

test('GET /api/dashboard returns 200 with two projects + meta', async () => {
  const { status, headers, body } = await getJson('/api/dashboard');
  assert.strictEqual(status, 200);
  assert.match(headers.get('cache-control'), /no-store/);
  assert.strictEqual(body.data.projects.length, 2);
  assert.ok(body.meta.dataVersion && typeof body.meta.dataVersion === 'string');
  assert.ok(!Number.isNaN(Date.parse(body.meta.checkedAt)));
  assert.strictEqual(body.meta.source, 'sqlite');
});

test('projects match the frontend-compatible shape', async () => {
  const { body } = await getJson('/api/dashboard');
  const ba = body.data.projects.find((p) => p.slug === 'business-address');
  assert.strictEqual(ba.project, 'Business Address');
  assert.strictEqual(ba.retail.gla, 1892);
  assert.strictEqual(ba.retail.tenants.length, 7);
  assert.strictEqual(ba.office.tenants.length, 9);
  assert.ok(Array.isArray(ba.buildings) && ba.buildings.length === 7);
  assert.strictEqual(ba.buildings[0].id, '1');
  assert.ok(ba.buildings[0].departments.retail);
});

test('canonical metrics reproduce the dashboard values', async () => {
  const { body } = await getJson('/api/dashboard');
  const ba = body.data.projects.find((p) => p.slug === 'business-address');
  const tc = body.data.projects.find((p) => p.slug === 'town-center');
  assert.strictEqual(ba.metrics.overallLeasedPct, '47.7');
  assert.strictEqual(ba.metrics.totalTenants, 16);
  assert.strictEqual(tc.metrics.totalTenants, 56);
  assert.strictEqual(tc.metrics.overallLeasedPct, '51.0');
  // Town Center explicit leasedPct preserved (not reconciled to lease sums).
  assert.strictEqual(tc.office.leasedPct, 0.69);
  assert.strictEqual(tc.retail.leasedPct, 0.40);
});

test('duplicate tenant names are preserved as separate rows', async () => {
  const { body } = await getJson('/api/dashboard');
  const ba = body.data.projects.find((p) => p.slug === 'business-address');
  const malaths = ba.office.tenants.filter((t) => t.name === 'Malath');
  assert.strictEqual(malaths.length, 7);
});

test('GET /api/dashboard/projects/:slug works and 404s on unknown', async () => {
  const good = await getJson('/api/dashboard/projects/town-center');
  assert.strictEqual(good.status, 200);
  assert.strictEqual(good.body.data.project.slug, 'town-center');
  const bad = await getJson('/api/dashboard/projects/nope');
  assert.strictEqual(bad.status, 404);
});

test('GET /api/sync/status returns provenance with syncInProgress=false', async () => {
  const { status, body } = await getJson('/api/sync/status');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.data.syncInProgress, false);
  assert.strictEqual(body.data.status, 'success');
  assert.ok(body.data.dataVersion);
});

test('unknown /api path returns 404', async () => {
  const r = await fetch(`${base}/api/nope`);
  assert.strictEqual(r.status, 404);
});

test('response leaks no database path or secret', async () => {
  const { body } = await getJson('/api/dashboard');
  const raw = JSON.stringify(body);
  assert.ok(!/dashboard\.db|SQLITE_DB_PATH|token/i.test(raw));
});

test('checkedAt advances between calls but dataVersion is stable', async () => {
  const a = await getJson('/api/dashboard');
  await new Promise((r) => setTimeout(r, 5));
  const b = await getJson('/api/dashboard');
  assert.strictEqual(a.body.meta.dataVersion, b.body.meta.dataVersion, 'dataVersion stable across reads');
  assert.notStrictEqual(a.body.meta.checkedAt, b.body.meta.checkedAt, 'checkedAt reflects each read');
});
