'use strict';
/**
 * Phase 9.1B — shared snapshot-attempt runner. THE single coordinated path every automatic
 * trigger (scheduled/recovery/post-sync) and the manual CLI use, so they can never overlap
 * and never duplicate eligibility rules. It applies cheap pre-lock gates, acquires the
 * execution lock, then delegates to the existing 9.1A orchestrator (which owns source
 * eligibility, building/tenant/velocity logic, validation, duplicate protection, and audit).
 * Bounded transient retries only.
 */

const crypto = require('crypto');
const { runExclusive } = require('./execution-lock');
const { captureHistoricalSnapshots } = require('../capture-orchestrator');
const { isRetryableHistoricalError } = require('../errors');
const { TRIGGER_TYPES, PROJECT_STATUS } = require('../constants');

const noop = { info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isManual = (t) => t === TRIGGER_TYPES.MANUAL || t === TRIGGER_TYPES.MANUAL_CLI;

/**
 * @param {object} o db, config, trigger, correlationId?, logger?, nowUtc?, projectKeys?, isShuttingDown?()
 * @returns { status:'completed'|'failed'|'skipped', decisionCode?, summary?, trigger, correlationId, attempts }
 */
async function runSnapshotAttempt(o) {
  const { db, config, trigger, nowUtc, projectKeys, isShuttingDown } = o;
  const logger = o.logger || noop;
  // Stable root correlation id across all retries of this attempt (CP4 provenance).
  const correlationId = o.correlationId || ('corr_' + crypto.randomUUID());
  const freshness = { maxSourceAgeMinutes: config ? config.maxSourceAgeMinutes : undefined };

  if (isShuttingDown && isShuttingDown()) return { status: 'skipped', decisionCode: 'SHUTTING_DOWN', trigger, correlationId };
  if (!isManual(trigger) && config && config.enabled === false) {
    return { status: 'skipped', decisionCode: 'AUTOMATION_DISABLED', trigger, correlationId };
  }

  const maxRetries = config ? config.retryAttempts : 0;
  const ttlSeconds = config ? config.lockTimeoutSeconds : 300;
  let attempt = 0, last = null;

  while (attempt <= maxRetries) {
    if (isShuttingDown && isShuttingDown()) return { status: 'skipped', decisionCode: 'SHUTTING_DOWN', trigger, correlationId, attempts: attempt };
    const ex = runExclusive(db, { ttlSeconds, nowUtc }, (lockContext) =>
      // The orchestrator re-reads state under the lock and owns eligibility + duplicate skip.
      // Original trigger is preserved even on retries (freshness policy follows it). The
      // lockContext (owner + renew()) lets the orchestrator renew the lease at safe boundaries.
      captureHistoricalSnapshots({
        db, projectKeys, mode: 'write',
        triggerType: attempt > 0 ? TRIGGER_TYPES.RETRY : trigger,
        originalTrigger: trigger, correlationId, freshness, lockContext,
        capturedAt: nowUtc ? new Date(nowUtc) : undefined, logger,
      }));

    if (!ex.ran) {
      logger.info('history.automation.lock_unavailable', { trigger, correlationId, reason: ex.reason });
      return { status: 'skipped', decisionCode: ex.reason, trigger, correlationId, attempts: attempt };
    }
    last = ex.result;
    const failedResults = last.results.filter((r) => r.status === PROJECT_STATUS.FAILED);
    if (failedResults.length === 0) {
      return { status: 'completed', summary: last, trigger, correlationId, attempts: attempt, ownerId: ex.ownerId };
    }
    // CP4: retry ONLY when a failure is explicitly transient. Permanent failures (validation,
    // stale source, programmer errors, …) stop immediately — never a broad retry.
    const anyTransient = failedResults.some((r) => isRetryableHistoricalError(r));
    if (!anyTransient) {
      logger.warn('history.automation.non_retryable', { trigger, correlationId, codes: failedResults.map((r) => r.errorCode) });
      return { status: 'failed', summary: last, trigger, correlationId, attempts: attempt, retryable: false };
    }
    attempt += 1;
    if (attempt <= maxRetries) {
      logger.warn('history.automation.retry', { trigger, correlationId, attempt });
      if (config && config.retryDelayMs) await sleep(config.retryDelayMs);
    }
  }
  return { status: 'failed', summary: last, trigger, correlationId, attempts: attempt, retryable: true };
}

module.exports = { runSnapshotAttempt };
