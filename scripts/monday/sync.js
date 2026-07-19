'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Manual Monday sync (`npm run monday:sync -- --confirm`).
 *
 * CLI-ONLY. Performs a real Monday→SQLite synchronization (read-only against Monday;
 * writes SQLite atomically via the existing sync engine, with source cutover). It is
 * heavily GATED and refuses unless ALL of these hold:
 *   - MONDAY_SYNC_ENABLED=true
 *   - MONDAY_DRY_RUN=false  (a real write; use monday:dry-run to preview)
 *   - a token is configured
 *   - config/monday-mapping.json validates (production) + matches the live boards
 *   - the caller passes --confirm
 * Otherwise it prints the gate status (booleans only, no secrets) and exits non-zero.
 * There is NO LAN write endpoint — writes are CLI-only. One in-process run at a time.
 */

const M = require('../../server/monday');
const { initializeDatabase, closeDatabase } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { validateMapping } = require('../../server/monday/mapping-validator');

let running = false; // in-process single-run lock

async function main() {
  console.log('Monday manual sync (gated, CLI-only)');
  console.log('='.repeat(52));
  const confirm = process.argv.includes('--confirm');
  const cfg = M.config.loadConfig();
  const logger = M.createLogger({ level: cfg.logLevel });

  const gates = {
    'MONDAY_SYNC_ENABLED=true': cfg.syncEnabled === true,
    'MONDAY_DRY_RUN=false (real write)': cfg.dryRun === false,
    'token configured': cfg.hasApiKey,
    'mapping present': Boolean(cfg.mapping && cfg.boardCount > 0),
    '--confirm passed': confirm,
  };
  console.log('Gates:');
  for (const [k, v] of Object.entries(gates)) console.log(`  ${v ? '✓' : '✗'} ${k}`);
  if (!Object.values(gates).every(Boolean)) {
    console.error('\nSync refused: not all gates are open. This is intentional — a real Monday→SQLite write');
    console.error('requires MONDAY_SYNC_ENABLED=true, MONDAY_DRY_RUN=false, a token, a valid mapping, and --confirm.');
    console.error('Preview safely with: npm run monday:dry-run');
    return 2;
  }

  // Mapping must validate (production) and match the live boards before any write.
  const mv = validateMapping(cfg.mapping, { allowPlaceholders: false });
  if (!mv.ok) { console.error('\n✗ mapping invalid:'); mv.errors.forEach((e) => console.error('  ✗ ' + e)); return 1; }

  if (running) { console.error('✗ a sync is already running'); return 1; }
  running = true;
  const db = initializeDatabase();
  runMigrations(db);
  const client = new M.MondayClient(cfg, { transport: M.createFetchTransport(cfg), logger });
  try {
    console.log('\nSyncing (live read from Monday → atomic SQLite write + cutover)…');
    const r = await M.syncEngine.runSync({ db, config: cfg, client, logger });
    console.log('\n── Result ──');
    console.log('status:', r.status);
    if (r.status === 'success') {
      console.log(`changes: +${r.write.totals.inserted} ~${r.write.totals.updated} -${r.write.totals.deleted} =${r.write.totals.unchanged}`);
      console.log('cutover:', r.cutover ? 'YES → monday' : 'no');
      console.log('dataVersion:', String(r.dataVersion).slice(0, 16) + '…');
    } else if (r.status === 'no_change') {
      console.log('no change — dataVersion identical; nothing written');
    } else if (r.status === 'rejected') {
      // (post-sync capture is only attempted after a confirmed success/no_change below)
      console.log('rejected —', r.reason);
      (r.problems || (r.validation && r.validation.errors) || []).slice(0, 10).forEach((p) => console.log('  ✗ ' + p));
      return 1;
    } else if (r.status === 'skipped') {
      console.log('skipped —', r.reason);
      return 1;
    }
    // Post-sync historical capture (Phase 9.1B) — only after a CONFIRMED successful sync
    // (success/no_change), goes through the shared coordinator, and is ADVISORY: a snapshot
    // failure NEVER makes a successful sync report as failed.
    if (r.status === 'success' || r.status === 'no_change') {
      try {
        const { loadAutomationConfig } = require('../../server/history/automation/automation-config');
        const { capturePostSync } = require('../../server/history/automation/post-sync');
        const ps = await capturePostSync({ db, config: loadAutomationConfig(), logger, syncRunId: r.dataVersion ? String(r.dataVersion).slice(0, 16) : null });
        console.log('post-sync snapshot:', ps.status + (ps.decisionCode ? ' (' + ps.decisionCode + ')' : '') + (ps.summary ? ' created=' + ps.summary.created : ''));
      } catch (e) { console.warn('post-sync snapshot skipped (non-fatal):', e.message); }
    }
    return 0;
  } catch (e) {
    console.error('✗ sync failed:', e.code || 'ERROR', '—', e.message);
    return 1;
  } finally {
    running = false;
    try { closeDatabase(); } catch (_) {}
  }
}

main().then((c) => { process.exitCode = c; });
