'use strict';
/**
 * Phase 9.1B — snapshot scheduler lifecycle (§5, §6, §10). One timer for the next Riyadh
 * daily time (never a bare 24h interval); reschedules after every run regardless of
 * outcome; a failed job never crashes the server. Startup recovery is conservative and
 * TODAY-ONLY (the live source is a single current dataset with no per-date historical
 * states — prior missed days cannot be legitimately reconstructed, so they are reported
 * unrecoverable, never fabricated). All executions go through the shared coordinated runner.
 */

const crypto = require('crypto');
const { runSnapshotAttempt } = require('./snapshot-runner');
const { nextScheduledInstant, hasScheduledTimePassed } = require('../riyadh-date');
const { TRIGGER_TYPES } = require('../constants');

const noop = { info() {}, warn() {}, error() {} };
const MAX_DELAY = 2147483647; // Node setTimeout max (~24.8 days)
const corr = () => 'corr_' + crypto.randomUUID();

function createSnapshotScheduler({ getDb, config, logger, runAttempt: injectedRunAttempt }) {
  const log = logger || noop;
  const runAttempt = injectedRunAttempt || runSnapshotAttempt; // injectable for deterministic tests
  let timer = null, started = false, shuttingDown = false, running = false;
  let nextRunAt = null, lastAttempt = null, recoveryState = 'idle', lastSuccessfulDate = null;
  let activePromise = null; // resolves when the current execution finishes (CP7)

  const isShuttingDown = () => shuttingDown;

  // Correction B: ONE lifecycle-registration helper for EVERY DB-touching attempt (scheduled
  // daily AND startup recovery). It marks the scheduler active, serializes a second attempt
  // behind the first (no silent overlap), and keeps `activePromise` pointing at the latest
  // outstanding work so awaitIdle()/stopAndWait() always wait for it (incl. recovery). Only
  // the last outstanding op clears `running`.
  function track(operation) {
    const prev = activePromise || Promise.resolve();
    running = true;
    const p = prev.catch(() => {}).then(() => operation());
    activePromise = p;
    const done = () => { if (activePromise === p) { activePromise = null; running = false; } };
    p.then(done, done);
    return p;
  }

  function executeRun(trigger) { return track(() => attempt(trigger)); }
  async function attempt(trigger) {
    const correlationId = corr();
    const startedAt = new Date().toISOString();
    try {
      const res = await runAttempt({ db: getDb(), config, trigger, correlationId, logger: log, isShuttingDown });
      const created = res.summary ? res.summary.created : 0;
      lastAttempt = { trigger, status: res.status, decisionCode: res.decisionCode || null, startedAt, completedAt: new Date().toISOString(), correlationId, created };
      if (created > 0 && res.summary) lastSuccessfulDate = res.summary.businessDate;
      log.info('history.scheduler.run_result', { trigger, correlationId, status: res.status, decisionCode: res.decisionCode || null, created });
      return res;
    } catch (e) { // never let an automation error crash the process
      lastAttempt = { trigger, status: 'failed', error: String(e && e.message || e), startedAt, completedAt: new Date().toISOString(), correlationId };
      log.error('history.scheduler.run_error', { trigger, correlationId, error: String(e && e.message || e) });
      return { status: 'failed', trigger, correlationId };
    }
  }

  function scheduleNext() {
    if (!started || shuttingDown || !config.enabled) return;
    const now = new Date();
    const inst = nextScheduledInstant(now, config.snapshotTime);
    nextRunAt = inst.toISOString();
    const delay = Math.max(0, inst.getTime() - now.getTime());
    const capped = Math.min(delay, MAX_DELAY);
    timer = setTimeout(async () => {
      timer = null;
      if (capped < delay) { scheduleNext(); return; } // very long delay → re-arm in chunks
      await executeRun(TRIGGER_TYPES.SCHEDULED_DAILY);
      scheduleNext();
    }, capped);
    if (timer.unref) timer.unref();
    log.info('history.scheduler.next_scheduled', { nextRunAt });
  }

  // Startup recovery is tracked by the SAME lifecycle helper (Correction B), so awaitIdle/
  // stopAndWait wait for it and the DB is never closed mid-recovery. recoveryState is reset
  // in a finally block so an unexpected error can never leave it stuck at 'running'.
  function runStartupRecovery() {
    if (!config.enabled || !config.startupRecoveryEnabled) { recoveryState = 'disabled'; return Promise.resolve({ status: 'disabled', created: 0, unrecoverable: [] }); }
    return track(async () => {
      recoveryState = 'running';
      const now = new Date();
      try {
        if (!hasScheduledTimePassed(now, config.snapshotTime)) {
          return { status: 'skipped', reason: 'scheduled-time-not-yet-passed', created: 0, unrecoverable: [] };
        }
        const res = await runAttempt({ db: getDb(), config, trigger: TRIGGER_TYPES.STARTUP_RECOVERY, correlationId: corr(), logger: log, isShuttingDown });
        const created = res.summary ? res.summary.created : 0;
        if (created > 0 && res.summary) lastSuccessfulDate = res.summary.businessDate;
        // Prior missed dates cannot be legitimately reconstructed from the single current
        // dataset — report them, never fabricate.
        const unrecoverable = [];
        const day = 24 * 60 * 60 * 1000;
        for (let i = 1; i <= config.recoveryLookbackDays; i++) unrecoverable.push(require('../riyadh-date').toRiyadhBusinessDate(new Date(now.getTime() - i * day)));
        const result = { status: res.status, decisionCode: res.decisionCode || null, created, unrecoverable };
        log.info('history.recovery.completed', { status: result.status, created: result.created, unrecoverable: result.unrecoverable.length });
        return result;
      } catch (e) {
        log.error('history.recovery.error', { error: String(e && e.message || e) });
        return { status: 'failed', error: String(e && e.message || e), created: 0, unrecoverable: [] };
      } finally {
        recoveryState = 'idle'; // never stuck at 'running'
      }
    });
  }

  function start() {
    if (started) return;                 // idempotent — never a duplicate timer
    started = true; shuttingDown = false;
    if (!config.enabled) { log.info('history.automation.disabled', {}); return; }
    scheduleNext();
    log.info('history.automation.initialized', { time: config.snapshotTime, tz: config.timezone });
  }
  function stop() {                      // idempotent + shutdown-safe
    shuttingDown = true; started = false;
    if (timer) { clearTimeout(timer); timer = null; }
    log.info('history.scheduler.stopped', {});
  }
  // CP7: stop scheduling new work, then wait (bounded) for any active execution to finish
  // so the DB is not closed mid-capture. Repeated calls are safe.
  async function stopAndWait(timeoutMs) {
    stop();
    return awaitIdle(timeoutMs);
  }
  function awaitIdle(timeoutMs) {
    if (!running || !activePromise) return Promise.resolve({ idle: true });
    const t = typeof timeoutMs === 'number' ? timeoutMs : 5000;
    let timer2;
    const timeout = new Promise((r) => { timer2 = setTimeout(() => r({ idle: false, timedOut: true }), t); if (timer2.unref) timer2.unref(); });
    return Promise.race([activePromise.then(() => ({ idle: true })), timeout]).finally(() => clearTimeout(timer2));
  }
  function getStatus() {
    return {
      automationEnabled: !!config.enabled, timezone: config.timezone, dailySnapshotTime: config.snapshotTime,
      schedulerRunning: started && !shuttingDown && !!config.enabled, shuttingDown, recoveryState,
      executionState: running ? 'running' : 'idle', nextScheduledRunAt: nextRunAt,
      lastAttempt, latestSuccessfulSnapshotDate: lastSuccessfulDate,
    };
  }
  return { start, stop, stopAndWait, awaitIdle, scheduleNext, executeRun, runStartupRecovery, getStatus, isShuttingDown };
}

module.exports = { createSnapshotScheduler };
