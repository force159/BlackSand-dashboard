'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Live mapping-drift validation (`npm run monday:mapping:validate-live`).
 * Fetches METADATA for each configured board and verifies every mapped column ID still
 * exists (tolerating title renames, since IDs are stable) and that types match. Fails
 * on a missing/replaced column ID. Does NOT fetch items, does NOT write SQLite. This is
 * a required gate before a Phase 7 production sync. Requires a token + real mapping.
 */

const M = require('../../server/monday');

async function main() {
  console.log('Monday live mapping-drift validation');
  console.log('='.repeat(52));
  const cfg = M.config.loadConfig();
  if (!cfg.hasApiKey) { console.error('✗ Monday token not configured (set MONDAY_API_KEY in .env).'); return 1; }
  if (!cfg.mapping || cfg.boardCount === 0) { console.error('✗ No real mapping (config/monday-mapping.json).'); return 1; }
  let transport;
  try { transport = M.createFetchTransport(cfg); } catch (e) { console.error('✗ ' + e.message); return 1; }
  const client = new M.MondayClient(cfg, { transport, logger: M.createLogger({ level: 'warn' }) });

  let problems = 0;
  for (const [boardId, b] of Object.entries(cfg.mapping.boards)) {
    if (b.enabled === false) continue;
    let board;
    try { board = await client.fetchBoardMeta(boardId); }
    catch (e) { console.error(`✗ board ${boardId}: ${e.code || 'ERROR'} — ${e.message}`); problems++; continue; }
    const byId = new Map((board.columns || []).map((c) => [c.id, c]));
    console.log(`\nBoard ${board.id} "${board.name}" (state ${board.state || 'n/a'})`);
    for (const [field, spec] of Object.entries(b.columns || {})) {
      if (!spec || !spec.id) continue;
      const live = byId.get(spec.id);
      if (!live) { console.log(`  ✗ ${field}: column id "${spec.id}" NOT found on the board`); problems++; }
      else if (spec.type && live.type !== spec.type) { console.log(`  ⚠ ${field}: type drift — mapping "${spec.type}" vs live "${live.type}" (id ok: "${live.title}")`); }
      else console.log(`  ✓ ${field}: "${live.title}" (${live.type})`);
    }
  }
  console.log(`\nResult: ${problems === 0 ? 'OK — mapping matches live boards' : `FAILED — ${problems} problem(s)`}`);
  return problems === 0 ? 0 : 1;
}
main().then((c) => { process.exitCode = c; });
