'use strict';
/**
 * BlackSand dashboard — seed-pipeline check CLI (`npm run db:seed:check`).
 *
 * Validates the SEED PIPELINE end-to-end against a FRESH TEMPORARY database (never the
 * live dev DB, which in Phase 7 may be Monday-backed): expected row counts (DERIVED
 * from the seed module), foreign-key integrity, all current-state rows source='seed',
 * correct slugs, the seed sync carries the current dataVersion, no duplicate seed keys,
 * no snapshot rows, no Monday rows. Uses a temp DB so it is independent of the live
 * database's current data source; cleans the temp files up afterward.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the DB layer at a throwaway temp file BEFORE the connection module resolves it.
const TMP_DB = path.join(os.tmpdir(), `bs-seedcheck-${process.pid}.db`);
process.env.SQLITE_DB_PATH = TMP_DB;

const { getDatabaseConfig } = require('../server/config/database-config');
const { initializeDatabase, closeDatabase } = require('../server/db/connection');
const { runMigrations } = require('../server/db/migrations');
const { prepareSeed, seedDatabase } = require('../server/seed/seed-database');
const projectsRepo = require('../server/db/repositories/projects-repository');
const categoriesRepo = require('../server/db/repositories/categories-repository');
const buildingsRepo = require('../server/db/repositories/buildings-repository');
const leasesRepo = require('../server/db/repositories/leases-repository');
const deptRepo = require('../server/db/repositories/building-departments-repository');
const syncRepo = require('../server/db/repositories/sync-runs-repository');

function main() {
  console.log('BlackSand dashboard — seeded database check (read-only)');
  console.log('=======================================================');

  let db;
  let pass = 0, fail = 0;
  const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
  const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };

  try {
    for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
    console.log('Database: (temporary, seed-pipeline check)\n');
    db = initializeDatabase();
    runMigrations(db);
    seedDatabase(db); // seed the throwaway DB, then validate it below

    // Expected counts derived from the seed module.
    const { normalized, dataVersion } = prepareSeed(null, {});
    const expected = {
      projects: normalized.projects.length,
      categories: normalized.projects.reduce((a, p) => a + p.categories.length, 0),
      leases: normalized.projects.reduce((a, p) => a + p.leases.length, 0),
      buildings: normalized.projects.reduce((a, p) => a + p.buildings.length, 0),
      departments: normalized.projects.reduce((a, p) => a + p.buildings.reduce((x, b) => x + b.departments.length, 0), 0),
    };

    const actual = {
      projects: projectsRepo.countProjects(db),
      categories: categoriesRepo.countCategories(db),
      leases: leasesRepo.countLeases(db),
      buildings: buildingsRepo.countBuildings(db),
      departments: deptRepo.countDepartments(db),
    };

    console.log('Row counts (expected vs actual):');
    for (const k of Object.keys(expected)) {
      (expected[k] === actual[k])
        ? ok(`${k}: ${actual[k]}`)
        : bad(`${k}: expected ${expected[k]}, got ${actual[k]}`);
    }

    console.log('\nIntegrity:');
    const fkViolations = db.pragma('foreign_key_check');
    fkViolations.length === 0 ? ok('foreign_key_check: no violations') : bad(`foreign_key_check: ${fkViolations.length} violation(s)`);

    // All current-state rows are source='seed' (tables that carry a source column).
    const nonSeedProjects = db.prepare("SELECT COUNT(*) n FROM projects WHERE source <> 'seed'").get().n;
    const nonSeedBuildings = db.prepare("SELECT COUNT(*) n FROM buildings WHERE source <> 'seed'").get().n;
    const nonSeedLeases = db.prepare("SELECT COUNT(*) n FROM leases WHERE source <> 'seed'").get().n;
    (nonSeedProjects + nonSeedBuildings + nonSeedLeases === 0)
      ? ok("all projects/buildings/leases have source='seed'")
      : bad(`non-seed rows present (projects ${nonSeedProjects}, buildings ${nonSeedBuildings}, leases ${nonSeedLeases})`);

    // No Monday-sourced rows.
    const mondayRows = leasesRepo.countLeasesBySource(db, 'monday')
      + db.prepare("SELECT COUNT(*) n FROM projects WHERE source = 'monday'").get().n;
    mondayRows === 0 ? ok('no source=\'monday\' rows') : bad(`${mondayRows} source='monday' row(s) present`);

    // Slugs correct.
    const dbSlugs = projectsRepo.listProjects(db).map((p) => p.slug).sort();
    const seedSlugs = normalized.projects.map((p) => p.slug).sort();
    JSON.stringify(dbSlugs) === JSON.stringify(seedSlugs)
      ? ok(`project slugs correct: ${dbSlugs.join(', ')}`)
      : bad(`slug mismatch: db=[${dbSlugs}] seed=[${seedSlugs}]`);

    // No duplicate seed source keys.
    const seedLeaseCount = leasesRepo.countLeasesBySource(db, 'seed');
    const distinctKeys = db.prepare("SELECT COUNT(DISTINCT source_record_key) n FROM leases WHERE source='seed' AND source_record_key IS NOT NULL").get().n;
    const nullKeys = db.prepare("SELECT COUNT(*) n FROM leases WHERE source='seed' AND source_record_key IS NULL").get().n;
    (distinctKeys === seedLeaseCount && nullKeys === 0)
      ? ok(`all ${seedLeaseCount} seed leases have unique non-null source_record_key`)
      : bad(`seed lease keys: distinct ${distinctKeys}, null ${nullKeys}, total ${seedLeaseCount}`);

    // dataVersion present in the latest successful seed sync.
    const latest = syncRepo.getLatestSuccessfulSeed(db);
    if (!latest) bad('no successful seed sync_run found');
    else if (latest.data_version === dataVersion) ok(`latest seed sync carries current dataVersion (${dataVersion.slice(0, 12)}…)`);
    else bad(`latest seed sync dataVersion ${String(latest.data_version).slice(0, 12)}… != current ${dataVersion.slice(0, 12)}…`);

    // No snapshot rows (Phase 2 must not create trends).
    const snaps = db.prepare('SELECT COUNT(*) n FROM dashboard_snapshots').get().n;
    snaps === 0 ? ok('no dashboard_snapshots rows (correct for Phase 2)') : bad(`${snaps} snapshot row(s) present`);

    // Reconcile lease-area sums with the seed module (per project/category).
    let reconOk = true;
    for (const p of normalized.projects) {
      const dbp = projectsRepo.findProjectBySlug(db, p.slug);
      const dbLeases = leasesRepo.listLeasesByProject(db, dbp.id);
      for (const c of p.categories) {
        const seedSum = p.leases.filter((l) => l.categoryCode === c.code).reduce((a, l) => a + l.area, 0);
        const cat = categoriesRepo.listCategoriesByProject(db, dbp.id).find((x) => x.code === c.code);
        const dbSum = dbLeases.filter((l) => l.category_id === cat.id).reduce((a, l) => a + l.area, 0);
        if (Math.abs(seedSum - dbSum) > 0.000001) { reconOk = false; bad(`${p.slug}/${c.code} lease-area sum mismatch: seed ${seedSum} vs db ${dbSum}`); }
      }
    }
    if (reconOk) ok('lease-area sums reconcile with the seed module (per project/category)');

    console.log(`\nResult: ${pass} passed, ${fail} failed`);
    return fail ? 1 : 0;
  } catch (err) {
    console.error(`\nResult: FAILED — ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  } finally {
    try { closeDatabase(); } catch (_) { /* ignore */ }
    for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
}

process.exit(main());
