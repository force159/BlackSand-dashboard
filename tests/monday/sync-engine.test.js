'use strict';
/**
 * Monday sync-engine tests — pipeline behaviour on a TEMP database using offline
 * `rawByBoard` fixtures (no network). Covers: skip when disabled/not-configured,
 * dry-run, successful pipeline persist + metadata, and validation rejection.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `bs-monday-sync-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { initializeDatabase, closeDatabase, resetForReinit } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const syncRepo = require('../../server/db/repositories/sync-runs-repository');
const M = require('../../server/monday');

let db;
const logger = M.createLogger({ level: 'error' });

function mapping() {
  return { version: 1, boards: { BID: { projectSlug: 'business-address', projectName: 'Business Address', address: 'Addr', itemGrain: 'lease', statusOptional: true, categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1892 }], columns: { tenantName: { id: 'cn', type: 'text' }, category: { id: 'cc', type: 'status', map: { Retail: 'retail' } }, area: { id: 'ca', type: 'numbers' } } } } };
}
function raw(items) { return { BID: { id: 'BID', name: 'B', items } }; }
function item(id, name, cat, area) { return { id, name, column_values: [{ id: 'cn', type: 'text', text: name }, { id: 'cc', type: 'status', text: cat }, { id: 'ca', type: 'numbers', text: String(area) }] }; }

before(() => { for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} } resetForReinit(); db = initializeDatabase(); runMigrations(db); });
after(() => { try { closeDatabase(); } catch (_) {} for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} } });

test('runSync skips when not configured (no token) — no network', async () => {
  const cfg = M.config.loadConfig({ env: {}, mappingObject: mapping() });
  const r = await M.syncEngine.runSync({ db, config: cfg, client: new M.MondayClient(cfg), logger });
  assert.deepStrictEqual(r, { status: 'skipped', reason: 'not-configured' });
});

test('runSync skips when sync disabled (Phase 6 default) — no network', async () => {
  const cfg = M.config.loadConfig({ env: { MONDAY_API_KEY: 't' }, mappingObject: mapping() });
  const r = await M.syncEngine.runSync({ db, config: cfg, client: new M.MondayClient(cfg), logger });
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'sync-disabled');
});

test('runSync dry-run maps + validates but does not persist', async () => {
  const cfg = M.config.loadConfig({ env: { MONDAY_API_KEY: 't', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'true' }, mappingObject: mapping() });
  const r = await M.syncEngine.runSync({ db, config: cfg, logger, rawByBoard: raw([item('1', 'A', 'Retail', 5)]) });
  assert.strictEqual(r.status, 'dry-run');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM leases WHERE source='monday'").get().n, 0);
});

test('runPipeline persists valid data and records a success sync_run', async () => {
  const cfg = M.config.loadConfig({ env: { MONDAY_API_KEY: 't', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: mapping() });
  const r = await M.syncEngine.runSync({ db, config: cfg, logger, rawByBoard: raw([item('1', 'A', 'Retail', 5), item('2', 'B', 'Retail', 7)]) });
  assert.strictEqual(r.status, 'success');
  assert.strictEqual(r.write.totals.inserted, 2);
  const latest = syncRepo.getLatestSuccessful(db);
  assert.strictEqual(latest.source, 'monday');
  assert.ok(latest.data_version && latest.data_version.length === 64);
  // Second identical run: unchanged, same dataVersion, reused last_data_change_at.
  const r2 = await M.syncEngine.runSync({ db, config: cfg, logger, rawByBoard: raw([item('1', 'A', 'Retail', 5), item('2', 'B', 'Retail', 7)]) });
  assert.strictEqual(r2.dataChanged, false);
  assert.strictEqual(r2.dataVersion, r.dataVersion);
});

test('runPipeline rejects invalid data, records rejected run, persists nothing new', async () => {
  const cfg = M.config.loadConfig({ env: { MONDAY_API_KEY: 't', MONDAY_SYNC_ENABLED: 'true', MONDAY_DRY_RUN: 'false' }, mappingObject: mapping() });
  const before = db.prepare("SELECT COUNT(*) n FROM leases WHERE source='monday' AND is_active=1").get().n;
  const r = await M.syncEngine.runSync({ db, config: cfg, logger, rawByBoard: raw([item('1', 'A', 'Retail', -5)]) }); // negative area
  assert.strictEqual(r.status, 'rejected');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM leases WHERE source='monday' AND is_active=1").get().n, before);
  assert.strictEqual(syncRepo.getLatestRun(db).status, 'rejected');
});
