'use strict';
/**
 * BlackSand dashboard — seed normalizer (Phase 2).
 *
 * Converts the reviewed bootstrap seed objects (current-dashboard-data.js) into
 * canonical backend fields. It normalizes slugs, category codes, strings and dates,
 * derives each lease's deterministic `source_record_key`, reproduces the prototype's
 * deterministic mock lease dates against a FIXED anchor, and derives each building's
 * total_area from its own department totals (mirroring the frontend's buildingOverall).
 *
 * It preserves duplicate lease rows and does NOT invent any new business rule — it
 * only reproduces existing prototype behaviour deterministically.
 */

/** Project slug — mirrors the frontend `projectSlug()` exactly. */
function normalizeSlug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Category code — lowercase, trim, non-alphanumeric runs → single hyphen. */
function normalizeCode(code) {
  return String(code)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Trim surrounding whitespace; preserve intentional capitalization/spelling. */
function normalizeString(s) {
  return s == null ? null : String(s).trim();
}

/** Parse a finite number; do NOT round (precision preserved for storage). */
function parseArea(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate an authored lease date is a real YYYY-MM-DD calendar date; else null. */
function normalizeDate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!ISO_DATE_RE.test(s)) return null;
  const d = new Date(s + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Reproduce the frontend's deterministic mock lease date, but anchored to a FIXED
 * date so the seed is reproducible across runs/days (the live frontend uses
 * `new Date()`, which is not). Same hash → same `daysAgo` offset as the prototype.
 *   seedStr = project.name + categoryIndex + tenantName   (matches the frontend)
 *   i       = tenant index within its category (0-based)
 * PROTOTYPE-DERIVED — never a real lease date.
 */
function prototypeMockDate(seedStr, i, anchorISO) {
  let h = 0;
  for (let c = 0; c < seedStr.length; c++) h = (h * 31 + seedStr.charCodeAt(c)) >>> 0;
  const daysAgo = (h + i * 37) % 200;
  const d = new Date(anchorISO + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Zero-pad an integer to width 3 (for stable, sortable seed record keys). */
function pad3(n) {
  return String(n).padStart(3, '0');
}

/**
 * Normalize the whole seed dataset. Returns a canonical structure the validator,
 * hasher and coordinator all consume. Pure — no I/O.
 */
function normalizeSeedData(raw) {
  const anchor = raw.mockDateAnchor;
  const projects = raw.projects.map((p) => {
    const slug = normalizeSlug(p.slug || p.name);

    const categories = p.categories.map((c) => ({
      code: normalizeCode(c.code),
      label: normalizeString(c.label),
      totalArea: parseArea(c.totalArea),
      occupancySource: normalizeString(c.occupancySource),
      explicitLeasedPct: c.explicitLeasedPct == null ? null : Number(c.explicitLeasedPct),
      sortOrder: c.sortOrder ?? 0,
    }));
    const categoryOrder = categories.map((c) => c.code); // retail=0, office=1 (frontend order)

    // Leases: assign per-category running index for both the source key and the
    // prototype mock-date index (which mirrors the frontend's per-category index).
    const perCategoryCount = {};
    const leases = p.leases.map((l) => {
      const categoryCode = normalizeCode(l.categoryCode);
      const idx = perCategoryCount[categoryCode] || 0; // 0-based within category
      perCategoryCount[categoryCode] = idx + 1;

      let leaseDate = normalizeDate(l.leaseDate);
      let mockDate = Boolean(l.mockDate);
      if (mockDate && !leaseDate) {
        const ci = categoryOrder.indexOf(categoryCode); // 0 or 1, matches frontend ci
        leaseDate = prototypeMockDate(String(p.name) + ci + l.tenantName, idx, anchor);
      }

      return {
        categoryCode,
        sourceRecordKey: `seed:lease:${slug}:${categoryCode}:${pad3(idx + 1)}`,
        tenantName: normalizeString(l.tenantName),
        tenantType: normalizeString(l.tenantType),
        area: parseArea(l.area),
        leaseDate,
        mockDate,
        logoPath: l.logoPath ? normalizeString(l.logoPath) : null,
        status: l.status ? normalizeString(l.status) : null,
      };
    });

    const buildings = p.buildings.map((b) => {
      const departments = b.departments.map((d) => ({
        code: normalizeCode(d.code),
        label: normalizeString(d.label),
        totalArea: parseArea(d.totalArea),
        leasedArea: parseArea(d.leasedArea),
        // Link a department to the matching category where one exists: department
        // 'offices' ↔ category 'office'; others map by identical code.
        categoryCode: normalizeCode(d.code) === 'offices' ? 'office' : normalizeCode(d.code),
      }));
      // Building total_area = sum of its department totals (frontend buildingOverall).
      const totalArea = departments.reduce((s, d) => s + (Number.isFinite(d.totalArea) ? d.totalArea : 0), 0);
      return {
        name: normalizeString(b.name),
        code: b.code == null ? null : normalizeString(b.code),
        sortOrder: b.sortOrder ?? 0,
        totalArea,
        departments,
      };
    });

    return { slug, name: normalizeString(p.name), address: normalizeString(p.address), categories, buildings, leases };
  });

  return { source: raw.source, seedVersion: raw.seedVersion, mockDateAnchor: anchor, projects };
}

module.exports = {
  normalizeSlug,
  normalizeCode,
  normalizeString,
  parseArea,
  normalizeDate,
  prototypeMockDate,
  normalizeSeedData,
};
