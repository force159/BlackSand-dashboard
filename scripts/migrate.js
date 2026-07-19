'use strict';
/**
 * BlackSand dashboard — database migration CLI (`npm run db:migrate`).
 *
 * Creates the database if missing, applies pending migrations, validates the
 * resulting schema, prints a concise summary, closes cleanly, and exits 0 on
 * success / non-zero on failure.
 *
 * This is the ONLY command that CREATES or UPGRADES the schema. `db:check`
 * validates without changing anything.
 */

const { getDatabaseConfig } = require('../server/config/database-config');
const { initializeDatabase, closeDatabase } = require('../server/db/connection');
const { runMigrations, listAppliedMigrations } = require('../server/db/migrations');
const { validateSchema, getRowCounts } = require('../server/db/database-health');

function main() {
  console.log('BlackSand dashboard — database migration');
  console.log('========================================');

  let db;
  try {
    const cfg = getDatabaseConfig();
    // Root-relative path only (no user-specific absolute path in normal output).
    console.log(`Database: ${cfg.displayPath}`);

    db = initializeDatabase();

    console.log('\nMigrations:');
    const summary = runMigrations(db, (line) => console.log(line));
    if (summary.applied.length === 0) {
      console.log('  (nothing to apply — already up to date)');
    }
    console.log(`  version ${summary.fromVersion} → ${summary.toVersion}`);

    console.log('\nValidating schema…');
    const v = validateSchema(db);
    if (!v.valid) {
      console.error('  ✗ schema validation FAILED after migration:');
      if (v.missingTables.length) console.error(`    missing tables: ${v.missingTables.join(', ')}`);
      if (Object.keys(v.missingColumns).length) console.error(`    missing columns: ${JSON.stringify(v.missingColumns)}`);
      if (v.missingIndexes.length) console.error(`    missing indexes: ${v.missingIndexes.join(', ')}`);
      if (v.errors.length) console.error(`    errors: ${v.errors.join('; ')}`);
      throw new Error('post-migration schema validation failed');
    }
    console.log(`  ✓ schema valid (version ${v.schemaVersion}, FK ${v.foreignKeysEnabled ? 'on' : 'off'}, journal ${v.journalMode})`);

    const applied = listAppliedMigrations(db);
    console.log('\nApplied migrations:');
    applied.forEach((m) => console.log(`  ${m.version}  ${m.name}  (${m.applied_at})`));

    // Phase 1: business tables must be empty (no seed data).
    const counts = getRowCounts(db);
    console.log('\nRow counts (expected 0 in Phase 1):');
    Object.entries(counts).forEach(([t, n]) => console.log(`  ${t}: ${n}`));

    console.log('\nResult: OK');
    return 0;
  } catch (err) {
    console.error(`\nResult: FAILED — ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  } finally {
    try { closeDatabase(); } catch (_) { /* ignore */ }
  }
}

process.exit(main());
