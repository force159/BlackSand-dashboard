'use strict';
/**
 * BlackSand dashboard — seed coordinator (Phase 2).
 *
 * Orchestrates the atomic seed operation against an ALREADY-OPEN, ALREADY-MIGRATED
 * database. It does NOT contain frontend scraping, Monday code, or KPI math — it
 * loads reviewed seed data, normalizes, validates, and writes inside ONE transaction.
 *
 * Write strategy (simplest safe deterministic option):
 *   - projects / categories / buildings: upsert by natural key (stable ids), then
 *     delete-obsolete scoped to seed rows;
 *   - building departments: delete-then-insert per building;
 *   - leases: delete all source='seed' rows for the project, then insert fresh with a
 *     deterministic source_record_key.
 *   Only source='seed' rows are ever touched — source='monday' is never affected.
 *
 * On any DB error the transaction rolls back (previous state preserved) and a
 * best-effort failed sync_run is recorded outside the transaction.
 */

const path = require('path');

const projectsRepo = require('../db/repositories/projects-repository');
const categoriesRepo = require('../db/repositories/categories-repository');
const buildingsRepo = require('../db/repositories/buildings-repository');
const leasesRepo = require('../db/repositories/leases-repository');
const deptRepo = require('../db/repositories/building-departments-repository');
const syncRepo = require('../db/repositories/sync-runs-repository');

const { normalizeSeedData } = require('./normalize-seed-data');
const { validateSeedData } = require('./validate-seed-data');
const { computeDataVersion } = require('./data-version');

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Prepare (normalize + validate + hash) without writing. Pure/read-only (logo check
 * touches the filesystem read-only). Used by both the seed and inspect commands.
 */
function prepareSeed(rawSeed, options = {}) {
  const raw = rawSeed || require('./current-dashboard-data');
  const projectRoot = options.projectRoot || DEFAULT_ROOT;
  const normalized = normalizeSeedData(raw);
  const validation = validateSeedData(normalized, { projectRoot, checkLogos: options.checkLogos !== false });
  const dataVersion = computeDataVersion(normalized);
  return { normalized, validation, dataVersion };
}

/**
 * Execute the seed against an open db. Returns a result object; never throws for a
 * validation failure (returns ok:false). Throws only for truly unexpected states.
 */
function seedDatabase(db, options = {}) {
  const now = options.now || new Date().toISOString();
  const log = options.log || (() => {});
  const projectRoot = options.projectRoot || DEFAULT_ROOT;

  const { normalized, validation, dataVersion } = prepareSeed(options.rawSeed, { projectRoot, checkLogos: options.checkLogos !== false });

  if (validation.errors.length > 0) {
    return { ok: false, phase: 'validation', validation, dataVersion, normalized };
  }

  const counts = {
    projectsUpserted: 0, categoriesUpserted: 0, buildingsUpserted: 0,
    departmentsInserted: 0, leasesInserted: 0, seedLeasesDeleted: 0,
    obsoleteProjects: 0, obsoleteCategories: 0, obsoleteBuildings: 0,
  };

  // last_data_change_at policy (documented in CLAUDE.md §24): reuse the prior value
  // when the canonical data is unchanged; advance only when the dataVersion changes.
  const prev = syncRepo.getLatestSuccessfulSeed(db);
  const startedAt = now;
  const t0 = Date.now();

  try {
    const runSeed = db.transaction(() => {
      const activeSlugs = normalized.projects.map((p) => p.slug);

      for (const p of normalized.projects) {
        const projectId = projectsRepo.upsertSeedProject(db, p, now);
        counts.projectsUpserted++;

        const catIdByCode = {};
        for (const c of p.categories) {
          catIdByCode[c.code] = categoriesRepo.upsertSeedCategory(db, projectId, c, now);
          counts.categoriesUpserted++;
        }
        counts.obsoleteCategories += categoriesRepo.deleteObsoleteCategories(db, projectId, p.categories.map((c) => c.code));

        for (const b of p.buildings) {
          const buildingId = buildingsRepo.upsertSeedBuilding(db, projectId, b, now);
          counts.buildingsUpserted++;
          deptRepo.deleteDepartmentsForBuilding(db, buildingId);
          for (const d of b.departments) {
            const categoryId = catIdByCode[d.categoryCode] ?? null;
            deptRepo.insertSeedDepartment(db, buildingId, categoryId, d, now);
            counts.departmentsInserted++;
          }
        }
        counts.obsoleteBuildings += buildingsRepo.deleteObsoleteSeedBuildings(db, projectId, p.buildings.map((b) => b.name));

        counts.seedLeasesDeleted += leasesRepo.deleteSeedLeasesForProject(db, projectId);
        for (const l of p.leases) {
          const categoryId = catIdByCode[l.categoryCode] ?? null;
          leasesRepo.insertSeedLease(db, { projectId, categoryId, buildingId: null }, l, now);
          counts.leasesInserted++;
        }
      }

      counts.obsoleteProjects += projectsRepo.deleteObsoleteSeedProjects(db, activeSlugs);

      const finishedAt = new Date().toISOString();
      const unchanged = prev && prev.data_version === dataVersion;
      const lastDataChangeAt = unchanged ? prev.last_data_change_at : finishedAt;
      const recordCount =
        counts.projectsUpserted + counts.categoriesUpserted + counts.buildingsUpserted +
        counts.departmentsInserted + counts.leasesInserted;

      const syncRunId = syncRepo.insertSyncRun(db, {
        source: 'seed',
        status: 'success',
        startedAt,
        finishedAt,
        lastDataChangeAt,
        dataVersion,
        recordCount,
        warningCount: validation.warnings.length,
        rejectedRowCount: 0,
        durationMs: Date.now() - t0,
        createdAt: finishedAt,
      });

      return { syncRunId, finishedAt, lastDataChangeAt, unchanged, recordCount };
    });

    const txResult = runSeed();
    log(`  ✓ seed transaction committed (sync_run #${txResult.syncRunId})`);
    return {
      ok: true,
      phase: 'committed',
      counts,
      dataVersion,
      validation,
      normalized,
      syncRunId: txResult.syncRunId,
      lastDataChangeAt: txResult.lastDataChangeAt,
      dataChanged: !txResult.unchanged,
      recordCount: txResult.recordCount,
    };
  } catch (err) {
    // Transaction rolled back — previous state preserved. Record a failed run best-effort.
    let failedRunId = null;
    try {
      const failedAt = new Date().toISOString();
      failedRunId = syncRepo.insertSyncRun(db, {
        source: 'seed',
        status: 'failed',
        startedAt,
        finishedAt: failedAt,
        lastDataChangeAt: prev ? prev.last_data_change_at : null,
        dataVersion,
        recordCount: 0,
        warningCount: validation.warnings.length,
        rejectedRowCount: 0,
        durationMs: Date.now() - t0,
        errorCode: 'SEED_TRANSACTION_FAILED',
        errorMessage: String(err.message).slice(0, 300),
        createdAt: failedAt,
      });
    } catch (_) { /* recording failure must not mask the original error */ }
    return { ok: false, phase: 'transaction', error: err, failedRunId, dataVersion, validation, normalized };
  }
}

module.exports = { prepareSeed, seedDatabase, DEFAULT_ROOT };
