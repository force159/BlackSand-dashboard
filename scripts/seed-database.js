'use strict';
/**
 * BlackSand dashboard — seed CLI (`npm run db:seed`).
 *
 * DEVELOPMENT / BOOTSTRAP seeding: migrates the current embedded dashboard data into
 * SQLite as source='seed' data. Repeatable and atomic. This does NOT touch the
 * frontend and does NOT connect to Monday.com.
 */

const { getDatabaseConfig } = require('../server/config/database-config');
const { initializeDatabase, closeDatabase } = require('../server/db/connection');
const { runMigrations } = require('../server/db/migrations');
const { seedDatabase } = require('../server/seed/seed-database');
const projectsRepo = require('../server/db/repositories/projects-repository');
const categoriesRepo = require('../server/db/repositories/categories-repository');
const leasesRepo = require('../server/db/repositories/leases-repository');

function main() {
  console.log('BlackSand dashboard — DEVELOPMENT / BOOTSTRAP seed');
  console.log('==================================================');
  console.log('Seeding the current embedded dashboard data into SQLite as source=\'seed\'.');
  console.log('This is bootstrap/demo data (NOT verified production truth, NOT Monday data).');

  let db;
  try {
    const cfg = getDatabaseConfig();
    console.log(`Database: ${cfg.displayPath}\n`);

    db = initializeDatabase();
    const mig = runMigrations(db, () => {});
    console.log(`Schema version: ${mig.toVersion}${mig.applied.length ? ` (${mig.applied.length} migration(s) applied now)` : ''}`);

    const result = seedDatabase(db, { log: (l) => console.log(l) });

    // Warnings (always printed — expected prototype behaviour is reported, not hidden)
    if (result.validation.warnings.length) {
      console.log(`\nWarnings (${result.validation.warnings.length}) — expected prototype behaviour, non-blocking:`);
      result.validation.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    }

    if (!result.ok) {
      if (result.phase === 'validation') {
        console.error(`\nBLOCKING ERRORS (${result.validation.errors.length}) — nothing was written:`);
        result.validation.errors.forEach((e) => console.error(`  ✗ ${e}`));
      } else {
        console.error(`\nSeed transaction FAILED (rolled back — previous state preserved): ${result.error.message}`);
        if (process.env.DEBUG) console.error(result.error.stack);
      }
      throw new Error('seed did not complete');
    }

    console.log('\nWrite counts:');
    Object.entries(result.counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

    // Per-project totals from the DB (read-only)
    console.log('\nProject totals (from SQLite):');
    for (const p of projectsRepo.listProjects(db)) {
      const cats = categoriesRepo.listCategoriesByProject(db, p.id);
      const leaseRows = leasesRepo.listLeasesByProject(db, p.id);
      console.log(`  ${p.slug}: ${cats.length} categories, ${leaseRows.length} lease rows`);
    }

    console.log(`\ndataVersion: ${result.dataVersion}`);
    console.log(`last_data_change_at: ${result.lastDataChangeAt}  (data ${result.dataChanged ? 'CHANGED' : 'unchanged'} vs previous seed)`);
    console.log('\nResult: OK — seed committed.');
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
