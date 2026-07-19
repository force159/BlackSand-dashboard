'use strict';
/**
 * BlackSand dashboard — Monday sync engine / pipeline (Phase 6 hardening).
 *
 * Pipeline: download → require-board check → complete-fetch gate → map → validate →
 * safety (empty/collapse) → transform → compare → persist(+cutover) → metadata → log.
 *
 * PHASE 6: DOWNLOAD is gated. `runSync()` short-circuits when sync is disabled or
 * Monday is not configured (defaults), so no network call is ever made. Every other
 * stage is testable OFFLINE by passing pre-fetched `rawByBoard` fixtures. The client's
 * default transport is also disabled. Phase 7 enables sync + injects a real transport.
 */

const crypto = require('crypto');
const { isConfigured } = require('./config');
const { columnIdsForBoard, mapDataset } = require('./mapper');
const { validateCanonicalDataset } = require('./validator');
const { transformCanonicalToRepositoryModel } = require('./transformer');
const { writeMondayDataset } = require('./persistence');
const { evaluateSafety } = require('./safety');
const syncRepo = require('../db/repositories/sync-runs-repository');

// Deterministic dataVersion over the transformed model's VISIBLE business fields.
function computeModelVersion(model) {
  const canonical = {
    projects: [...model.projects].sort((a, b) => a.slug.localeCompare(b.slug)).map((p) => ({
      slug: p.slug, name: p.name, address: p.address,
      categories: [...p.categories].sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ code: c.code, label: c.label, totalArea: c.totalArea, preserveTotalArea: c.preserveTotalArea, occupancySource: c.occupancySource, explicitLeasedPct: c.explicitLeasedPct, sortOrder: c.sortOrder })),
      leases: [...p.leases].sort((a, b) => String(a.externalId).localeCompare(String(b.externalId))).map((l) => ({ externalId: l.externalId, categoryCode: l.categoryCode, tenantName: l.tenantName, tenantType: l.tenantType, area: l.area, leaseDate: l.leaseDate, status: l.status, isActive: l.isActive, logoPath: l.logoPath })),
      buildings: [...(p.buildings || [])].sort((a, b) => a.name.localeCompare(b.name)).map((b) => ({ name: b.name, code: b.code, totalArea: b.totalArea, departments: [...(b.departments || [])].sort((x, y) => x.code.localeCompare(y.code)) })),
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Enabled boards from the mapping (disabled boards are ignored entirely). */
function enabledBoards(mapping) {
  return Object.entries(mapping.boards || {}).filter(([, b]) => b.enabled !== false);
}

/** Stage: download raw items for every enabled board (via the client). */
async function downloadStage({ client, config, logger }) {
  const rawByBoard = {};
  for (const [boardId, boardConfig] of enabledBoards(config.mapping)) {
    const columnIds = columnIdsForBoard(boardConfig);
    const { boardName, items, pages, complete } = await client.fetchBoardItems(boardId, columnIds);
    rawByBoard[boardId] = { id: boardId, name: boardName, items, complete };
    logger.debug(`board ${String(boardId).slice(0, 4)}…: ${items.length} items / ${pages} page(s) / complete=${complete}`);
  }
  return rawByBoard;
}

// Verify every ENABLED+REQUIRED board is present and its fetch COMPLETED. Returns a
// list of blocking reasons (empty = ok).
function checkBoardCompleteness(rawByBoard, mapping) {
  const problems = [];
  for (const [boardId, boardConfig] of enabledBoards(mapping)) {
    const raw = rawByBoard[boardId];
    const required = boardConfig.required !== false; // required by default
    if (!raw) {
      if (required) problems.push(`required board ${String(boardId).slice(0, 6)}… missing from the fetched dataset`);
      continue;
    }
    if (raw.complete === false) problems.push(`board ${String(boardId).slice(0, 6)}… fetch was INCOMPLETE (pagination did not finish) — refusing to deactivate records`);
  }
  return problems;
}

function recordRun(db, fields) { return syncRepo.insertSyncRun(db, fields); }

/**
 * Run the pipeline over ALREADY-DOWNLOADED raw data (offline testable). Persists only
 * when board-completeness, validation and safety all pass. Records a sync_run.
 */
function runPipeline(rawByBoard, { db, config, logger, now = new Date().toISOString(), override = false, dryRun = false }) {
  const startedAt = now;
  const t0 = Date.now();
  const prev = syncRepo.getLatestSuccessful(db);
  const prevLdc = prev ? prev.last_data_change_at : null;
  const baseRun = { source: 'monday', startedAt, scope: 'all', createdAt: new Date().toISOString(), lastDataChangeAt: prevLdc };

  // Ensure default rawBoard.complete=true for fixtures that omit it (skip non-board keys).
  for (const k of Object.keys(rawByBoard)) {
    const rb = rawByBoard[k];
    if (rb && typeof rb === 'object' && rb.complete === undefined) rb.complete = true;
  }

  // 1) REQUIRED-BOARD + COMPLETE-FETCH gate — never persist/deactivate on a partial fetch.
  const boardProblems = checkBoardCompleteness(rawByBoard, config.mapping);
  if (boardProblems.length) {
    logger.error(`sync rejected: board completeness`, { problems: boardProblems });
    recordRun(db, { ...baseRun, status: 'rejected', finishedAt: new Date().toISOString(), durationMs: Date.now() - t0, errorCode: 'BOARD_INCOMPLETE', errorMessage: boardProblems.join(' | ').slice(0, 300) });
    return { status: 'rejected', ok: false, reason: 'board-completeness', problems: boardProblems };
  }

  // 2) MAP + VALIDATE
  const canonical = mapDataset(rawByBoard, config.mapping);
  const validation = validateCanonicalDataset(canonical);
  const fetched = canonical.leases.length;
  if (!validation.ok) {
    logger.error(`sync rejected: ${validation.errors.length} validation error(s)`, { errors: validation.errors.slice(0, 5) });
    recordRun(db, { ...baseRun, status: 'rejected', finishedAt: new Date().toISOString(), recordsFetched: fetched, recordsAccepted: 0, warningCount: validation.warnings.length, rejectedRowCount: validation.errors.length, durationMs: Date.now() - t0, errorCode: 'VALIDATION_ERROR', errorMessage: validation.errors.slice(0, 3).join(' | ').slice(0, 300) });
    return { status: 'rejected', ok: false, reason: 'validation', validation };
  }

  // 3) SAFETY (empty / record-collapse) per project vs previous authoritative monday count.
  const envSafety = config.safety || {};
  const safetyProblems = [];
  for (const p of canonical.projects) {
    const proj = db.prepare('SELECT id, current_data_source FROM projects WHERE slug=?').get(p.slug);
    const previousCount = proj ? db.prepare("SELECT COUNT(*) n FROM leases WHERE project_id=? AND source='monday' AND is_active=1").get(proj.id).n : 0;
    const accepted = canonical.leases.filter((l) => l.projectSlug === p.slug).length;
    const boardConfig = Object.values(config.mapping.boards).find((b) => b.projectSlug === p.slug) || {};
    const res = evaluateSafety({ acceptedCount: accepted, previousCount, previousSource: proj ? proj.current_data_source : 'seed', boardConfig, envDefaults: envSafety, override });
    if (!res.ok) safetyProblems.push(`project "${p.slug}": ${res.reason}`);
  }
  if (safetyProblems.length) {
    logger.error('sync rejected: safety', { problems: safetyProblems });
    recordRun(db, { ...baseRun, status: 'rejected', finishedAt: new Date().toISOString(), recordsFetched: fetched, recordsAccepted: fetched, warningCount: validation.warnings.length, durationMs: Date.now() - t0, errorCode: 'SAFETY_REJECTED', errorMessage: safetyProblems.join(' | ').slice(0, 300) });
    return { status: 'rejected', ok: false, reason: 'safety', problems: safetyProblems };
  }

  // 4) TRANSFORM + candidate dataVersion
  const model = transformCanonicalToRepositoryModel(canonical);
  const dataVersion = computeModelVersion(model);

  if (dryRun) {
    return { status: 'dry-run', ok: true, dataVersion, dataChanged: !(prev && prev.data_version === dataVersion), validation, model, canonical };
  }

  // 5) NO-CHANGE short-circuit — record a no_change attempt, write nothing.
  if (prev && prev.data_version === dataVersion) {
    const finishedAt = new Date().toISOString();
    recordRun(db, { ...baseRun, status: 'no_change', finishedAt, dataVersion, recordsFetched: fetched, recordsAccepted: fetched, warningCount: validation.warnings.length, insertCount: 0, updateCount: 0, deactivateCount: 0, unchangedCount: fetched, durationMs: Date.now() - t0, lastDataChangeAt: prevLdc });
    logger.info('sync: no change (dataVersion unchanged) — nothing written');
    return { status: 'no_change', ok: true, dataVersion, dataChanged: false, lastDataChangeAt: prevLdc, validation };
  }

  // 6) PERSIST + CUTOVER (atomic)
  const write = writeMondayDataset(db, model, { now });

  // 7) METADATA
  const finishedAt = new Date().toISOString();
  const lastDataChangeAt = finishedAt; // dataVersion changed → data changed
  const recordCount = model.projects.reduce((n, p) => n + p.leases.length + p.categories.length + 1, 0);
  recordRun(db, {
    ...baseRun, status: 'success', finishedAt, dataVersion, lastDataChangeAt, recordCount,
    recordsFetched: fetched, recordsAccepted: fetched, warningCount: validation.warnings.length, rejectedRowCount: 0,
    insertCount: write.totals.inserted, updateCount: write.totals.updated, deactivateCount: write.totals.deleted, unchangedCount: write.totals.unchanged,
    cutover: write.cutover ? 1 : 0, previousSource: (write.perProject[0] || {}).previousSource || null, newSource: 'monday',
    durationMs: Date.now() - t0,
  });
  logger.info(`sync committed: +${write.totals.inserted} ~${write.totals.updated} -${write.totals.deleted} =${write.totals.unchanged}${write.cutover ? ' (CUTOVER → monday)' : ''}`, { dataVersion: dataVersion.slice(0, 12) });
  return { status: 'success', ok: true, dataVersion, dataChanged: true, lastDataChangeAt, write, validation, cutover: write.cutover };
}

/** Full sync entry point. In Phase 6 this SKIPS before any download (no network). */
async function runSync(deps) {
  const { config, logger } = deps;
  if (!isConfigured(config)) { logger.info('sync skipped: Monday is not configured'); return { status: 'skipped', reason: 'not-configured' }; }
  if (!config.syncEnabled) { logger.info('sync skipped: MONDAY_SYNC_ENABLED is false (Phase 6 default)'); return { status: 'skipped', reason: 'sync-disabled' }; }

  const rawByBoard = deps.rawByBoard || await downloadStage(deps);
  return runPipeline(rawByBoard, { ...deps, dryRun: config.dryRun });
}

module.exports = { runSync, runPipeline, downloadStage, computeModelVersion, checkBoardCompleteness, enabledBoards };
