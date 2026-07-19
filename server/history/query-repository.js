'use strict';
/**
 * Phase 9.1B — read-only historical query repository. Prepared statements + bound params
 * ONLY; no SQL text ever leaves this module; no writes; never calls the live builder or
 * Monday. Order columns come from strict per-query allowlists (never raw user input).
 */

// Order-column allowlists (key → SQL column). Guarantees no arbitrary column injection.
const ORDER = {
  dates: { business_date: 'business_date', created_at: 'first_created_at' },
  buildings: { building_order: 'building_order', building_key: 'building_key', occupancy_percent: 'occupancy_percent', total_area: 'total_area' },
  tenants: { rank_by_area: 'rank_by_area', total_leased_area: 'total_leased_area', tenant_name: 'tenant_normalized_name' },
  runs: { started_at_utc: 'started_at_utc', business_date: 'business_date' },
};
const dir = (o) => (String(o).toLowerCase() === 'asc' ? 'ASC' : 'DESC');

// Distinct successful snapshot dates (only committed project snapshots exist here — failed
// attempts live in the runs audit table, never as snapshot rows), with a per-date rollup.
function listSnapshotDates(db, { from, to, limit, offset, order, orderBy }) {
  const col = ORDER.dates[orderBy] || 'business_date';
  const where = []; const p = {};
  if (from) { where.push('business_date >= @from'); p.from = from; }
  if (to) { where.push('business_date <= @to'); p.to = to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT business_date AS date, COUNT(*) AS projectCount, MIN(captured_at_utc) AS firstCreatedAt,
            GROUP_CONCAT(DISTINCT project_key) AS projects
     FROM historical_project_snapshots ${w}
     GROUP BY business_date ORDER BY ${col === 'first_created_at' ? 'MIN(captured_at_utc)' : 'business_date'} ${dir(order)}
     LIMIT @limit OFFSET @offset`
  ).all({ ...p, limit: limit + 1, offset });
  const total = db.prepare(`SELECT COUNT(DISTINCT business_date) n FROM historical_project_snapshots ${w}`).get(p).n;
  return page(rows, limit, offset, total, (r) => ({ ...r, projects: r.projects ? r.projects.split(',') : [] }));
}

// All project snapshots for one date (both projects). Empty array → caller returns 404.
function getProjectSnapshotsByDate(db, date) {
  return db.prepare('SELECT * FROM historical_project_snapshots WHERE business_date=? ORDER BY project_key ASC').all(date);
}

function getBuildingsByDate(db, date, { projectKey, limit, offset, order, orderBy }) {
  const col = ORDER.buildings[orderBy] || 'building_order';
  const where = ['business_date=@date']; const p = { date };
  if (projectKey) { where.push('project_key=@projectKey'); p.projectKey = projectKey; }
  const w = 'WHERE ' + where.join(' AND ');
  const rows = db.prepare(
    `SELECT * FROM historical_building_snapshots ${w} ORDER BY ${col} ${dir(order)}, building_key ASC LIMIT @limit OFFSET @offset`
  ).all({ ...p, limit: limit + 1, offset });
  const total = db.prepare(`SELECT COUNT(*) n FROM historical_building_snapshots ${w}`).get(p).n;
  return page(rows, limit, offset, total);
}

function getTenantsByDate(db, date, { projectKey, search, limit, offset, order, orderBy }) {
  const col = ORDER.tenants[orderBy] || 'rank_by_area';
  const where = ['business_date=@date']; const p = { date };
  if (projectKey) { where.push('project_key=@projectKey'); p.projectKey = projectKey; }
  if (search) { where.push('tenant_normalized_name LIKE @search ESCAPE \'\\\''); p.search = '%' + escapeLike(search) + '%'; }
  const w = 'WHERE ' + where.join(' AND ');
  const rows = db.prepare(
    // stable secondary sort key → deterministic pagination
    `SELECT * FROM historical_tenant_snapshots ${w} ORDER BY ${col} ${dir(order)}, tenant_normalized_name ASC, id ASC LIMIT @limit OFFSET @offset`
  ).all({ ...p, limit: limit + 1, offset });
  const total = db.prepare(`SELECT COUNT(*) n FROM historical_tenant_snapshots ${w}`).get(p).n;
  return page(rows, limit, offset, total);
}

function listRuns(db, { status, trigger, targetDate, from, to, limit, offset, order }) {
  const where = []; const p = {};
  if (status) { where.push('status=@status'); p.status = status; }
  if (trigger) { where.push('trigger_type=@trigger'); p.trigger = trigger; }
  if (targetDate) { where.push('business_date=@targetDate'); p.targetDate = targetDate; }
  if (from) { where.push('business_date >= @from'); p.from = from; }
  if (to) { where.push('business_date <= @to'); p.to = to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(
    // SAFE columns only — never error_message stack detail beyond the stored sanitized text.
    `SELECT run_id, business_date, trigger_type, mode, status, source_type, source_data_version,
            source_synced_at_utc, snapshot_count_requested, snapshot_count_created, snapshot_count_skipped,
            validation_error_count, error_code, error_message, started_at_utc, completed_at_utc
     FROM historical_snapshot_runs ${w} ORDER BY started_at_utc ${dir(order)}, id ${dir(order)} LIMIT @limit OFFSET @offset`
  ).all({ ...p, limit: limit + 1, offset });
  const total = db.prepare(`SELECT COUNT(*) n FROM historical_snapshot_runs ${w}`).get(p).n;
  return page(rows, limit, offset, total);
}

function snapshotStats(db) {
  const s = db.prepare(
    `SELECT COUNT(*) AS projectSnapshotCount, COUNT(DISTINCT business_date) AS dateCount,
            MIN(business_date) AS earliest, MAX(business_date) AS latest FROM historical_project_snapshots`
  ).get();
  return s;
}

// ── analytics reads (Phase 9.2A) — `column` MUST come from the metric registry allowlist
//    (never raw request input), so interpolating it is safe. Prepared statements + bound
//    params for all values; no N+1 (building comparison batches both dates in one query). ──

// Distinct business dates for a project that have a successful snapshot (ascending).
function distinctProjectDates(db, projectKey, { from, to } = {}) {
  const where = ['project_key=@pk']; const p = { pk: projectKey };
  if (from) { where.push('business_date >= @from'); p.from = from; }
  if (to) { where.push('business_date <= @to'); p.to = to; }
  return db.prepare(`SELECT DISTINCT business_date AS date FROM historical_project_snapshots WHERE ${where.join(' AND ')} ORDER BY business_date ASC`).all(p).map((r) => r.date);
}

// One project metric on one date. Distinguishes "no snapshot" (present:false) from a stored NULL.
function getProjectMetricAt(db, projectKey, column, date) {
  const row = db.prepare(`SELECT ${column} AS value FROM historical_project_snapshots WHERE project_key=? AND business_date=?`).get(projectKey, date);
  if (!row) return { present: false, value: null };
  return { present: true, value: row.value == null ? null : Number(row.value) };
}

// A project metric across a date range → [{ date, value }] for the dates that exist (sparse-safe).
function getProjectMetricSeries(db, projectKey, column, { from, to } = {}) {
  const where = ['project_key=@pk']; const p = { pk: projectKey };
  if (from) { where.push('business_date >= @from'); p.from = from; }
  if (to) { where.push('business_date <= @to'); p.to = to; }
  return db.prepare(`SELECT business_date AS date, ${column} AS value FROM historical_project_snapshots WHERE ${where.join(' AND ')} ORDER BY business_date ASC`).all(p)
    .map((r) => ({ date: r.date, value: r.value == null ? null : Number(r.value) }));
}

// Building metric for a set of dates in ONE query (batched → no N+1). Returns rows keyed by
// (building_key, date) so the service can pivot + detect added/removed buildings.
function getBuildingMetricForDates(db, projectKey, column, dates) {
  const placeholders = dates.map(() => '?').join(',');
  return db.prepare(
    `SELECT building_key, building_name, building_order, business_date AS date, ${column} AS value
     FROM historical_building_snapshots WHERE project_key=? AND business_date IN (${placeholders})
     ORDER BY building_order ASC, building_key ASC`
  ).all(projectKey, ...dates).map((r) => ({ ...r, value: r.value == null ? null : Number(r.value) }));
}

// A building metric across a date range for one building → series (sparse-safe).
function getBuildingMetricSeries(db, projectKey, buildingKey, column, { from, to } = {}) {
  const where = ['project_key=@pk', 'building_key=@bk']; const p = { pk: projectKey, bk: buildingKey };
  if (from) { where.push('business_date >= @from'); p.from = from; }
  if (to) { where.push('business_date <= @to'); p.to = to; }
  return db.prepare(`SELECT business_date AS date, ${column} AS value FROM historical_building_snapshots WHERE ${where.join(' AND ')} ORDER BY business_date ASC`).all(p)
    .map((r) => ({ date: r.date, value: r.value == null ? null : Number(r.value) }));
}

// ALL aggregated tenant rows for one project+date (no pagination) — for portfolio /
// concentration / movement analytics (Phase 9.2B). Ordered by rank for determinism.
function getAllTenantsForDate(db, projectKey, date) {
  return db.prepare(
    `SELECT tenant_key, tenant_display_name, tenant_normalized_name, total_leased_area, lease_record_count,
            unit_count, building_count, building_keys_json, primary_category, categories_json,
            rank_by_area, active_lease_count, earliest_active_start_date, latest_active_start_date
     FROM historical_tenant_snapshots WHERE project_key=? AND business_date=? ORDER BY rank_by_area ASC, tenant_normalized_name ASC`
  ).all(projectKey, date);
}

// ── helpers ──
function escapeLike(s) { return String(s).replace(/[\\%_]/g, (m) => '\\' + m); }
function page(rows, limit, offset, total, mapFn) {
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(mapFn || ((x) => x));
  return { items, limit, offset, returned: items.length, hasMore, total };
}

module.exports = {
  listSnapshotDates, getProjectSnapshotsByDate, getBuildingsByDate, getTenantsByDate, listRuns, snapshotStats,
  distinctProjectDates, getProjectMetricAt, getProjectMetricSeries, getBuildingMetricForDates, getBuildingMetricSeries,
  getAllTenantsForDate,
  ORDER,
};
