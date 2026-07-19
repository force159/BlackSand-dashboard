'use strict';
/**
 * Phase 9.2A — time-series + descriptive-trend service (read-only). A series is one metric's
 * stored values across a date range (sparse-safe: only dates that exist are returned). The
 * trend summary is DESCRIPTIVE only (first/last/min/max/average + first→last change +
 * direction) — no forecasting/regression/insights (those are Phase 9.2B). Deterministic.
 */

const repo = require('../query-repository');
const { getMetric } = require('./metric-registry');
const { computeChange, direction, round } = require('./change-math');
const { AnalyticsError } = require('./comparison-service');

// E1: explicit availability so the caller can distinguish "no snapshots" from "snapshots
// exist but every value is null" from "valued points". `points` is always present.
function availability(points) {
  if (points.length === 0) return { available: false, reason: 'NO_POINTS' };
  if (points.every((p) => p.value == null)) return { available: false, reason: 'NO_VALUED_POINTS' };
  return { available: true, reason: null };
}

function projectSeries(db, { projectKey, metric, from, to }) {
  const def = getMetric('project', metric);
  if (!def) throw new AnalyticsError('UNSUPPORTED_METRIC', 'unsupported project metric: ' + metric);
  const points = repo.getProjectMetricSeries(db, projectKey, def.column, { from, to });
  return { level: 'project', projectKey, metric: def.key, metricLabel: def.label, unit: def.unit, from: from || null, to: to || null, ...availability(points), points };
}

function buildingSeries(db, { projectKey, buildingKey, metric, from, to }) {
  const def = getMetric('building', metric);
  if (!def) throw new AnalyticsError('UNSUPPORTED_METRIC', 'unsupported building metric: ' + metric);
  if (!buildingKey) throw new AnalyticsError('MISSING_BUILDING', 'building is required for a building-level series');
  const points = repo.getBuildingMetricSeries(db, projectKey, buildingKey, def.column, { from, to });
  return { level: 'building', projectKey, buildingKey, metric: def.key, metricLabel: def.label, unit: def.unit, from: from || null, to: to || null, ...availability(points), points };
}

// Descriptive summary over a series' points (ignores null-valued points for stats).
function summarize(points) {
  const valued = points.filter((p) => p.value != null && Number.isFinite(p.value));
  if (valued.length === 0) {
    return { pointCount: points.length, valuedPointCount: 0, first: null, last: null, min: null, max: null, average: null, change: { absolute: null, percent: null, direction: 'unknown' } };
  }
  const first = valued[0], last = valued[valued.length - 1];
  const vals = valued.map((p) => p.value);
  const min = valued.reduce((m, p) => (p.value < m.value ? p : m), valued[0]);
  const max = valued.reduce((m, p) => (p.value > m.value ? p : m), valued[0]);
  const average = round(vals.reduce((a, b) => a + b, 0) / vals.length);
  // A single valued point has no meaningful change (do not pretend a flat 0/0 comparison).
  const change = valued.length < 2 ? { absolute: null, percent: null } : computeChange(first.value, last.value);
  return {
    pointCount: points.length, valuedPointCount: valued.length,
    first: { date: first.date, value: first.value }, last: { date: last.date, value: last.value },
    min: { date: min.date, value: min.value }, max: { date: max.date, value: max.value }, average,
    change: { ...change, direction: direction(change.absolute) },
  };
}

function projectTrend(db, args) { const s = projectSeries(db, args); return { ...s, summary: summarize(s.points) }; }
function buildingTrend(db, args) { const s = buildingSeries(db, args); return { ...s, summary: summarize(s.points) }; }

module.exports = { projectSeries, buildingSeries, summarize, projectTrend, buildingTrend };
