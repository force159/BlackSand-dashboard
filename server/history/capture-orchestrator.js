'use strict';
/**
 * Phase 9.1A — capture orchestrator (§16). Ties source → build → validate → duplicate →
 * persist (write mode) into one auditable run. Each project snapshot is independently
 * atomic; the run audit summarizes all outcomes (one project failing never destroys
 * another's valid snapshot). No scheduler, no Monday sync, no live-state mutation.
 */

const dashboardService = require('../services/dashboard-service');
const projectsRepo = require('../db/repositories/projects-repository');
const categoriesRepo = require('../db/repositories/categories-repository');
const leasesRepo = require('../db/repositories/leases-repository');
const { captureContext } = require('./riyadh-date');
const { evaluateSourceEligibility } = require('./eligibility');
const { buildProjectSnapshot } = require('./snapshot-builder');
const { validateProjectSnapshot } = require('./snapshot-validator');
const repo = require('./history-repository');
const {
  SUPPORTED_PROJECT_KEYS, TRIGGER_TYPES, MODES, RUN_STATUS, PROJECT_STATUS, ERROR_CODES,
} = require('./constants');

const noopLogger = { info() {}, warn() {}, error() {} };

// Raw monday leases for a project → the builder's allLeases shape (incl. unit_code + category code).
function loadProjectLeases(db, project) {
  const cats = categoriesRepo.listCategoriesByProject(db, project.id);
  const retailCat = cats.find((c) => c.code === 'retail');
  const officeCat = cats.find((c) => c.code === 'office');
  const catCode = (cid) => (retailCat && cid === retailCat.id) ? 'retail' : (officeCat && cid === officeCat.id) ? 'office' : null;
  return leasesRepo.listLeasesByProject(db, project.id)
    .filter((l) => l.source === 'monday')
    .map((l) => ({
      externalId: l.external_id, tenantName: l.tenant_name, categoryCode: catCode(l.category_id),
      area: l.area, unitCode: l.unit_code, status: l.status, isActive: l.is_active, leaseDate: l.lease_date,
    }));
}

/**
 * @param {object} options
 *   db (required), projectKeys?, mode ('write'|'dry-run'), triggerType, capturedAt?,
 *   forceBusinessDate? (TESTS ONLY), logger?
 */
function captureHistoricalSnapshots(options) {
  const db = options.db;
  const mode = options.mode === MODES.DRY_RUN ? MODES.DRY_RUN : MODES.WRITE;
  const triggerType = options.triggerType || TRIGGER_TYPES.MANUAL;
  const logger = options.logger || noopLogger;
  const runId = repo.newRunId();
  const capture = captureContext(options.capturedAt);
  // forceBusinessDate is TEST/dev-only (never wired to a public API) — see §16/§24.
  const businessDate = options.forceBusinessDate || capture.businessDate;
  capture.businessDate = businessDate;

  const requested = (options.projectKeys && options.projectKeys.length)
    ? options.projectKeys
    : SUPPORTED_PROJECT_KEYS.slice();

  logger.info('history.capture.started', { runId, mode, triggerType, businessDate, projects: requested });

  const payload = dashboardService.buildDashboardPayload(db, capture.capturedAtUtc);
  const meta = payload.body ? payload.body.meta : null;
  const payloadProjects = (payload.ok && payload.body.data) ? payload.body.data.projects : [];
  const projectRows = projectsRepo.listProjects(db);
  const sourceType = meta ? meta.source : null;

  // Freshness policy (CP2) — trigger-aware; passed through by the coordinated runner.
  // Manual/test triggers stay lenient (warn, don't block); automatic triggers enforce it.
  const freshness = options.freshness || {};
  // CP6/lock-renewal (Correction C): the coordinated runner passes the execution-lock context
  // ({ ownerId, renew }). We renew the lease at each project boundary (write mode) and fail
  // closed if ownership was lost — captures are synchronous so the lease is normally held
  // sub-second, but this guarantees we never persist a project under a lock we no longer own.
  const lockContext = options.lockContext || null;
  const correlationId = options.correlationId || null;
  const originalTrigger = options.originalTrigger || triggerType; // preserved across retries (CP4/CP5)
  // ACTUAL wall-clock start of THIS run (CP5) — distinct from the business capture instant
  // (capture.capturedAtUtc). Used for the audit started/completed timestamps + duration.
  const runStartedAtUtc = new Date().toISOString();

  // AUDIT POLICY (F1 — explicit): only WRITE runs persist an audit row (insertRunStarted /
  // finalizeRun) to `historical_snapshot_runs`. DRY-RUN is deliberately LOG-ONLY — it writes
  // NOTHING (no run row, no snapshot), emitting only `history.capture.*` log lines and
  // returning its results in memory. This keeps dry-run a pure, side-effect-free preview
  // (verifiable by the read-only DB checks) and never inflates the audit history.
  if (mode === MODES.WRITE) {
    repo.insertRunStarted(db, {
      runId, triggerType, requestedProjectKey: requested.length === 1 ? requested[0] : null,
      startedAtUtc: runStartedAtUtc, businessDate, timezone: capture.timezone, mode,
      sourceType, sourceDataVersion: meta ? meta.dataVersion : null, sourceSyncedAtUtc: meta ? meta.lastSuccessfulSync : null,
      snapshotCountRequested: requested.length,
    });
  }

  const results = [];
  let created = 0, skipped = 0, validationErrors = 0;

  let lockLost = false;
  for (const key of requested) {
    // Owner-checked lease renewal at the project boundary (write mode). A failed renewal means
    // another owner took over → stop the whole run immediately (fail closed); never write on.
    if (mode === MODES.WRITE && lockContext && typeof lockContext.renew === 'function' && !lockContext.renew()) {
      lockLost = true;
      results.push({ projectKey: key, status: PROJECT_STATUS.FAILED, created: false,
        errorCode: ERROR_CODES.LOCK_OWNERSHIP_LOST, errorMessage: 'execution lock ownership lost', underlyingCode: ERROR_CODES.LOCK_OWNERSHIP_LOST });
      logger.error('history.capture.lock_lost', { runId, projectKey: key });
      break;
    }
    try {
      const project = payloadProjects.find((p) => p.slug === key) || null;
      const row = projectRows.find((r) => r.slug === key) || null;
      const currentDataSource = row ? (row.current_data_source || 'seed') : null;

      if (!row) { results.push({ projectKey: key, status: PROJECT_STATUS.NOT_FOUND, created: false, errorCode: ERROR_CODES.PROJECT_NOT_FOUND }); continue; }

      const elig = evaluateSourceEligibility({ project, meta, currentDataSource, trigger: triggerType, nowUtc: capture.capturedAtUtc, maxSourceAgeMinutes: freshness.maxSourceAgeMinutes });
      if (!elig.eligible) {
        skipped += 1;
        results.push({ projectKey: key, status: mode === MODES.DRY_RUN ? PROJECT_STATUS.DRY_RUN : PROJECT_STATUS.SOURCE_INELIGIBLE,
          eligible: false, eligibility: elig, created: false, errorCode: ERROR_CODES.SOURCE_INELIGIBLE });
        logger.warn('history.capture.source_ineligible', { runId, projectKey: key, reasons: elig.reasons });
        continue;
      }

      const buildingResult = dashboardService.allocateProjectBuildings(db, row);
      const canonical = buildProjectSnapshot({
        projectKey: key, projectName: project.project, address: project.address,
        metrics: project.metrics, buildingsPayload: project.buildings,
        allLeases: loadProjectLeases(db, row), capture,
        sourceContext: { sourceType: elig.sourceType, sourceDataVersion: elig.sourceDataVersion, sourceSyncedAtUtc: elig.sourceSyncedAtUtc, sourceRecordCount: null },
        ids: { snapshotId: repo.newSnapshotId(), runId },
      });

      const validation = validateProjectSnapshot(canonical);
      if (!validation.valid) {
        validationErrors += validation.errors.length;
        results.push({ projectKey: key, status: PROJECT_STATUS.VALIDATION_FAILED, created: false,
          errorCode: ERROR_CODES.SNAPSHOT_VALIDATION_FAILED, validation, eligibility: elig,
          snapshot: mode === MODES.DRY_RUN ? canonical : undefined });
        logger.error('history.capture.validation_failed', { runId, projectKey: key, errors: validation.errors.map((e) => e.code) });
        continue;
      }

      const existing = repo.findProjectSnapshot(db, key, businessDate);
      if (mode === MODES.DRY_RUN) {
        results.push({ projectKey: key, status: PROJECT_STATUS.DRY_RUN, created: false, writePerformed: false,
          eligibility: elig, validation, duplicate: !!existing, existingSnapshotId: existing ? existing.snapshotId : null,
          snapshot: canonical });
        continue;
      }
      if (existing) {
        skipped += 1;
        results.push({ projectKey: key, status: PROJECT_STATUS.DUPLICATE_SKIPPED, created: false,
          businessDate, existingSnapshotId: existing.snapshotId, eligibility: elig, validation });
        logger.info('history.capture.duplicate_skipped', { runId, projectKey: key, businessDate, existingSnapshotId: existing.snapshotId });
        continue;
      }

      const persisted = repo.persistProjectSnapshot(db, canonical, { runId });
      if (persisted.status === 'duplicate_skipped') { // race: another writer won
        skipped += 1;
        results.push({ projectKey: key, status: PROJECT_STATUS.DUPLICATE_SKIPPED, created: false, businessDate, existingSnapshotId: persisted.existingSnapshotId, eligibility: elig, validation });
        logger.info('history.capture.duplicate_skipped_race', { runId, projectKey: key });
      } else {
        created += 1;
        results.push({ projectKey: key, status: PROJECT_STATUS.CREATED, created: true, snapshotId: persisted.snapshotId, businessDate, warnings: canonical.warnings, eligibility: elig, validation });
        logger.info('history.capture.committed', { runId, projectKey: key, businessDate, snapshotId: persisted.snapshotId, warnings: canonical.warnings.length });
      }
    } catch (e) {
      // F2: preserve the sanitized underlying cause code (e.g. a better-sqlite3 SQLITE_* code)
      // so the audit/provenance retains WHY a project failed, without leaking any message/path.
      results.push({ projectKey: key, status: PROJECT_STATUS.FAILED, created: false, errorCode: ERROR_CODES.SNAPSHOT_PERSISTENCE_FAILED, errorMessage: String(e && e.message || e), underlyingCode: (e && e.code) || null });
      logger.error('history.capture.failed', { runId, projectKey: key, error: String(e && e.message || e), underlyingCode: (e && e.code) || null });
    }
  }
  if (lockLost) logger.warn('history.capture.aborted_lock_lost', { runId });

  // overall run status
  let runStatus;
  const anyCreated = created > 0;
  const anyFailed = results.some((r) => r.status === PROJECT_STATUS.FAILED);
  const anyValidationFailed = results.some((r) => r.status === PROJECT_STATUS.VALIDATION_FAILED);
  const anyIneligible = results.some((r) => r.status === PROJECT_STATUS.SOURCE_INELIGIBLE);
  const anyDuplicate = results.some((r) => r.status === PROJECT_STATUS.DUPLICATE_SKIPPED);
  if (mode === MODES.DRY_RUN) runStatus = RUN_STATUS.COMPLETED;
  else if (anyFailed) runStatus = RUN_STATUS.FAILED;
  else if (anyValidationFailed) runStatus = RUN_STATUS.VALIDATION_FAILED;
  else if (!anyCreated && anyIneligible && !anyDuplicate) runStatus = RUN_STATUS.SOURCE_INELIGIBLE;
  else if (!anyCreated && anyDuplicate) runStatus = RUN_STATUS.DUPLICATE_SKIPPED;
  else if (anyCreated && (anyDuplicate || anyIneligible)) runStatus = RUN_STATUS.COMPLETED_WITH_SKIPS;
  else runStatus = RUN_STATUS.COMPLETED;

  // CP5: completion is the ACTUAL wall-clock finish; duration from actual timestamps
  // (never the business capture instant). Provenance (correlation id / decision codes /
  // per-project source-sync id) rides in metadata_json (no schema change).
  const completedAtUtc = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(completedAtUtc) - Date.parse(runStartedAtUtc));
  if (mode === MODES.WRITE) {
    repo.finalizeRun(db, runId, {
      completedAtUtc, status: runStatus, sourceType, sourceDataVersion: meta ? meta.dataVersion : null, sourceSyncedAtUtc: meta ? meta.lastSuccessfulSync : null,
      created, skipped, validationErrorCount: validationErrors,
      errorCode: anyFailed ? ERROR_CODES.SNAPSHOT_PERSISTENCE_FAILED : (anyValidationFailed ? ERROR_CODES.SNAPSHOT_VALIDATION_FAILED : null),
      errorMessage: null,
      metadata: {
        correlationId, originalTrigger, durationMs, sourceSyncRunId: meta ? meta.dataVersion : null,
        results: results.map((r) => ({ projectKey: r.projectKey, status: r.status, snapshotId: r.snapshotId || null, decisionCode: (r.eligibility && !r.eligibility.eligible) ? r.eligibility.decisionCode : null, errorCode: r.errorCode || null, underlyingCode: r.underlyingCode || null })),
      },
    });
  }

  logger.info('history.capture.completed', { runId, mode, status: runStatus, created, skipped, durationMs });
  return {
    runId, mode, triggerType, status: runStatus, correlationId,
    startedAtUtc: runStartedAtUtc, completedAtUtc, durationMs,
    capturedAtUtc: capture.capturedAtUtc, businessDate, timezone: capture.timezone,
    sourceType, sourceDataVersion: meta ? meta.dataVersion : null, sourceSyncedAtUtc: meta ? meta.lastSuccessfulSync : null,
    requested, created, skipped, validationErrors, results,
  };
}

module.exports = { captureHistoricalSnapshots };
