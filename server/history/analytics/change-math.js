'use strict';
/**
 * Phase 9.2A — the ONE implementation of the specified change math. Deterministic; never
 * returns NaN/Infinity.
 *   absolute = comparison − baseline
 *   percent  = ((comparison − baseline)/abs(baseline))*100   when baseline ≠ 0
 *            = 0                                              when baseline == 0 && comparison == 0
 *            = null                                           when baseline == 0 && comparison != 0
 *   either side null (missing/NULL) → absolute null, percent null (cannot compute).
 */

function round(n, dp = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function computeChange(baseline, comparison) {
  if (baseline == null || comparison == null) return { absolute: null, percent: null };
  if (!Number.isFinite(baseline) || !Number.isFinite(comparison)) return { absolute: null, percent: null };
  const absolute = round(comparison - baseline);
  let percent;
  if (baseline !== 0) percent = round(((comparison - baseline) / Math.abs(baseline)) * 100);
  else if (comparison === 0) percent = 0;
  else percent = null; // zero baseline, non-zero comparison → undefined ratio
  if (percent != null && !Number.isFinite(percent)) percent = null; // guard
  return { absolute, percent };
}

// Direction from an absolute change (null → 'unknown'; 0 → 'flat').
function direction(absolute) {
  if (absolute == null) return 'unknown';
  if (absolute > 0) return 'up';
  if (absolute < 0) return 'down';
  return 'flat';
}

module.exports = { computeChange, direction, round };
