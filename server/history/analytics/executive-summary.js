'use strict';
/**
 * Phase 9.2B — executive summary. COMPOSES existing services (no duplicated calculation):
 * 9.2A comparison + trend, plus 9.2B portfolio + concentration + lease-exposure + movement,
 * then the deterministic insight rules. Read-only. Unavailable pieces (rent, expiry,
 * <2 dates) are surfaced as structured `available:false`, never fabricated.
 */

const repo = require('../query-repository');
const comparisonSvc = require('./comparison-service');
const seriesSvc = require('./series-service');
const tenant = require('./tenant-analytics');
const movementSvc = require('./tenant-movement');
const { evaluateInsights } = require('./insight-rules');
const { AnalyticsError } = require('./tenant-analytics');

const num = (v) => (v == null ? null : Number(v));
const safe = (fn) => { try { return fn(); } catch (e) { return { available: false, reason: e.code || 'UNAVAILABLE', message: e.message }; } };

const UNAVAILABLE = (reason, message) => ({ available: false, reason, message: message || null });

/**
 * Resolve the analytics date and its DATE-SCOPED context (Correction A). Everything is
 * bounded to snapshot dates ≤ the selected date `D`, so a summary requested for an older
 * date NEVER uses a later snapshot.
 *   selectedDate  — explicit (must exist) or the project's latest snapshot date
 *   eligibleDates — all snapshot dates ≤ selectedDate (ascending)
 *   previousDate  — the snapshot date immediately before selectedDate (or null if D is first)
 *   countThroughDate — number of snapshot dates through D (NOT total project history)
 *   totalCount    — total snapshot dates for the project
 */
function resolveDate(db, projectKey, date) {
  const allDates = repo.distinctProjectDates(db, projectKey);
  if (allDates.length === 0) throw new AnalyticsError('NO_HISTORY', `no snapshots for ${projectKey}`);
  const selectedDate = date ? date : allDates[allDates.length - 1];
  if (date && !allDates.includes(date)) throw new AnalyticsError('SNAPSHOT_NOT_FOUND', `no snapshot for ${projectKey} on ${date}`);
  const eligibleDates = allDates.filter((d) => d <= selectedDate);
  const previousDate = eligibleDates.length >= 2 ? eligibleDates[eligibleDates.length - 2] : null;
  return { date: selectedDate, allDates, eligibleDates, previousDate, countThroughDate: eligibleDates.length, totalCount: allDates.length };
}

// Assemble the deterministic insight context, STRICTLY scoped to the resolved date `R.date`.
// Comparison/movement use (previousDate → D); trend spans (eligibleDates[0] → D); no policy
// (which would jump to the globally-latest date). No evidence later than D can appear.
function buildInsightContext(db, projectKey, R) {
  const D = R.date, prev = R.previousDate;
  const latestRow = repo.getProjectSnapshotsByDate(db, D).find((p) => p.project_key === projectKey) || {};
  const comparison = prev ? safe(() => comparisonSvc.compareProjectMetric(db, { projectKey, metric: 'occupancyPercent', from: prev, to: D })) : UNAVAILABLE('INSUFFICIENT_HISTORY', 'no earlier snapshot to compare against');
  const movement = prev ? safe(() => movementSvc.computeMovement(db, { projectKey, from: prev, to: D })) : UNAVAILABLE('INSUFFICIENT_HISTORY', 'no earlier snapshot to compare against');
  const trend = safe(() => seriesSvc.projectTrend(db, { projectKey, metric: 'occupancyPercent', from: R.eligibleDates[0], to: D }));
  const concentration = tenant.computeConcentration(db, { projectKey, date: D, dimension: 'area' });
  const ctx = {
    occupancy: { latest: { date: D, value: num(latestRow.occupancy_percent), snapshotId: latestRow.snapshot_id }, comparison: (comparison && comparison.change) ? comparison : null },
    trend: (trend && trend.summary) ? { metric: 'occupancyPercent', direction: trend.summary.change.direction, change: trend.summary.change } : null,
    concentration, movement: (movement && movement.counts) ? movement : null,
    dataQuality: { rentAvailable: false, exposureAvailable: false, identityConfidence: 'low' },
  };
  return { ctx, comparison, trend, concentration, movement };
}

function buildExecutiveSummary(db, { projectKey, date }) {
  const R = resolveDate(db, projectKey, date);
  const built = buildInsightContext(db, projectKey, R);
  return {
    projectKey, latestDate: R.date, summaryDate: R.date,
    snapshotDateCount: R.countThroughDate,      // snapshot dates THROUGH the summary date
    totalSnapshotDateCount: R.totalCount,        // total project history
    previousDate: R.previousDate,
    comparison: built.comparison,
    trend: (built.trend && built.trend.summary) ? built.trend : UNAVAILABLE('INSUFFICIENT_HISTORY'),
    portfolio: tenant.buildPortfolio(db, { projectKey, date: R.date }),
    concentration: built.concentration,
    leaseExposure: tenant.computeLeaseExposure(db, { projectKey, date: R.date }),
    movement: built.movement,
    insights: evaluateInsights(built.ctx),
    dataQuality: built.ctx.dataQuality,
  };
}

// Insights endpoint reuses the SAME date-scoped context (no duplicate calculation).
function buildInsights(db, { projectKey, date, severity }) {
  const R = resolveDate(db, projectKey, date);
  const { ctx } = buildInsightContext(db, projectKey, R);
  return { projectKey, date: R.date, summaryDate: R.date, insights: evaluateInsights(ctx, { severity }) };
}

module.exports = { buildExecutiveSummary, buildInsights, resolveDate };
