'use strict';
/**
 * Phase 9.1B — read-only historical HTTP API (§17–§26). GET-only. Matches the project's
 * envelope: success → { data, meta }; error → { error:'code', message }. No SQL/paths/
 * stack traces/tokens leak. Route → validation → query service/repository → SQLite. No
 * writes, no live-builder calls, no Monday calls.
 */

const express = require('express');
const { getDatabase } = require('../db/connection');
const repo = require('./query-repository');
const map = require('./response-mappers');
const registry = require('./analytics/metric-registry');
const comparison = require('./analytics/comparison-service');
const series = require('./analytics/series-service');
const { AnalyticsError } = require('./analytics/comparison-service');
const tenantAnalytics = require('./analytics/tenant-analytics');
const movementSvc = require('./analytics/tenant-movement');
const execSvc = require('./analytics/executive-summary');
const { isValidBusinessDate } = require('./riyadh-date');
const { loadAutomationConfig } = require('./automation/automation-config');
const { RUN_STATUS, TRIGGER_TYPES } = require('./constants');

let cfg;
function config() { if (!cfg) { try { cfg = loadAutomationConfig(); } catch (_) { cfg = { apiDefaultLimit: 50, apiMaxLimit: 200, apiMaxDateRangeDays: 400 }; } } return cfg; }

// A scheduler instance is registered by server.js when automation runs in this process.
let scheduler = null;
function setScheduler(s) { scheduler = s; }

// ── validation ──
class BadRequest extends Error { constructor(code, message) { super(message); this.code = code; } }
function vDate(s, field) { if (!isValidBusinessDate(s)) throw new BadRequest('INVALID_DATE', `${field} must be a real YYYY-MM-DD date`); return s; }
function vLimit(q) { const c = config(); if (q == null || q === '') return c.apiDefaultLimit; const n = Number(q); if (!Number.isInteger(n) || n < 1) throw new BadRequest('INVALID_LIMIT', 'limit must be a positive integer'); return Math.min(n, c.apiMaxLimit); }
function vOffset(q) { if (q == null || q === '') return 0; const n = Number(q); if (!Number.isInteger(n) || n < 0) throw new BadRequest('INVALID_OFFSET', 'offset must be a non-negative integer'); return n; }
function vOrder(q) { if (q == null || q === '') return 'desc'; const o = String(q).toLowerCase(); if (o !== 'asc' && o !== 'desc') throw new BadRequest('INVALID_ORDER', 'order must be asc or desc'); return o; }
function vOrderBy(q, allow, def) { if (q == null || q === '') return def; if (!Object.prototype.hasOwnProperty.call(allow, q)) throw new BadRequest('INVALID_ORDER_BY', `orderBy must be one of: ${Object.keys(allow).join(', ')}`); return q; }
function vEnum(q, allow, field) { if (q == null || q === '') return null; if (allow.indexOf(q) < 0) throw new BadRequest('INVALID_' + field.toUpperCase(), `${field} must be one of: ${allow.join(', ')}`); return q; }
function vSearch(q) { if (q == null) return null; const s = String(q).trim(); if (s === '') return null; if (s.length > 100) throw new BadRequest('INVALID_SEARCH', 'search too long (max 100)'); return s; }
function vRange(from, to) {
  if (from && to) {
    if (from > to) throw new BadRequest('INVALID_RANGE', 'from must not be after to');
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (days > config().apiMaxDateRangeDays) throw new BadRequest('RANGE_TOO_LARGE', `date range exceeds ${config().apiMaxDateRangeDays} days`);
  }
}
function projKey(q) { if (q == null || q === '') return null; const s = String(q).trim().toLowerCase(); if (!/^[a-z0-9-]{1,64}$/.test(s)) throw new BadRequest('INVALID_PROJECT', 'invalid project key'); return s; }

function sendErr(res, status, code, message) { return res.status(status).json({ error: code, message }); }
// Analytics/validation errors carry a `.code`. *_NOT_FOUND / NO_HISTORY → 404 (valid but
// absent); other known analytics/validation codes → 400; anything else → safe 500.
const ANALYTICS_400 = new Set(['UNSUPPORTED_METRIC', 'UNSUPPORTED_DIMENSION', 'INVALID_SELECTION_POLICY', 'MISSING_SELECTION', 'MISSING_BUILDING', 'INSUFFICIENT_HISTORY']);
function handle(res, fn) {
  res.set('Cache-Control', 'no-store');
  try { return fn(); }
  catch (e) {
    if (e instanceof BadRequest) return sendErr(res, 400, e.code, e.message);
    const code = e && e.code;
    if (code && /(_NOT_FOUND|NO_HISTORY)$/.test(code)) return sendErr(res, 404, code, e.message);
    if (code && ANALYTICS_400.has(code)) return sendErr(res, 400, code, e.message);
    console.error('GET /api/history failed: ' + (e && e.message)); // full detail to logs only
    return sendErr(res, 500, 'internal-error', 'Historical data is temporarily unavailable.');
  }
}
function vProjectRequired(q) { const s = projKey(q); if (!s) throw new BadRequest('MISSING_PROJECT', 'project is required'); return s; }
function vLevel(q) { const s = (q == null || q === '') ? 'project' : String(q); if (s !== 'project' && s !== 'building') throw new BadRequest('INVALID_LEVEL', 'level must be project or building'); return s; }
function vPolicy(q) { if (q == null || q === '') return null; if (['latest-vs-previous', 'latest-vs-first'].indexOf(q) < 0) throw new BadRequest('INVALID_SELECTION_POLICY', 'policy must be latest-vs-previous or latest-vs-first'); return q; }
// Deliberate public pagination shape (§26) — never raw SQL internals.
const pageMeta = (r) => ({ limit: r.limit, returnedCount: r.returned, hasMore: r.hasMore, nextOffset: r.hasMore ? r.offset + r.returned : null, total: r.total });

const router = express.Router();

router.get('/history/status', (req, res) => handle(res, () => {
  const db = getDatabase();
  const stats = repo.snapshotStats(db);
  const sched = scheduler ? scheduler.getStatus() : {
    automationEnabled: !!config().enabled, timezone: (config().timezone || 'Asia/Riyadh'),
    dailySnapshotTime: config().snapshotTime || null, schedulerRunning: false, recoveryState: 'not-running-in-this-process',
    executionState: 'idle', nextScheduledRunAt: null, lastAttempt: null, latestSuccessfulSnapshotDate: null,
  };
  return res.json({ data: {
    ...sched,
    latestSuccessfulSnapshotDate: sched.latestSuccessfulSnapshotDate || stats.latest || null,
    earliestSuccessfulSnapshotDate: stats.earliest || null,
    successfulProjectSnapshotCount: stats.projectSnapshotCount, successfulSnapshotDateCount: stats.dateCount,
  }, meta: { checkedAt: new Date().toISOString() } });
}));

router.get('/history/dates', (req, res) => handle(res, () => {
  const from = req.query.from ? vDate(req.query.from, 'from') : null;
  const to = req.query.to ? vDate(req.query.to, 'to') : null;
  vRange(from, to);
  const r = repo.listSnapshotDates(getDatabase(), { from, to, limit: vLimit(req.query.limit), offset: vOffset(req.query.offset), order: vOrder(req.query.order), orderBy: vOrderBy(req.query.orderBy, repo.ORDER.dates, 'business_date') });
  return res.json({ data: r.items.map(map.mapDate), meta: pageMeta(r) });
}));

router.get('/history/snapshots/:date', (req, res) => handle(res, () => {
  const date = vDate(req.params.date, 'date');
  const rows = repo.getProjectSnapshotsByDate(getDatabase(), date);
  if (!rows.length) return sendErr(res, 404, 'not-found', `No snapshot for ${date}`);
  return res.json({ data: { date, projects: rows.map(map.mapProjectSnapshot) }, meta: { projectCount: rows.length } });
}));

router.get('/history/snapshots/:date/buildings', (req, res) => handle(res, () => {
  const date = vDate(req.params.date, 'date');
  if (!repo.getProjectSnapshotsByDate(getDatabase(), date).length) return sendErr(res, 404, 'not-found', `No snapshot for ${date}`);
  const r = repo.getBuildingsByDate(getDatabase(), date, { projectKey: projKey(req.query.project), limit: vLimit(req.query.limit), offset: vOffset(req.query.offset), order: vOrder(req.query.order), orderBy: vOrderBy(req.query.orderBy, repo.ORDER.buildings, 'building_order') });
  return res.json({ data: r.items.map(map.mapBuilding), meta: { ...pageMeta(r), date } });
}));

router.get('/history/snapshots/:date/tenants', (req, res) => handle(res, () => {
  const date = vDate(req.params.date, 'date');
  if (!repo.getProjectSnapshotsByDate(getDatabase(), date).length) return sendErr(res, 404, 'not-found', `No snapshot for ${date}`);
  const r = repo.getTenantsByDate(getDatabase(), date, { projectKey: projKey(req.query.project), search: vSearch(req.query.search), limit: vLimit(req.query.limit), offset: vOffset(req.query.offset), order: vOrder(req.query.order), orderBy: vOrderBy(req.query.orderBy, repo.ORDER.tenants, 'rank_by_area') });
  // Rows are AGGREGATED tenant-directory entities (per business rule), not raw leases.
  return res.json({ data: r.items.map(map.mapTenant), meta: { ...pageMeta(r), date, rowType: 'aggregated-tenant-directory' } });
}));

router.get('/history/runs', (req, res) => handle(res, () => {
  const statuses = Object.values(RUN_STATUS);
  const triggers = Object.values(TRIGGER_TYPES);
  const from = req.query.from ? vDate(req.query.from, 'from') : null;
  const to = req.query.to ? vDate(req.query.to, 'to') : null;
  vRange(from, to);
  const r = repo.listRuns(getDatabase(), {
    status: vEnum(req.query.status, statuses, 'status'), trigger: vEnum(req.query.trigger, triggers, 'trigger'),
    targetDate: req.query.targetDate ? vDate(req.query.targetDate, 'targetDate') : null, from, to,
    limit: vLimit(req.query.limit), offset: vOffset(req.query.offset), order: vOrder(req.query.order),
  });
  return res.json({ data: r.items, meta: pageMeta(r) });
}));

// ── Phase 9.2A analytics (read-only): metrics registry, comparison, series, trend ──
router.get('/history/metrics', (req, res) => handle(res, () => {
  const level = vLevel(req.query.level);
  return res.json({ data: registry.listMetrics(level), meta: { level } });
}));

router.get('/history/compare', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const level = vLevel(req.query.level);
  const policy = vPolicy(req.query.policy);
  const from = req.query.from ? vDate(req.query.from, 'from') : null;
  const to = req.query.to ? vDate(req.query.to, 'to') : null;
  vRange(from, to);
  const args = { projectKey, metric: String(req.query.metric || ''), from, to, policy };
  const data = level === 'building' ? comparison.compareBuildings(getDatabase(), args) : comparison.compareProjectMetric(getDatabase(), args);
  return res.json({ data, meta: { checkedAt: new Date().toISOString() } });
}));

router.get('/history/series', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const level = vLevel(req.query.level);
  const from = req.query.from ? vDate(req.query.from, 'from') : null;
  const to = req.query.to ? vDate(req.query.to, 'to') : null;
  vRange(from, to);
  const args = { projectKey, metric: String(req.query.metric || ''), buildingKey: projKey(req.query.building), from, to };
  const data = level === 'building' ? series.buildingSeries(getDatabase(), args) : series.projectSeries(getDatabase(), args);
  return res.json({ data, meta: { pointCount: data.points.length } });
}));

router.get('/history/trend', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const level = vLevel(req.query.level);
  const from = req.query.from ? vDate(req.query.from, 'from') : null;
  const to = req.query.to ? vDate(req.query.to, 'to') : null;
  vRange(from, to);
  const args = { projectKey, metric: String(req.query.metric || ''), buildingKey: projKey(req.query.building), from, to };
  const data = level === 'building' ? series.buildingTrend(getDatabase(), args) : series.projectTrend(getDatabase(), args);
  return res.json({ data, meta: { checkedAt: new Date().toISOString() } });
}));

// ── Phase 9.2B tenant analytics & executive insights (read-only) ──
function vSeverity(q) { if (q == null || q === '') return null; if (['info', 'warning', 'critical'].indexOf(q) < 0) throw new BadRequest('INVALID_SEVERITY', 'severity must be info, warning or critical'); return q; }
function vDimension(q) { if (q == null || q === '') return 'area'; if (['area', 'units', 'rent'].indexOf(q) < 0) throw new BadRequest('INVALID_DIMENSION', 'dimension must be area, units or rent'); return q; }

router.get('/history/tenants/portfolio', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const { date } = execSvc.resolveDate(getDatabase(), projectKey, req.query.date ? vDate(req.query.date, 'date') : null);
  return res.json({ data: tenantAnalytics.buildPortfolio(getDatabase(), { projectKey, date }), meta: { date } });
}));

router.get('/history/tenants/concentration', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const { date } = execSvc.resolveDate(getDatabase(), projectKey, req.query.date ? vDate(req.query.date, 'date') : null);
  return res.json({ data: tenantAnalytics.computeConcentration(getDatabase(), { projectKey, date, dimension: vDimension(req.query.dimension) }), meta: { date } });
}));

router.get('/history/tenants/lease-exposure', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const { date } = execSvc.resolveDate(getDatabase(), projectKey, req.query.date ? vDate(req.query.date, 'date') : null);
  return res.json({ data: tenantAnalytics.computeLeaseExposure(getDatabase(), { projectKey, date }), meta: { date } });
}));

router.get('/history/tenants/movements', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  const policy = vPolicy(req.query.policy);
  const from = req.query.from ? vDate(req.query.from, 'from') : null;
  const to = req.query.to ? vDate(req.query.to, 'to') : null;
  vRange(from, to);
  return res.json({ data: movementSvc.computeMovement(getDatabase(), { projectKey, from, to, policy }), meta: { checkedAt: new Date().toISOString() } });
}));

router.get('/history/insights', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  return res.json({ data: execSvc.buildInsights(getDatabase(), { projectKey, date: req.query.date ? vDate(req.query.date, 'date') : null, severity: vSeverity(req.query.severity) }), meta: { checkedAt: new Date().toISOString() } });
}));

router.get('/history/executive-summary', (req, res) => handle(res, () => {
  const projectKey = vProjectRequired(req.query.project);
  return res.json({ data: execSvc.buildExecutiveSummary(getDatabase(), { projectKey, date: req.query.date ? vDate(req.query.date, 'date') : null }), meta: { checkedAt: new Date().toISOString() } });
}));

module.exports = { router, setScheduler };
