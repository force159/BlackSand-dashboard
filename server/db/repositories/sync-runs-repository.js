'use strict';
/**
 * Sync-runs repository — records seed/sync provenance. Parameterized SQL only.
 * Never stores secrets or full payloads (only counts + a short message).
 */

function insertSyncRun(db, data) {
  const row = db
    .prepare(
      `INSERT INTO sync_runs
         (source, status, started_at, finished_at, last_data_change_at, data_version,
          record_count, warning_count, rejected_row_count, duration_ms, error_code, error_message, created_at,
          records_fetched, records_accepted, insert_count, update_count, deactivate_count, unchanged_count,
          dry_run, cutover, previous_source, new_source, scope)
       VALUES
         (@source, @status, @started_at, @finished_at, @last_data_change_at, @data_version,
          @record_count, @warning_count, @rejected_row_count, @duration_ms, @error_code, @error_message, @created_at,
          @records_fetched, @records_accepted, @insert_count, @update_count, @deactivate_count, @unchanged_count,
          @dry_run, @cutover, @previous_source, @new_source, @scope)
       RETURNING id`
    )
    .get({
      source: data.source,
      status: data.status,
      started_at: data.startedAt,
      finished_at: data.finishedAt ?? null,
      last_data_change_at: data.lastDataChangeAt ?? null,
      data_version: data.dataVersion ?? null,
      record_count: data.recordCount ?? 0,
      warning_count: data.warningCount ?? 0,
      rejected_row_count: data.rejectedRowCount ?? 0,
      duration_ms: data.durationMs ?? null,
      error_code: data.errorCode ?? null,
      error_message: data.errorMessage ?? null,
      created_at: data.createdAt,
      records_fetched: data.recordsFetched ?? null,
      records_accepted: data.recordsAccepted ?? null,
      insert_count: data.insertCount ?? null,
      update_count: data.updateCount ?? null,
      deactivate_count: data.deactivateCount ?? null,
      unchanged_count: data.unchangedCount ?? null,
      dry_run: data.dryRun ? 1 : 0,
      cutover: data.cutover ? 1 : 0,
      previous_source: data.previousSource ?? null,
      new_source: data.newSource ?? null,
      scope: data.scope ?? null,
    });
  return row.id;
}

/** Latest successful seed run (by finished_at, then id). */
function getLatestSuccessfulSeed(db) {
  return db
    .prepare(
      `SELECT * FROM sync_runs
       WHERE source = 'seed' AND status = 'success'
       ORDER BY finished_at DESC, id DESC
       LIMIT 1`
    )
    .get();
}

/** Latest successful run of ANY source (seed today; monday later). */
function getLatestSuccessful(db) {
  return db
    .prepare("SELECT * FROM sync_runs WHERE status = 'success' ORDER BY finished_at DESC, id DESC LIMIT 1")
    .get();
}

/** Latest run of ANY status/source (for "last attempted"). */
function getLatestRun(db) {
  return db
    .prepare('SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT 1')
    .get();
}

function countSyncRuns(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM sync_runs').get().n;
}

function countBySource(db, source) {
  return db.prepare('SELECT COUNT(*) AS n FROM sync_runs WHERE source = ?').get(source).n;
}

module.exports = {
  insertSyncRun,
  getLatestSuccessfulSeed,
  getLatestSuccessful,
  getLatestRun,
  countSyncRuns,
  countBySource,
};
