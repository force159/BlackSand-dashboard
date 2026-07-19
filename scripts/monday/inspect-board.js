'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Read-only board inspector (`npm run monday:inspect-board -- <board-id>`).
 * Fetches board METADATA ONLY (name, state, groups, columns) so a non-coder can copy
 * the exact board/group/column IDs into the mapping. Never writes SQLite, never prints
 * the token, never dumps item data. Requires a token locally. Exits nonzero on error.
 */

const M = require('../../server/monday');

async function main() {
  const boardId = process.argv[2];
  if (!boardId || boardId.startsWith('--')) { console.error('Usage: npm run monday:inspect-board -- <board-id>'); return 1; }
  const cfg = M.config.loadConfig();
  if (!cfg.hasApiKey) { console.error('✗ Monday token not configured (set MONDAY_API_KEY in .env). This tool needs a token locally.'); return 1; }
  let transport;
  try { transport = M.createFetchTransport(cfg); } catch (e) { console.error('✗ ' + e.message); return 1; }
  const client = new M.MondayClient(cfg, { transport, logger: M.createLogger({ level: 'warn' }) });
  try {
    const board = await client.fetchBoardMeta(boardId);
    console.log(`Board: ${board.name}  (id ${board.id}, state ${board.state || 'n/a'})`);
    console.log('\nGroups:'); (board.groups || []).forEach((g) => console.log(`  ${g.id}\t${g.title}`));
    console.log('\nColumns (id  type  title):');
    (board.columns || []).forEach((c) => console.log(`  ${c.id}\t${c.type}\t${c.title}`));
    console.log('\nCopy the column IDs above into config/monday-mapping.json.');
    return 0;
  } catch (e) {
    console.error(`✗ inspect failed: ${e.code || 'ERROR'} — ${e.message}`);
    return 1;
  }
}
main().then((c) => { process.exitCode = c; });
