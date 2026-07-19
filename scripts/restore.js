'use strict';
/**
 * Phase 9.4A — SQLite restore. Replaces the live database with a backup file, safely.
 *
 * Usage:  node scripts/restore.js <backup-file> --confirm
 *
 * Safety:
 *   - STOP the server first (pm2 stop blacksand-dashboard). One process owns the DB.
 *   - The backup is validated (opens read-only, integrity_check = ok, has schema_migrations)
 *     BEFORE anything is overwritten.
 *   - The CURRENT database is itself backed up to data/backups/ before being replaced.
 *   - Stale -wal / -shm sidecars of the target are removed after the copy (the restored file
 *     is a standalone, checkpointed DB).
 *   - Refuses to run without --confirm.
 */
require('../server/config/load-env').loadEnv();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDatabaseConfig } = require('../server/config/database-config');

function fail(msg) { console.error(`FATAL: ${msg}`); process.exit(1); }

const src = process.argv[2];
const confirmed = process.argv.includes('--confirm');
if (!src || src.startsWith('--')) fail('usage: node scripts/restore.js <backup-file> --confirm');
const srcAbs = path.resolve(src);
if (!fs.existsSync(srcAbs)) fail(`backup file not found: ${srcAbs}`);

// Validate the backup before touching the live DB.
try {
  const b = new Database(srcAbs, { readonly: true, fileMustExist: true });
  try {
    const ok = b.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') fail(`backup failed integrity_check (${ok})`);
    const row = b.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    if (!row || row.n !== 1) fail('backup does not look like a dashboard database (no schema_migrations table)');
  } finally { b.close(); }
} catch (e) { fail(`cannot open backup as SQLite: ${e.message}`); }

const cfg = getDatabaseConfig();
if (!confirmed) {
  console.log('Restore preview (no changes made):');
  console.log(`  from backup : ${srcAbs}`);
  console.log(`  into        : ${cfg.displayPath}`);
  console.log('  STOP the server first, then re-run with --confirm to proceed.');
  process.exit(0);
}

// Safety-backup the current DB (if any) before overwriting.
if (fs.existsSync(cfg.dbPath)) {
  const dir = path.join(cfg.dbDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  const safety = path.join(dir, `pre-restore-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.db`);
  try { fs.copyFileSync(cfg.dbPath, safety); console.log(`  ✓ safety copy of current DB → ${safety}`); }
  catch (e) { fail(`could not create a safety copy of the current DB (${e.message}); aborting`); }
}

// Replace the live DB and clear stale sidecars.
try {
  fs.copyFileSync(srcAbs, cfg.dbPath);
  for (const sfx of ['-wal', '-shm']) { const s = cfg.dbPath + sfx; if (fs.existsSync(s)) { try { fs.unlinkSync(s); } catch (_) {} } }
} catch (e) { fail(`restore copy failed (${e.message})`); }

// Verify the restored live DB.
const v = new Database(cfg.dbPath, { readonly: true, fileMustExist: true });
try {
  const ok = v.pragma('integrity_check', { simple: true });
  if (ok !== 'ok') fail(`restored database failed integrity_check (${ok})`);
} finally { v.close(); }

console.log(`✓ restored ${cfg.displayPath} from ${path.basename(srcAbs)} — start the server to resume.`);
