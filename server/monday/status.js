'use strict';
/**
 * BlackSand dashboard — canonical lease status model + inclusion rules (Phase 6 hardening).
 *
 * ONE central place that (a) maps Monday status labels → canonical statuses via the
 * mapping's `statusMap`, (b) defines which canonical statuses count toward occupancy /
 * tenant-count / velocity / new-leasing, and (c) derives a lease's `is_active` current-
 * state flag. Status logic is NOT scattered across repositories/services.
 *
 * Policy (documented; overridable per-mapping later): unknown status is an ERROR — it
 * NEVER defaults to active.
 */

const CANONICAL_STATUSES = ['active', 'future', 'terminated', 'cancelled', 'expired', 'draft', 'unknown'];

// Business inclusion rules per canonical status. `active` = counts as current-state
// occupancy/tenant. Conservative defaults; future/velocity nuance is deferred to Phase 7
// business confirmation (kept OUT of current-state by default).
const INCLUSION = {
  active: { occupancy: true, tenantCount: true, velocity: true, newLeasing: true },
  future: { occupancy: false, tenantCount: false, velocity: false, newLeasing: false },
  terminated: { occupancy: false, tenantCount: false, velocity: false, newLeasing: false },
  cancelled: { occupancy: false, tenantCount: false, velocity: false, newLeasing: false },
  expired: { occupancy: false, tenantCount: false, velocity: false, newLeasing: false },
  draft: { occupancy: false, tenantCount: false, velocity: false, newLeasing: false },
  unknown: { occupancy: false, tenantCount: false, velocity: false, newLeasing: false },
};

/**
 * Resolve a raw (already column-adapted) status value to a canonical status using the
 * board's statusMap. Returns { canonical, known }.
 *   - No status column mapped at all → treated as 'active' with known=true ONLY when
 *     the board explicitly declares `statusOptional: true`; otherwise 'unknown'.
 *   - A mapped label present in statusMap → its canonical value.
 *   - A label NOT in statusMap → 'unknown' (known=false) → validation error.
 */
function resolveStatus(rawStatus, boardConfig) {
  const statusMap = (boardConfig && boardConfig.statusMap) || null;
  if (rawStatus == null || rawStatus === '') {
    // No status supplied. If the board opts out of status entirely, treat as active.
    if (boardConfig && boardConfig.statusOptional === true) return { canonical: 'active', known: true };
    return { canonical: 'unknown', known: false };
  }
  if (!statusMap) {
    // A status was supplied but the board provides no map → cannot classify → unknown.
    return { canonical: 'unknown', known: false };
  }
  const mapped = statusMap[rawStatus];
  if (mapped && CANONICAL_STATUSES.includes(mapped)) return { canonical: mapped, known: true };
  return { canonical: 'unknown', known: false };
}

/** Does this canonical status count toward current-state (drives is_active)? */
function isCurrentState(canonicalStatus) {
  const rule = INCLUSION[canonicalStatus] || INCLUSION.unknown;
  return rule.tenantCount === true; // "current-state" = counts as a live tenant/lease
}

/** 1/0 is_active for persistence, from a canonical status. */
function activeFlag(canonicalStatus) {
  return isCurrentState(canonicalStatus) ? 1 : 0;
}

module.exports = { CANONICAL_STATUSES, INCLUSION, resolveStatus, isCurrentState, activeFlag };
