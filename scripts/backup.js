'use strict';
/**
 * Phase 9.4A — SQLite backup. Produces a consistent, standalone copy of the live database
 * (including committed WAL data) using better-sqlite3's online backup — safe to run while
 * the server is running. Writes to data/backups/dashboard-<UTC-timestamp>.db.
 *
 * Usage:  node scripts/backup.js            → data/backups/dashboard-YYYYMMDD-HHMMSS.db
 *         node scripts/backup.js --output /path/to/file.db
 *         BACKUP_KEEP=14 node scripts/backup.js   → prune to the newest 14 backups
 *
 * Restore with scripts/restore.js. See README "Backup & restore".
 */
require('../server/config/load-env').loadEnv();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDatabaseConfig } = require('../server/config/database-config');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function main() {
  const cfg = getDatabaseConfig();
  if (!fs.existsSync(cfg.dbPath)) { console.error(`FATAL: database not found at ${cfg.displayPath} — nothing to back up.`); process.exit(1); }

  const outArg = process.argv.indexOf('--output');
  let dest;
  if (outArg >= 0 && process.argv[outArg + 1]) {
    dest = path.resolve(process.argv[outArg + 1]);
  } else {
    const dir = path.join(cfg.dbDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    dest = path.join(dir, `dashboard-${stamp()}.db`);
  }

  const db = new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);               // consistent online snapshot
  } finally { db.close(); }

  // Verify the backup opens and passes an integrity check before declaring success.
  const check = new Database(dest, { readonly: true, fileMustExist: true });
  try {
    const ok = check.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw new Error('integrity_check returned: ' + ok);
    const v = check.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
    console.log(`✓ backup created: ${dest}`);
    console.log(`  size: ${(fs.statSync(dest).size / 1024).toFixed(1)} KB · schema v${v ? v.v : '?'} · integrity: ok`);
  } finally { check.close(); }

  // Optional retention (newest N) when BACKUP_KEEP is set and we used the default dir.
  const keep = Number(process.env.BACKUP_KEEP);
  if (Number.isInteger(keep) && keep > 0 && (outArg < 0)) {
    const dir = path.join(cfg.dbDir, 'backups');
    const files = fs.readdirSync(dir).filter((f) => /^dashboard-\d{8}-\d{6}\.db$/.test(f)).sort();
    const remove = files.slice(0, Math.max(0, files.length - keep));
    remove.forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); console.log(`  pruned old backup: ${f}`); } catch (_) {} });
  }
}

main().catch((e) => { console.error(`FATAL: backup failed — ${e.message}`); process.exit(1); });
