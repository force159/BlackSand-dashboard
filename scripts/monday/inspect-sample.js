'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Read-only sample inspector (`npm run monday:inspect-sample -- <board-id> [n]`).
 * Fetches a TINY sample (default 3, max 5) of items and prints the STRUCTURAL shape of
 * their column values (id + type + a redacted preview) so you can see how each column
 * type is actually returned. Never writes SQLite, never creates sync records, never
 * saves raw payloads, redacts people/email/file/long text. Requires a token locally.
 */

const M = require('../../server/monday');
const { firstPageRequest } = require('../../server/monday/graphql');

const REDACT_TYPES = new Set(['people', 'email', 'phone', 'file', 'files', 'location']);
function preview(cv) {
  if (REDACT_TYPES.has(cv.type)) return '«redacted»';
  const t = cv.text == null ? '' : String(cv.text);
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

async function main() {
  const boardId = process.argv[2];
  if (!boardId || boardId.startsWith('--')) { console.error('Usage: npm run monday:inspect-sample -- <board-id> [count]'); return 1; }
  const n = Math.min(5, Math.max(1, Number(process.argv[3]) || 3));
  const cfg = M.config.loadConfig();
  if (!cfg.hasApiKey) { console.error('✗ Monday token not configured (set MONDAY_API_KEY in .env).'); return 1; }
  let transport;
  try { transport = M.createFetchTransport(cfg); } catch (e) { console.error('✗ ' + e.message); return 1; }
  const client = new M.MondayClient(cfg, { transport, logger: M.createLogger({ level: 'warn' }) });
  try {
    const req = firstPageRequest({ boardId, columnIds: null, limit: n });
    const data = await client.request(req.query, req.variables);
    const board = data.boards && data.boards[0];
    if (!board) { console.error('✗ board not found'); return 1; }
    const items = (board.items_page && board.items_page.items) || [];
    console.log(`Sample of ${items.length} item(s) from "${board.name}" (structure only, redacted):`);
    for (const it of items) {
      console.log(`\n  item ${it.id}  name="${String(it.name || '').slice(0, 40)}"`);
      for (const cv of it.column_values || []) console.log(`    ${cv.id}\t${cv.type}\t${preview(cv)}`);
    }
    console.log('\n(No data was written; no payload saved.)');
    return 0;
  } catch (e) { console.error(`✗ sample failed: ${e.code || 'ERROR'} — ${e.message}`); return 1; }
}
main().then((c) => { process.exitCode = c; });
