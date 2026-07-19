'use strict';
/**
 * Phase 9.1B — post-sync snapshot capture (§13). Called ONLY after a confirmed successful
 * Monday sync (committed local writes). It goes through the shared coordinated runner, so
 * it can never overlap a scheduled/recovery run and never duplicates today's snapshot. It
 * MUST NOT make the sync appear failed — the caller treats its result as advisory.
 */

const crypto = require('crypto');
const { runSnapshotAttempt } = require('./snapshot-runner');
const { TRIGGER_TYPES } = require('../constants');

async function capturePostSync({ db, config, logger, syncRunId }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  if (!config || config.postSyncCaptureEnabled === false) {
    return { status: 'skipped', decisionCode: 'POST_SYNC_DISABLED', trigger: TRIGGER_TYPES.POST_SYNC };
  }
  const correlationId = 'corr_' + crypto.randomUUID();
  log.info('history.postsync.started', { correlationId, syncRunId: syncRunId || null });
  const res = await runSnapshotAttempt({ db, config, trigger: TRIGGER_TYPES.POST_SYNC, correlationId, logger: log });
  log.info('history.postsync.result', { correlationId, status: res.status, decisionCode: res.decisionCode || null });
  return res;
}

module.exports = { capturePostSync };
