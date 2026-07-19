'use strict';
/**
 * Phase 9.1A — CLI process behavior (§25.7). Spawns the real script with a throwaway
 * SQLITE_DB_PATH: verifies exit codes, clean exit (no hang), JSON output, and that it
 * never starts Express or prints a server banner. Data-backed capture is covered by the
 * in-process engine tests; here we assert process semantics.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'history-snapshot.js');

function run(args, dbFile) {
  return cp.spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, SQLITE_DB_PATH: dbFile, MONDAY_SYNC_ENABLED: 'false' },
  });
}
function withTempDb(fn) {
  const f = path.join(os.tmpdir(), `bs-hist-cli-${process.pid}-${Math.floor(process.hrtime()[1])}.db`);
  try { return fn(f); } finally { for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(f + s); } catch (_) {} } }
}

test('invalid --project → exit 1, clear message, fast', () => withTempDb((db) => {
  const r = run(['--project', 'nope', '--dry-run'], db);
  assert.strictEqual(r.status, 1);
  assert.ok(/unsupported project/i.test(r.stderr + r.stdout));
  assert.strictEqual(r.signal, null, 'exited (not killed/hung)');
}));

test('dry-run --json → exit 0, valid JSON, writePerformed false, no server banner, no hang', () => withTempDb((db) => {
  const r = run(['--dry-run', '--json'], db);
  assert.strictEqual(r.signal, null, 'process exited on its own (no hang)');
  assert.strictEqual(r.status, 0, 'dry-run exits 0: ' + r.stderr);
  const out = JSON.parse(r.stdout);           // must be valid JSON
  assert.strictEqual(out.mode, 'dry-run');
  assert.ok(Array.isArray(out.results));
  assert.ok(!/listening|Local:|LAN|Express|:3000/.test(r.stdout + r.stderr), 'must not start/announce a server');
}));

test('--list → exit 0 and clean exit', () => withTempDb((db) => {
  const r = run(['--list'], db);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.signal, null);
  assert.ok(/Recent snapshots/i.test(r.stdout));
}));

test('unknown flag → exit 1', () => withTempDb((db) => {
  const r = run(['--frobnicate'], db);
  assert.strictEqual(r.status, 1);
  assert.ok(/unknown argument/i.test(r.stderr + r.stdout));
}));
