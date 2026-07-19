'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Monday dry-run (`npm run monday:dry-run`).
 *
 * Runs the FULL pipeline (map → validate → safety → transform → diff → candidate
 * dataVersion) and prints a report, performing ZERO database writes and ZERO source
 * cutover. If a token + real mapping are configured it fetches READ-ONLY live data;
 * otherwise it uses a committed sanitized offline fixture so the command always works
 * with no network. Never prints secrets.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../../server/monday');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'monday', 'fixtures', 'dry-run-sample.json');
const LIVE = require('../../server/monday').config.isConfigured(require('../../server/monday').config.loadConfig()) && process.env.MONDAY_DRYRUN_LIVE === 'true';
// OFFLINE dry-run runs against a throwaway EMPTY temp DB so it never compares the
// fixture against the live (possibly Monday-backed) dev DB. LIVE dry-run uses the real
// configured DB so its diff/safety preview reflects reality. Must be set BEFORE the
// connection module resolves the path.
const TMP_DB = path.join(os.tmpdir(), `bs-dryrun-${process.pid}.db`);
if (!LIVE) { process.env.SQLITE_DB_PATH = TMP_DB; }
const { initializeDatabase, closeDatabase } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');

async function main() {
  console.log('Monday dry-run (no writes, no cutover)');
  console.log('='.repeat(52));
  const live = LIVE;
  // LIVE path uses the REAL mapping + a read-only fetch. OFFLINE path always uses the
  // committed EXAMPLE mapping + fixture (self-contained; board IDs match the fixture),
  // so this stays green in `verify` regardless of whether a real mapping exists.
  let cfg;
  if (live) {
    cfg = M.config.loadConfig();
    if (!cfg.mapping) { console.error('✗ No real mapping (config/monday-mapping.json).'); return 1; }
  } else {
    const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'monday-mapping.example.json'), 'utf8'));
    cfg = M.config.loadConfig({ mappingObject: example });
    console.log('Offline dry-run using the committed example mapping + fixture (set MONDAY_DRYRUN_LIVE=true with a token for a live read-only dry-run).');
  }
  const logger = M.createLogger({ level: cfg.logLevel });
  const mv = require('../../server/monday/mapping-validator').validateMapping(cfg.mapping, { allowPlaceholders: !live });
  if (!mv.ok) { console.error('✗ Mapping invalid:'); mv.errors.forEach((e) => console.error('  ✗ ' + e)); return 1; }

  const db = initializeDatabase();
  runMigrations(db);

  let rawByBoard;
  if (live) {
    console.log('Fetching LIVE read-only data…');
    const client = new M.MondayClient(cfg, { transport: M.createFetchTransport(cfg), logger });
    rawByBoard = await M.syncEngine.downloadStage({ client, config: cfg, logger });
  } else {
    if (!fs.existsSync(FIXTURE)) { console.error('✗ No offline fixture found.'); closeDatabase(); return 1; }
    rawByBoard = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    delete rawByBoard._comment; // strip the human note; keep only board entries
  }

  const result = M.syncEngine.runPipeline(rawByBoard, { db, config: cfg, logger, dryRun: true });
  console.log('\n── Report ──');
  console.log('boards configured:', Object.keys(cfg.mapping.boards).length);
  if (result.status === 'rejected') {
    console.log('outcome: REJECTED —', result.reason);
    (result.problems || (result.validation && result.validation.errors) || []).slice(0, 10).forEach((p) => console.log('  ✗ ' + p));
    closeDatabase(); return 1;
  }
  const c = result.canonical || { projects: [], leases: [] };
  console.log('projects:', c.projects.length);
  for (const p of c.projects) {
    const leases = c.leases.filter((l) => l.projectSlug === p.slug);
    const active = leases.filter((l) => l.status === 'active');
    console.log(`  ▸ ${p.slug}: ${leases.length} leases (${active.length} active) · lease-area ${leases.reduce((a, l) => a + (Number.isFinite(l.area) ? l.area : 0), 0).toFixed(2)} m²`);
  }
  console.log('validation warnings:', result.validation.warnings.length);
  console.log('candidate dataVersion:', result.dataVersion.slice(0, 16) + '…');
  console.log('data changed vs current:', result.dataChanged);
  console.log('a real write would be allowed:', M.config.isConfigured(cfg) && cfg.syncEnabled === true && !cfg.dryRun, '(sync disabled/dry-run in Phase 6)');
  console.log('\nResult: OK — dry-run complete, ZERO database writes.');
  closeDatabase();
  return 0;
}

function cleanupTemp() {
  if (LIVE) return;
  try { closeDatabase(); } catch (_) {}
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
}
main().then((code) => { cleanupTemp(); process.exitCode = code; }).catch((e) => { console.error('✗ dry-run failed:', e.message); cleanupTemp(); process.exitCode = 1; });
