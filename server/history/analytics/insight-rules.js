'use strict';
/**
 * Phase 9.2B — deterministic executive-insight rule engine (Checkpoint 7). NO LLM, no
 * prediction. Each rule reads already-computed evidence (from the reused 9.2A/9.2B services)
 * and emits an insight ONLY when its documented threshold is met. Missing data never
 * produces a false positive — it produces a data-quality insight instead. Every insight
 * carries ruleKey, category, severity, thresholds, evidence, snapshotIds, calculations,
 * limitations. Deterministic for identical input.
 */

// ctx: { occupancy:{latest:{date,value,snapshotId}, comparison:{from,to,change}}, trend:{direction,change},
//        concentration:{dimension,top1SharePercent,hhiPoints,available}, movement:{counts,from,to},
//        portfolio:{...}, dataQuality:{rentAvailable, exposureAvailable, identityConfidence} }
function evaluateInsights(ctx, opts) {
  const out = [];
  const add = (o) => out.push({ limitations: [], snapshotIds: [], calculations: {}, ...o });
  const c = ctx || {};

  // ── occupancy ──
  const occLatest = c.occupancy && c.occupancy.latest;
  if (occLatest && occLatest.value != null) {
    if (occLatest.value < 50) add({ ruleKey: 'occupancy.critical-low', category: 'occupancy', severity: 'warning', thresholds: { lessThan: 50 }, evidence: { occupancyPercent: occLatest.value, date: occLatest.date }, snapshotIds: [occLatest.snapshotId].filter(Boolean), calculations: { comparator: 'occupancy < 50' } });
    else if (occLatest.value < 70) add({ ruleKey: 'occupancy.below-target', category: 'occupancy', severity: 'info', thresholds: { lessThan: 70 }, evidence: { occupancyPercent: occLatest.value, date: occLatest.date }, snapshotIds: [occLatest.snapshotId].filter(Boolean) });
  }
  const occCmp = c.occupancy && c.occupancy.comparison;
  if (occCmp && occCmp.change && occCmp.change.absolute != null) {
    if (occCmp.change.absolute <= -5) add({ ruleKey: 'occupancy.declining', category: 'occupancy', severity: 'warning', thresholds: { dropPointsAtLeast: 5 }, evidence: { fromDate: occCmp.from, toDate: occCmp.to, changePoints: occCmp.change.absolute, changePercent: occCmp.change.percent }, calculations: { comparator: 'Δoccupancy ≤ -5 points' } });
    else if (occCmp.change.absolute < 0) add({ ruleKey: 'occupancy.slight-decline', category: 'occupancy', severity: 'info', thresholds: { belowZero: true }, evidence: { changePoints: occCmp.change.absolute, fromDate: occCmp.from, toDate: occCmp.to } });
  }

  // ── vacancy (derived from occupancy) ──
  if (occLatest && occLatest.value != null && (100 - occLatest.value) > 50) {
    add({ ruleKey: 'vacancy.high', category: 'vacancy', severity: 'warning', thresholds: { vacancyGreaterThan: 50 }, evidence: { vacancyPercent: Math.round((100 - occLatest.value) * 100) / 100, date: occLatest.date }, snapshotIds: [occLatest.snapshotId].filter(Boolean) });
  }

  // ── concentration ──
  const con = c.concentration;
  if (con && con.available) {
    if ((con.top1SharePercent != null && con.top1SharePercent > 30) || (con.hhiPoints != null && con.hhiPoints > 2500)) {
      add({ ruleKey: 'concentration.high', category: 'concentration', severity: 'warning', thresholds: { top1PercentOver: 30, hhiPointsOver: 2500 }, evidence: { dimension: con.dimension, top1SharePercent: con.top1SharePercent, hhiPoints: con.hhiPoints }, calculations: { hhi: 'Σ(share)²', interpretation: 'HHI>2500 ≈ highly concentrated (DOJ)' }, limitations: ['By leased area/units only — rent not captured.'] });
    } else if (con.hhiPoints != null && con.hhiPoints > 1500) {
      add({ ruleKey: 'concentration.moderate', category: 'concentration', severity: 'info', thresholds: { hhiPointsOver: 1500 }, evidence: { dimension: con.dimension, hhiPoints: con.hhiPoints } });
    }
  }

  // ── tenant movement ──
  const mv = c.movement;
  if (mv && mv.counts) {
    if (mv.counts.possibleExit > mv.counts.possibleEntry) {
      add({ ruleKey: 'movement.net-exit', category: 'tenant-movement', severity: 'info', thresholds: { exitsGreaterThanEntries: true }, evidence: { fromDate: mv.from, toDate: mv.to, possibleExit: mv.counts.possibleExit, possibleEntry: mv.counts.possibleEntry }, limitations: ['Low-confidence (normalized-name identity); a rename reads as exit + entry.'] });
    }
  }

  // ── trend ──
  if (c.trend && c.trend.direction === 'down') {
    add({ ruleKey: 'trend.declining', category: 'trend', severity: 'info', thresholds: { direction: 'down' }, evidence: { metric: c.trend.metric || 'occupancyPercent', change: c.trend.change } });
  }

  // ── data quality (always surfaced; never a false positive) ──
  const dq = c.dataQuality || {};
  if (dq.rentAvailable === false) add({ ruleKey: 'data-quality.rent-unavailable', category: 'data-quality', severity: 'info', thresholds: {}, evidence: { rentAvailable: false }, limitations: ['Rent is not captured in the source; rent-based analytics are unavailable.'] });
  if (dq.exposureAvailable === false) add({ ruleKey: 'data-quality.lease-expiry-unavailable', category: 'data-quality', severity: 'info', thresholds: {}, evidence: { exposureAvailable: false }, limitations: ['Lease expiry dates are not captured; lease-exposure buckets are unavailable.'] });
  if (dq.identityConfidence === 'low') add({ ruleKey: 'data-quality.tenant-identity-low', category: 'data-quality', severity: 'info', thresholds: {}, evidence: { identityConfidence: 'low' }, limitations: ['Tenant identity is normalized-name; movement/rename classification is low confidence.'] });

  // Optional severity filter (suppression) — deterministic.
  const wanted = opts && opts.severity;
  return wanted ? out.filter((i) => i.severity === wanted) : out;
}

module.exports = { evaluateInsights };
