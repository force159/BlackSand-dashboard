'use strict';
/**
 * Phase 3 API no-data test: a migrated-but-UNSEEDED database must return a controlled
 * 503 with no fabricated data (never fake projects). Uses its own temp DB.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-api-nodata-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { app } = require('../../server/server');

let server, base;

before(async () => {
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  resetForReinit();
  const db = initializeDatabase();
  runMigrations(db); // migrate only — NO seed
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  try { closeDatabase(); } catch (_) {}
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
});

test('empty DB → /api/dashboard 503 with no fabricated projects', async () => {
  const r = await fetch(`${base}/api/dashboard`);
  assert.strictEqual(r.status, 503);
  const body = await r.json();
  assert.strictEqual(body.error, 'no-data');
  assert.ok(!body.data, 'must not include a data block with fake projects');
  assert.ok(body.meta && 'checkedAt' in body.meta);
});

test('empty DB → /api/sync/status still responds 200 with null provenance', async () => {
  const r = await fetch(`${base}/api/sync/status`);
  assert.strictEqual(r.status, 200);
  const body = await r.json();
  assert.strictEqual(body.data.lastSuccessfulSync, null);
  assert.strictEqual(body.data.syncInProgress, false);
});
