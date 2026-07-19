'use strict';
/**
 * BlackSand dashboard — database validation CLI (`npm run db:check`).
 *
 * Opens the database and VALIDATES the schema + pragmas WITHOUT applying any
 * migrations or writing anything. Prints a readable report, closes cleanly, and
 * exits 0 on success / non-zero on failure.
 *
 * If the schema is missing or out of date, this command reports the problem and
 * fails — it deliberately does NOT fix it. Run `npm run db:migrate` to create or
 * upgrade the schema.
 */

const { getDatabaseConfig } = require('../server/config/database-config');
const { initializeDatabase, closeDatabase } = require('../server/db/connection');
const { validateSchema, getRowCounts, listTables } = require('../server/db/database-health');
const { listAppliedMigrations } = require('../server/db/migrations');
const { SCHEMA_VERSION } = require('../server/db/schema');

function main() {
  console.log('BlackSand dashboard — database check');
  console.log('====================================');

  let db;
  try {
    const cfg = getDatabaseConfig();
    console.log(`Database: ${cfg.displayPath}`);

    db = initializeDatabase();

    const v = validateSchema(db);

    console.log('\nPragmas:');
    console.log(`  foreign_keys: ${v.foreignKeysEnabled ? 'ON' : 'OFF'}`);
    console.log(`  journal_mode: ${v.journalMode}`);

    console.log('\nSchema version:');
    console.log(`  current: ${v.schemaVersion}   expected: ${SCHEMA_VERSION}`);

    console.log('\nTables present:');
    listTables(db).sort().forEach((t) => console.log(`  · ${t}`));

    const applied = listAppliedMigrations(db);
    console.log('\nApplied migrations:');
    if (!applied.length) console.log('  (none)');
    applied.forEach((m) => console.log(`  ${m.version}  ${m.name}  (${m.applied_at})`));

    const counts = getRowCounts(db);
    console.log('\nRow counts:');
    Object.entries(counts).forEach(([t, n]) => console.log(`  ${t}: ${n}`));

    if (!v.valid) {
      console.error('\n✗ Validation FAILED:');
      if (v.missingTables.length) console.error(`  missing tables: ${v.missingTables.join(', ')}`);
      if (Object.keys(v.missingColumns).length) console.error(`  missing columns: ${JSON.stringify(v.missingColumns)}`);
      if (v.missingIndexes.length) console.error(`  missing indexes: ${v.missingIndexes.join(', ')}`);
      if (v.schemaVersion !== SCHEMA_VERSION) console.error(`  schema version mismatch (run: npm run db:migrate)`);
      if (v.errors.length) console.error(`  errors: ${v.errors.join('; ')}`);
      throw new Error('schema validation failed');
    }

    console.log('\nResult: OK — database is usable and schema is current.');
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
