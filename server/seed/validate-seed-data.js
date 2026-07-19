'use strict';
/**
 * BlackSand dashboard — seed validator (Phase 2).
 *
 * Validates the WHOLE normalized seed dataset before any database write and reports
 * all findings together. Findings are classified:
 *   ERROR   — blocks seeding (structural/invalid data).
 *   WARNING — known/expected prototype behaviour; reported, does not block.
 *   INFO    — counts and provenance.
 *
 * Pure except for an optional logo-existence check (fs), which is read-only.
 */

const path = require('path');
const fs = require('fs');
const { normalizeSlug, normalizeCode } = require('./normalize-seed-data');

const CANONICAL_OCCUPANCY_SOURCES = ['leases', 'explicit_percentage', 'building_totals'];

function makeReport() {
  const errors = [];
  const warnings = [];
  const info = [];
  return {
    errors, warnings, info,
    error: (m) => errors.push(m),
    warn: (m) => warnings.push(m),
    note: (m) => info.push(m),
  };
}

/** Sum tenant lease areas for a category within a project (for reconciliation only). */
function sumLeaseAreas(project, categoryCode) {
  return project.leases
    .filter((l) => l.categoryCode === categoryCode)
    .reduce((s, l) => s + (Number.isFinite(l.area) ? l.area : 0), 0);
}

/**
 * Validate the normalized dataset. options: { projectRoot?, checkLogos? }.
 * Returns { errors, warnings, info, stats }.
 */
function validateSeedData(normalized, options = {}) {
  const r = makeReport();
  const projectRoot = options.projectRoot || process.cwd();
  const checkLogos = options.checkLogos !== false;

  const stats = {
    projects: 0, categories: 0, leases: 0, buildings: 0, departments: 0,
    mockDateLeases: 0, duplicateTenantNameRows: 0, missingLogos: 0,
    townCenterMismatches: [],
  };

  if (normalized.source !== 'seed') {
    r.error(`dataset source must be 'seed' (got '${normalized.source}')`);
  }
  if (!Array.isArray(normalized.projects) || normalized.projects.length === 0) {
    r.error('seed dataset has no projects');
    return { ...pick(r), stats };
  }

  const seenSlugs = new Set();
  const allLeaseKeys = new Set();

  for (const p of normalized.projects) {
    stats.projects++;

    // ── projects ──
    if (!p.slug) r.error(`project "${p.name}" has no slug`);
    else if (p.slug !== normalizeSlug(p.slug)) r.error(`project slug "${p.slug}" is not normalized`);
    if (!p.name) r.error(`project "${p.slug}" has no name`);
    if (seenSlugs.has(p.slug)) r.error(`duplicate project slug "${p.slug}"`);
    seenSlugs.add(p.slug);
    if (!p.address) r.warn(`project "${p.slug}" has no address`);
    if (!Array.isArray(p.categories) || p.categories.length === 0) {
      r.error(`project "${p.slug}" has no categories`);
    }

    // ── categories ──
    const catCodes = new Set();
    const catByCode = new Map();
    for (const c of p.categories || []) {
      stats.categories++;
      if (!c.code) r.error(`project "${p.slug}": category has no code`);
      else if (c.code !== normalizeCode(c.code)) r.error(`project "${p.slug}": category code "${c.code}" not normalized`);
      if (!c.label) r.error(`project "${p.slug}": category "${c.code}" has no label`);
      if (!Number.isFinite(c.totalArea)) r.error(`project "${p.slug}": category "${c.code}" totalArea is not numeric`);
      else if (c.totalArea < 0) r.error(`project "${p.slug}": category "${c.code}" totalArea is negative`);
      if (catCodes.has(c.code)) r.error(`project "${p.slug}": duplicate category code "${c.code}"`);
      catCodes.add(c.code);
      catByCode.set(c.code, c);
      if (!CANONICAL_OCCUPANCY_SOURCES.includes(c.occupancySource)) {
        r.error(`project "${p.slug}": category "${c.code}" occupancySource "${c.occupancySource}" is not canonical`);
      }
      if (c.explicitLeasedPct != null) {
        if (!Number.isFinite(c.explicitLeasedPct)) r.error(`project "${p.slug}": category "${c.code}" explicitLeasedPct not numeric`);
        else if (c.explicitLeasedPct > 1 || c.explicitLeasedPct < 0) {
          r.error(`project "${p.slug}": category "${c.code}" explicitLeasedPct ${c.explicitLeasedPct} out of 0..1 (percent-vs-fraction mistake?)`);
        }
      }
    }

    // ── buildings ──
    const buildingNames = new Set();
    for (const b of p.buildings || []) {
      stats.buildings++;
      if (!b.name) r.error(`project "${p.slug}": building has no name`);
      if (!Number.isFinite(b.totalArea) || b.totalArea < 0) r.error(`project "${p.slug}": building "${b.name}" totalArea invalid`);
      if (typeof b.sortOrder !== 'number') r.error(`project "${p.slug}": building "${b.name}" sortOrder not numeric`);
      if (buildingNames.has(b.name)) r.error(`project "${p.slug}": duplicate building name "${b.name}"`);
      buildingNames.add(b.name);

      // ── building departments ──
      const deptCodes = new Set();
      for (const d of b.departments || []) {
        stats.departments++;
        if (!d.code) r.error(`project "${p.slug}" building "${b.name}": department has no code`);
        if (!d.label) r.error(`project "${p.slug}" building "${b.name}": department "${d.code}" has no label`);
        if (!Number.isFinite(d.totalArea) || d.totalArea < 0) r.error(`project "${p.slug}" building "${b.name}": department "${d.code}" totalArea invalid`);
        if (!Number.isFinite(d.leasedArea) || d.leasedArea < 0) r.error(`project "${p.slug}" building "${b.name}": department "${d.code}" leasedArea invalid`);
        if (Number.isFinite(d.totalArea) && Number.isFinite(d.leasedArea) && d.leasedArea > d.totalArea) {
          r.error(`project "${p.slug}" building "${b.name}": department "${d.code}" leasedArea ${d.leasedArea} > totalArea ${d.totalArea}`);
        }
        if (deptCodes.has(d.code)) r.error(`project "${p.slug}" building "${b.name}": duplicate department code "${d.code}"`);
        deptCodes.add(d.code);
        if (d.categoryCode && !catByCode.has(d.categoryCode)) {
          r.warn(`project "${p.slug}" building "${b.name}": department "${d.code}" references unknown category "${d.categoryCode}" (stored with null category link)`);
        }
      }
    }

    // ── leases ──
    const tenantNameCounts = new Map();
    for (const l of p.leases || []) {
      stats.leases++;
      if (!l.tenantName) r.error(`project "${p.slug}": lease ${l.sourceRecordKey} has empty tenantName`);
      if (!Number.isFinite(l.area)) r.error(`project "${p.slug}": lease ${l.sourceRecordKey} area not numeric`);
      else if (l.area < 0) r.error(`project "${p.slug}": lease ${l.sourceRecordKey} area negative`);
      if (l.leaseDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(l.leaseDate)) {
        r.error(`project "${p.slug}": lease ${l.sourceRecordKey} has malformed leaseDate "${l.leaseDate}"`);
      }
      if (!catByCode.has(l.categoryCode)) {
        r.error(`project "${p.slug}": lease ${l.sourceRecordKey} references unknown category "${l.categoryCode}"`);
      }
      if (allLeaseKeys.has(l.sourceRecordKey)) r.error(`duplicate lease source_record_key "${l.sourceRecordKey}"`);
      allLeaseKeys.add(l.sourceRecordKey);

      if (l.mockDate) stats.mockDateLeases++;

      // logo path safety + existence
      if (l.logoPath) {
        if (path.isAbsolute(l.logoPath)) {
          r.error(`project "${p.slug}": lease ${l.sourceRecordKey} logoPath is absolute ("${l.logoPath}")`);
        } else {
          const resolved = path.resolve(projectRoot, l.logoPath);
          if (!resolved.startsWith(path.resolve(projectRoot) + path.sep)) {
            r.error(`project "${p.slug}": lease ${l.sourceRecordKey} logoPath escapes project root ("${l.logoPath}")`);
          } else if (checkLogos && !fs.existsSync(resolved)) {
            stats.missingLogos++;
            r.warn(`project "${p.slug}": lease ${l.sourceRecordKey} logo "${l.logoPath}" missing (frontend falls back to initials)`);
          }
        }
      }

      tenantNameCounts.set(l.tenantName, (tenantNameCounts.get(l.tenantName) || 0) + 1);
    }
    // duplicate tenant-name rows (allowed — counted, warned once per project)
    let dupRows = 0;
    for (const [, n] of tenantNameCounts) if (n > 1) dupRows += n;
    stats.duplicateTenantNameRows += dupRows;

    if (stats.mockDateLeases > 0) {
      // one summary warning per project with mock dates (avoid 56 lines)
    }

    // ── cross-data reconciliation (prototype behaviour, WARN not ERROR) ──
    for (const c of p.categories || []) {
      if (c.explicitLeasedPct != null) {
        const leaseSum = sumLeaseAreas(p, c.code);
        const explicitLeased = c.totalArea * c.explicitLeasedPct;
        const diff = Math.abs(explicitLeased - leaseSum);
        if (diff > 0.5) {
          stats.townCenterMismatches.push({ slug: p.slug, code: c.code, explicitLeased, leaseSum, diff });
          r.warn(
            `project "${p.slug}" category "${c.code}": explicit leased ${explicitLeased.toFixed(2)} m² ` +
            `(${(c.explicitLeasedPct * 100).toFixed(1)}% of ${c.totalArea}) differs from lease-row sum ${leaseSum.toFixed(2)} m² ` +
            `— PRESERVED current prototype behaviour (sources not reconciled).`
          );
        }
      }
    }
  }

  // summary INFO
  r.note(`projects=${stats.projects} categories=${stats.categories} leases=${stats.leases} buildings=${stats.buildings} departments=${stats.departments}`);
  if (stats.mockDateLeases) r.note(`${stats.mockDateLeases} lease(s) carry PROTOTYPE-DERIVED mock dates (Town Center)`);
  r.note('future Monday external_id columns remain null; snapshot tables intentionally unused in Phase 2');

  return { ...pick(r), stats };
}

function pick(r) {
  return { errors: r.errors, warnings: r.warnings, info: r.info };
}

module.exports = { validateSeedData, CANONICAL_OCCUPANCY_SOURCES };
