'use strict';
/** Phase 9.1A — historical migration/schema tests (temp DBs only). */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('../../server/db/migrations');
const { SCHEMA_VERSION } = require('../../server/db/schema');
const { validateSchema } = require('../../server/db/database-health');

const HIST_TABLES = ['historical_snapshot_runs', 'historical_project_snapshots', 'historical_building_snapshots', 'historical_tenant_snapshots'];
const tmp = () => path.join(os.tmpdir(), `bs-hist-mig-${process.pid}-${Math.floor(process.hrtime()[1])}.db`);
function open(file) { const db = new Database(file); db.pragma('foreign_keys = ON'); return db; }

test('fresh DB: all migrations apply; historical tables + indexes exist; FK on', () => {
  const f = tmp();
  try {
    const db = open(f);
    runMigrations(db);
    assert.strictEqual(db.prepare('SELECT MAX(version) v FROM schema_migrations').get().v, SCHEMA_VERSION);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    for (const t of HIST_TABLES) assert.ok(tables.has(t), 'missing ' + t);
    const idx = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name));
    for (const i of ['idx_hps_project_date', 'idx_hbs_parent', 'idx_hts_project_rank']) assert.ok(idx.has(i), 'missing index ' + i);
    assert.strictEqual(db.pragma('foreign_keys', { simple: true }), 1);
    // Structure check (independent of pragma policy like WAL, which the real connection sets).
    const v = validateSchema(db);
    assert.deepStrictEqual(v.missingTables, [], 'missing tables');
    assert.deepStrictEqual(v.missingColumns, {}, 'missing columns');
    assert.deepStrictEqual(v.missingIndexes, [], 'missing indexes');
    db.close();
  } finally { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {} }
});

test('re-running migrations is idempotent (no duplicate rows, applied ones skipped)', () => {
  const f = tmp();
  try {
    const db = open(f);
    const r1 = runMigrations(db);
    const r2 = runMigrations(db);
    assert.ok(r1.applied.length >= 1);
    assert.strictEqual(r2.applied.length, 0, 'second run should apply nothing');
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, SCHEMA_VERSION);
    // historical tables still present + empty
    for (const t of HIST_TABLES) assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM ' + t).get().n, 0);
    db.close();
  } finally { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {} }
});

test('existing pre-historical DB (v4) upgrades safely; existing data preserved', () => {
  const f = tmp();
  try {
    // Simulate a v1..v4 DB with a projects row already present.
    const db = open(f);
    const { MIGRATIONS } = require('../../server/db/migrations');
    // apply only migrations 1..4 by faking version 4 then running all (5 should apply)
    for (const m of MIGRATIONS.filter((x) => x.version <= 4)) {
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
      const done = db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(m.version);
      if (!done) { m.up(db); db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)').run(m.version, m.name, new Date().toISOString()); }
    }
    db.prepare("INSERT INTO projects (slug,name,is_active,source,current_data_source,created_at,updated_at) VALUES ('x','X',1,'monday','monday','t','t')").run();
    const before = db.prepare("SELECT COUNT(*) n FROM projects").get().n;
    // now upgrade → migration 5 applies
    const r = runMigrations(db);
    assert.deepStrictEqual(r.applied.map((a) => a.version), [5, 6]); // historical tables + execution lock
    assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM projects").get().n, before, 'existing data preserved');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    for (const t of HIST_TABLES) assert.ok(tables.has(t));
    db.close();
  } finally { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {} }
});

test('FK enforced: orphan building insert rejected', () => {
  const f = tmp();
  try {
    const db = open(f);
    runMigrations(db);
    assert.throws(() => db.prepare(
      "INSERT INTO historical_building_snapshots (project_snapshot_id,snapshot_id,project_key,business_date,building_key,created_at_utc) VALUES (99999,'s','p','2026-07-19','1','t')"
    ).run(), /FOREIGN KEY/);
    db.close();
  } finally { for (const s of ['', '-wal', '-shm']) try { fs.unlinkSync(f + s); } catch (_) {} }
});
