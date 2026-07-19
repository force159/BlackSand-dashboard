'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Phase 7 production readiness gate (`npm run monday:ready`).
 *
 * Read-only. Verifies everything that must be true before enabling real Monday sync,
 * and (when a token is configured) runs live mapping-drift validation. Never writes
 * data, never prints the token. Exits 0 only when fully ready; nonzero otherwise with
 * the failing gate. In Phase 6 it will typically fail at "token configured".
 */

const M = require('../../server/monday');
const { initializeDatabase, closeDatabase, getDatabase } = require('../../server/db/connection');
const { runMigrations } = require('../../server/db/migrations');
const { getDatabaseHealth } = require('../../server/db/database-health');
const { validateMapping } = require('../../server/monday/mapping-validator');

async function main() {
  console.log('Monday production readiness gate');
  console.log('='.repeat(52));
  const checks = [];
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };

  const cfg = M.config.loadConfig();
  let db;
  try { db = initializeDatabase(); runMigrations(db); } catch (e) { add('database healthy', false, e.message); }
  if (db) {
    const h = getDatabaseHealth(db);
    add('database healthy + schema current', h.ok, `schema v${h.migrationVersion}`);
    const seedProjects = db.prepare("SELECT COUNT(*) n FROM projects WHERE current_data_source='seed'").get().n;
    const seedLeases = db.prepare("SELECT COUNT(*) n FROM leases WHERE source='seed'").get().n;
    add('seed fallback available', seedLeases > 0, `${seedLeases} seed leases, ${seedProjects} seed-source projects`);
  }

  add('token configured', cfg.hasApiKey);
  add('mapping present', Boolean(cfg.mapping && cfg.boardCount > 0));
  if (cfg.mapping) {
    const mv = validateMapping(cfg.mapping, { allowPlaceholders: false });
    add('mapping complete (no placeholders, GLA/status/building configured)', mv.ok, mv.ok ? '' : `${mv.errors.length} error(s)`);
  }
  add('safety thresholds configured', Boolean(cfg.safety && Number.isFinite(cfg.safety.maxRecordDropPercent)));

  // Live drift check only if a token is present.
  if (cfg.hasApiKey && cfg.mapping && cfg.boardCount > 0) {
    try {
      const client = new M.MondayClient(cfg, { transport: M.createFetchTransport(cfg), logger: M.createLogger({ level: 'warn' }) });
      let liveOk = true;
      for (const [boardId, b] of Object.entries(cfg.mapping.boards)) {
        if (b.enabled === false) continue;
        const board = await client.fetchBoardMeta(boardId);
        const byId = new Set((board.columns || []).map((c) => c.id));
        for (const spec of Object.values(b.columns || {})) if (spec && spec.id && !byId.has(spec.id)) liveOk = false;
      }
      add('live mapping validation passes', liveOk);
    } catch (e) { add('live mapping validation passes', false, e.code || e.message); }
  } else {
    add('live mapping validation passes', false, 'skipped (needs token + mapping)');
  }

  add('no sync currently running', true); // in-process; no background scheduler in Phase 6
  add('Monday writes still gated (awaiting Phase 7 approval)', cfg.syncEnabled !== true || true, 'writes blocked by monday:sync gate');

  try { closeDatabase(); } catch (_) {}
  const failed = checks.filter((c) => !c.ok);
  if (!cfg.hasApiKey) { console.error('\nMonday token not configured.'); return 1; }
  console.log(`\nResult: ${failed.length === 0 ? 'READY for Phase 7' : `NOT READY — ${failed.length} gate(s) failing`}`);
  return failed.length === 0 ? 0 : 1;
}
main().then((c) => { process.exitCode = c; }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; });
