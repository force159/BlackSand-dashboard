'use strict';
/**
 * BlackSand dashboard — building allocation/aggregation (Phase 8, buildings).
 *
 * Pure function: given a project's Monday lease/unit records, produce the
 * frontend-compatible `buildings[]` array (Portfolio Occupancy by Building) using the
 * AUTHORITATIVE per-project mapping (building-mapping.js), plus a safe diagnostics
 * report. No I/O, no SQL, no mutation of the input.
 *
 * Rules (from the Phase 8 spec):
 *   - total GLA  = Σ valid GLA of INCLUDED units assigned to the building (any status).
 *   - leased GLA = Σ valid GLA of included units whose status qualifies as Leased.
 *   - vacant GLA = total − leased (never negative).
 *   - occupancy % = leased/total×100 (0 when total is 0 — never divide-by-zero).
 *   - category comes from the record (retail/office), never inferred from the unit code.
 *   - each source item counted once (dedup by externalId); C06/C07 excluded (BA);
 *     unknown units unassigned; malformed/negative GLA and unknown status reported.
 *   - Town Center outputs Buildings 1–7; Business Address outputs 1–5 (never 6/7).
 */

const { resolveBuildingForUnit, expectedCategoryForUnit, buildingCountFor } = require('./building-mapping');

// Category code → department key/label used by the existing frontend + API contract.
const DEPT_OF_CATEGORY = { retail: { key: 'retail', label: 'Retail' }, office: { key: 'offices', label: 'Offices' } };
const KNOWN_STATUSES = new Set(['active', 'future', 'terminated', 'cancelled', 'expired', 'draft']);

// A finite, non-negative number, or null (reject null/undefined/blank/NaN/Infinity/
// negative/mixed). Blank is NEVER treated as zero (Number(null)/Number('') are 0, so
// these are rejected explicitly before coercion).
function validGLA(area) {
  if (area == null) return null;
  if (typeof area === 'string' && area.trim() === '') return null;
  const n = (typeof area === 'number') ? area : Number(area);
  return (Number.isFinite(n) && n >= 0) ? n : null;
}
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {string} projectSlug        'town-center' | 'business-address'
 * @param {Array}  leases  each: { externalId, unitCode, area, categoryCode:'retail'|'office', status, isActive }
 * @returns {{ buildings: Array, diagnostics: object }}
 */
function allocateBuildings(projectSlug, leases) {
  const count = buildingCountFor(projectSlug);
  // Canonical building set (1..count), each with both departments zeroed.
  const acc = new Map();
  for (let n = 1; n <= count; n++) {
    acc.set(n, { retail: { leased: 0, total: 0 }, offices: { leased: 0, total: 0 } });
  }

  const diag = {
    projectSlug,
    recordsInspected: 0,
    validGLACount: 0,
    assignedCount: 0,
    unassigned: [],          // [{ externalId, unitCode }]
    excluded: [],            // [{ externalId, unitCode }] (BA C06/C07)
    prefixes: {},            // TC: leading-letter → count
    categoryMismatches: [],  // [{ externalId, unitCode, categoryCode }]
    duplicateIds: [],        // [externalId]
    missingGLACount: 0,
    missingGLA: [],          // [{ externalId, unitCode }]
    unknownStatusCount: 0,
    unknownStatus: [],       // [{ externalId, unitCode, status }]
  };

  const seen = new Set();
  for (const l of Array.isArray(leases) ? leases : []) {
    const ext = l && l.externalId != null ? String(l.externalId) : null;
    if (ext != null && seen.has(ext)) { diag.duplicateIds.push(ext); continue; } // count each source item once
    if (ext != null) seen.add(ext);
    diag.recordsInspected++;

    const rawUnit = l ? l.unitCode : null;
    // Track discovered prefix (first normalized char) for Town Center diagnostics.
    const first = String(rawUnit == null ? '' : rawUnit).replace(/^[\s(]+/, '').charAt(0).toUpperCase() || '(none)';
    diag.prefixes[first] = (diag.prefixes[first] || 0) + 1;

    const res = resolveBuildingForUnit(projectSlug, rawUnit);
    if (res.status === 'excluded') { diag.excluded.push({ externalId: ext, unitCode: rawUnit }); continue; }
    if (res.status === 'unassigned' || res.building == null) { diag.unassigned.push({ externalId: ext, unitCode: rawUnit }); continue; }

    const dept = DEPT_OF_CATEGORY[l.categoryCode];
    if (!dept) { diag.categoryMismatches.push({ externalId: ext, unitCode: rawUnit, expected: null, actual: l.categoryCode, reason: 'unmapped-category' }); continue; }
    // REPORT (do not move) a truth-guide-vs-Monday category mismatch. Allocation still uses
    // the AUTHORITATIVE Monday category (dept) so the building total stays complete; the
    // discrepancy is surfaced for resolution in Monday.
    const expected = expectedCategoryForUnit(projectSlug, rawUnit);
    if (expected && expected !== l.categoryCode) {
      diag.categoryMismatches.push({ externalId: ext, unitCode: rawUnit, expected, actual: l.categoryCode, reason: 'truth-guide-mismatch' });
    }

    const gla = validGLA(l.area);
    if (gla == null) { diag.missingGLACount++; diag.missingGLA.push({ externalId: ext, unitCode: rawUnit }); continue; }
    diag.validGLACount++;

    // Leased iff canonical status is 'active' (Phase 7 rule). Unknown status is reported
    // and contributes to TOTAL but never to LEASED (never assumed leased or vacant).
    const status = l.status == null ? '' : String(l.status);
    if (status && !KNOWN_STATUSES.has(status)) { diag.unknownStatusCount++; diag.unknownStatus.push({ externalId: ext, unitCode: rawUnit, status }); }
    const isLeased = status === 'active' || l.isActive === 1;

    const bucket = acc.get(res.building)[dept.key];
    bucket.total += gla;
    if (isLeased) bucket.leased += gla;
    diag.assignedCount++;
  }

  // Emit the canonical building set in numeric order, both departments present (zeroed
  // when empty), values rounded to the dashboard's 2-decimal display precision.
  const buildings = [];
  const perBuilding = {};
  for (let n = 1; n <= count; n++) {
    const b = acc.get(n);
    const departments = {
      retail: { label: 'Retail', leased: round2(b.retail.leased), total: round2(b.retail.total) },
      offices: { label: 'Offices', leased: round2(b.offices.leased), total: round2(b.offices.total) },
    };
    buildings.push({ id: String(n), name: 'Building ' + n, departments });
    const total = departments.retail.total + departments.offices.total;
    const leased = departments.retail.leased + departments.offices.leased;
    perBuilding[n] = { total: round2(total), leased: round2(leased), vacant: round2(Math.max(0, total - leased)), occupancyPct: total > 0 ? round2((leased / total) * 100) : 0 };
  }
  diag.perBuilding = perBuilding;
  return { buildings, diagnostics: diag };
}

module.exports = { allocateBuildings, validGLA };
