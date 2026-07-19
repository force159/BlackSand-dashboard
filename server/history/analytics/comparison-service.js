'use strict';
/**
 * Phase 9.2A — comparison service. Two-point metric delta at project or building level,
 * reusing the immutable 9.1 snapshots (read-only) + the shared change math. Handles every
 * required edge case: missing snapshots, same date twice, zero baseline, nulls, and
 * added/removed buildings. Deterministic; no route logic; no duplicated SQL.
 */

const repo = require('../query-repository');
const { getMetric } = require('./metric-registry');
const { computeChange, direction } = require('./change-math');

class AnalyticsError extends Error { constructor(code, message) { super(message); this.code = code; } }

// Resolve the (from, to) pair from an explicit range or a named selection policy.
function resolveSelection(db, projectKey, { from, to, policy }) {
  if (policy) {
    const dates = repo.distinctProjectDates(db, projectKey);
    if (dates.length < 2) throw new AnalyticsError('INSUFFICIENT_HISTORY', 'need at least two snapshot dates for this policy');
    if (policy === 'latest-vs-previous') return { from: dates[dates.length - 2], to: dates[dates.length - 1] };
    if (policy === 'latest-vs-first') return { from: dates[0], to: dates[dates.length - 1] };
    throw new AnalyticsError('INVALID_SELECTION_POLICY', 'unknown selection policy: ' + policy);
  }
  if (!from || !to) throw new AnalyticsError('MISSING_SELECTION', 'provide from+to dates or a selection policy');
  return { from, to };
}

const side = (at, date) => ({ date, present: at.present, value: at.value });

// Project-level comparison of one metric between two dates.
function compareProjectMetric(db, { projectKey, metric, from, to, policy }) {
  const def = getMetric('project', metric);
  if (!def) throw new AnalyticsError('UNSUPPORTED_METRIC', 'unsupported project metric: ' + metric);
  const sel = resolveSelection(db, projectKey, { from, to, policy });
  const b = repo.getProjectMetricAt(db, projectKey, def.column, sel.from);
  const c = repo.getProjectMetricAt(db, projectKey, def.column, sel.to);
  const change = computeChange(b.value, c.value);
  return {
    level: 'project', projectKey, metric: def.key, metricLabel: def.label, unit: def.unit, higherIsBetter: def.higherIsBetter,
    from: sel.from, to: sel.to, sameSelection: sel.from === sel.to,
    baseline: side(b, sel.from), comparison: side(c, sel.to),
    baselineMissing: !b.present, comparisonMissing: !c.present,
    change: { ...change, direction: direction(change.absolute) },
  };
}

// Building-level comparison of one metric across ALL buildings (batched: one query, no N+1).
// Buildings present on only one date are flagged added/removed with a null change.
function compareBuildings(db, { projectKey, metric, from, to, policy }) {
  const def = getMetric('building', metric);
  if (!def) throw new AnalyticsError('UNSUPPORTED_METRIC', 'unsupported building metric: ' + metric);
  const sel = resolveSelection(db, projectKey, { from, to, policy });
  const rows = repo.getBuildingMetricForDates(db, projectKey, def.column, sel.from === sel.to ? [sel.from] : [sel.from, sel.to]);
  // Correction D: track presence flags DURING the single pivot pass (no per-building rescans
  // of `rows`). Presence is by ROW existence, not value — a stored NULL value is still
  // 'present' (a building with a null metric is NOT misclassified as added/removed).
  const byKey = new Map();
  const sameDate = sel.from === sel.to;
  for (const r of rows) {
    if (!byKey.has(r.building_key)) byKey.set(r.building_key, { buildingKey: r.building_key, buildingName: r.building_name, buildingOrder: r.building_order, baseline: null, comparison: null, baselinePresent: false, comparisonPresent: false });
    const e = byKey.get(r.building_key);
    if (r.date === sel.from) { e.baseline = r.value; e.baselinePresent = true; }
    if (r.date === sel.to) { e.comparison = r.value; e.comparisonPresent = true; }
  }
  const buildings = [...byKey.values()].sort((a, b) => (a.buildingOrder ?? 1e9) - (b.buildingOrder ?? 1e9) || String(a.buildingKey).localeCompare(String(b.buildingKey)));
  const items = buildings.map((e) => {
    const hasB = e.baselinePresent;
    const hasC = sameDate ? hasB : e.comparisonPresent;
    const presence = (hasB && hasC) ? 'both' : (hasC ? 'added' : 'removed');
    const change = presence === 'both' ? computeChange(e.baseline, e.comparison) : { absolute: null, percent: null };
    return { buildingKey: e.buildingKey, buildingName: e.buildingName, buildingOrder: e.buildingOrder, presence,
      baseline: e.baseline, comparison: e.comparison, change: { ...change, direction: direction(change.absolute) } };
  });
  return { level: 'building', projectKey, metric: def.key, metricLabel: def.label, unit: def.unit, higherIsBetter: def.higherIsBetter,
    from: sel.from, to: sel.to, sameSelection: sel.from === sel.to, buildings: items };
}

module.exports = { compareProjectMetric, compareBuildings, resolveSelection, AnalyticsError };
