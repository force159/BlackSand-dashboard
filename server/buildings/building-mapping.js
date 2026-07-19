'use strict';
/**
 * BlackSand dashboard — AUTHORITATIVE unit→building mapping (Phase 8, buildings).
 *
 * This is the SINGLE source of truth for how a Monday unit code maps to a building,
 * PER PROJECT. The two projects use deliberately different strategies and must never
 * be cross-applied:
 *   - Town Center: the FIRST letter of the unit code (A–G) identifies Building 1–7.
 *   - Business Address: an EXPLICIT lookup table from the Excel truth guide (no
 *     last-digit / pattern inference). C06 and C07 are intentionally UNASSIGNED
 *     (excluded from building allocation) — their raw records are preserved elsewhere.
 *
 * Pure data + pure functions: no I/O, no Monday, no SQL. Category comes from the
 * existing Monday mapping (group) — never inferred here from the unit code.
 */

// ── Unit-code normalization (matching form) ─────────────────────────────────
// null/undefined → ''. NFKC. Trim. Strip ONE pair of fully-surrounding parentheses
// (so "(A-GF-R01)" → "A-GF-R01" but "(F-GF-01) Outdoor" keeps its parens/suffix).
// Uppercase. Collapse internal whitespace runs to a single space. The ORIGINAL text is
// always preserved separately by callers (this returns only the matching form).
function normalizeUnitCode(raw) {
  let s = String(raw == null ? '' : raw).normalize('NFKC').trim();
  if (s.length >= 2 && s[0] === '(' && s[s.length - 1] === ')') s = s.slice(1, -1).trim();
  return s.toUpperCase().replace(/\s+/g, ' ');
}

// ── Town Center: first letter A–G → Building 1–7 ────────────────────────────
const TOWN_CENTER_BUILDING_COUNT = 7;
// Returns the building number (1–7) or null when no authoritative leading letter is
// present (malformed / blank / a leading letter outside A–G). A leading "(" is allowed
// (e.g. "(F-GF-01) Outdoor" → F → 6). Trailing notes never affect the leading letter.
function parseTownCenterBuilding(rawUnit) {
  const norm = normalizeUnitCode(rawUnit);
  const m = norm.match(/^\(?\s*([A-G])/);
  if (!m) return null;
  return m[1].charCodeAt(0) - 'A'.charCodeAt(0) + 1;
}

// ── Business Address: explicit lookup (Excel truth guide) ───────────────────
const BUSINESS_ADDRESS_BUILDING_COUNT = 5;
const BUSINESS_ADDRESS_UNIT_TO_BUILDING = {
  // Building 1
  S01: 1, D01: 1, D101: 1, D201: 1, D301: 1, D401: 1, D501: 1, D601: 1,
  // Building 2
  R01: 2, C01: 2, C02: 2, D102: 2, D202: 2, D302: 2, D402: 2, D502: 2, D602: 2,
  // Building 3
  R02: 3, C03: 3, R03: 3, C04: 3, D103: 3, D203: 3, D303: 3, D403: 3, D503: 3, D603: 3,
  // Building 4
  R04: 4, C05: 4, D104: 4, D204: 4, D304: 4, D404: 4, D504: 4, D604: 4,
  // Building 5
  R05: 5, R06: 5, C08: 5,
};
// C06 / C07 are intentionally NOT in Buildings 1–5 (authoritative truth guide). They are
// excluded from building allocation only — raw records are preserved elsewhere.
const BUSINESS_ADDRESS_EXCLUDED = new Set(['C06', 'C07']);

// Returns { building: number|null, excluded: boolean }. There is DELIBERATELY no
// last-digit / pattern fallback: an unknown code stays unassigned (building null,
// excluded false) and must surface in diagnostics.
function lookupBusinessAddressBuilding(rawUnit) {
  const code = normalizeUnitCode(rawUnit);
  if (BUSINESS_ADDRESS_EXCLUDED.has(code)) return { building: null, excluded: true };
  const b = BUSINESS_ADDRESS_UNIT_TO_BUILDING[code];
  return { building: b != null ? b : null, excluded: false };
}

// ── Project dispatcher ──────────────────────────────────────────────────────
// Resolve a unit for a project WITHOUT cross-applying strategies.
// → { building: number|null, status: 'assigned'|'excluded'|'unassigned', normalized }
function resolveBuildingForUnit(projectSlug, rawUnit) {
  const normalized = normalizeUnitCode(rawUnit);
  if (projectSlug === 'town-center') {
    const building = parseTownCenterBuilding(rawUnit);
    return { building, status: building != null ? 'assigned' : 'unassigned', normalized };
  }
  if (projectSlug === 'business-address') {
    const { building, excluded } = lookupBusinessAddressBuilding(rawUnit);
    if (excluded) return { building: null, status: 'excluded', normalized };
    return { building, status: building != null ? 'assigned' : 'unassigned', normalized };
  }
  // Unknown project → no authoritative strategy; caller keeps it out of allocation.
  return { building: null, status: 'unassigned', normalized };
}

// Expected category per the truth guide — used ONLY to REPORT mismatches, NEVER to
// allocate (allocation always uses Monday's authoritative mapped category). Business
// Address: D-prefixed units are Offices, R/C/S-prefixed are Retail (matches the truth
// guide exactly). Town Center: category is backend-authoritative and the parser rule
// forbids deriving it from the code (GF/FF/SF do NOT imply category) → return null.
function expectedCategoryForUnit(projectSlug, rawUnit) {
  if (projectSlug !== 'business-address') return null;
  const code = normalizeUnitCode(rawUnit);
  if (/^D/.test(code)) return 'office';
  if (/^[RCS]/.test(code)) return 'retail';
  return null;
}

function buildingCountFor(projectSlug) {
  if (projectSlug === 'town-center') return TOWN_CENTER_BUILDING_COUNT;
  if (projectSlug === 'business-address') return BUSINESS_ADDRESS_BUILDING_COUNT;
  return 0;
}

module.exports = {
  normalizeUnitCode,
  parseTownCenterBuilding,
  lookupBusinessAddressBuilding,
  resolveBuildingForUnit,
  expectedCategoryForUnit,
  buildingCountFor,
  TOWN_CENTER_BUILDING_COUNT,
  BUSINESS_ADDRESS_BUILDING_COUNT,
  BUSINESS_ADDRESS_UNIT_TO_BUILDING,
  BUSINESS_ADDRESS_EXCLUDED,
};
