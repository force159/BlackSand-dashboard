'use strict';
/**
 * BlackSand dashboard — canonical dataset validator (Phase 6).
 *
 * Validates a CANONICAL dataset (mapper output) before it may be persisted. Findings
 * are ERROR (blocks the whole sync — all-or-nothing), WARNING (kept, reported), or
 * INFO (counts). A sync with ANY error is rejected and SQLite is left untouched, so
 * corrupt or partial Monday data can never enter the database.
 */

const path = require('path');
const { OCCUPANCY_SOURCES } = require('./schema');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateCanonicalDataset(dataset, options = {}) {
  const errors = [], warnings = [], info = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m), note = (m) => info.push(m);
  const projectRoot = options.projectRoot || PROJECT_ROOT;

  const projects = dataset.projects || [];
  const categories = dataset.categories || [];
  const buildings = dataset.buildings || [];
  const departments = dataset.departments || [];
  const leases = dataset.leases || [];

  const stats = { projects: projects.length, categories: categories.length, buildings: buildings.length, departments: departments.length, leases: leases.length, mismatches: 0, missingLeaseDates: 0 };

  // ── projects ──
  const projectSlugs = new Set();
  const externalIds = new Set();
  for (const p of projects) {
    if (!p.slug || !SLUG_RE.test(p.slug)) err(`project slug "${p.slug}" missing/not normalized`);
    if (!p.name) err(`project "${p.slug}" missing name`);
    if (p.source !== 'monday') err(`project "${p.slug}" source must be 'monday' (got '${p.source}')`);
    if (projectSlugs.has(p.slug)) err(`duplicate project slug "${p.slug}"`);
    projectSlugs.add(p.slug);
    if (p.externalId) {
      if (externalIds.has('P:' + p.externalId)) err(`duplicate project externalId "${p.externalId}"`);
      externalIds.add('P:' + p.externalId);
    }
    if (!p.address) warn(`project "${p.slug}" has no address`);
  }

  // ── categories ──
  const catByProject = new Map(); // slug -> Set(codes)
  for (const c of categories) {
    if (!projectSlugs.has(c.projectSlug)) err(`category "${c.code}" references unknown project "${c.projectSlug}"`);
    if (!c.code) err(`category in "${c.projectSlug}" has no code`);
    if (!c.label) err(`category "${c.code}" in "${c.projectSlug}" has no label`);
    // Total GLA must have an EXPLICIT source — a finite config value (>=0, zero allowed)
    // OR preserve-existing. It is NEVER silently defaulted to 0 (would overwrite valid GLA).
    if (c.preserveTotalArea) {
      /* ok: persistence keeps the existing stored total_area */
    } else if (c.totalArea == null) {
      err(`category "${c.projectSlug}/${c.code}" has no total GLA source (set a config value or totalAreaSource:"preserve-existing")`);
    } else if (!Number.isFinite(c.totalArea) || c.totalArea < 0) {
      err(`category "${c.projectSlug}/${c.code}" totalArea invalid (must be a finite number >= 0)`);
    }
    if (!OCCUPANCY_SOURCES.includes(c.occupancySource)) err(`category "${c.projectSlug}/${c.code}" occupancySource "${c.occupancySource}" not canonical`);
    if (c.explicitLeasedPct != null && (!Number.isFinite(c.explicitLeasedPct) || c.explicitLeasedPct < 0 || c.explicitLeasedPct > 1)) {
      err(`category "${c.projectSlug}/${c.code}" explicitLeasedPct ${c.explicitLeasedPct} out of 0..1 (percent-vs-fraction?)`);
    }
    if (!catByProject.has(c.projectSlug)) catByProject.set(c.projectSlug, new Set());
    const set = catByProject.get(c.projectSlug);
    if (set.has(c.code)) err(`duplicate category code "${c.code}" in project "${c.projectSlug}"`);
    set.add(c.code);
  }
  for (const slug of projectSlugs) {
    if (!catByProject.has(slug) || catByProject.get(slug).size === 0) err(`project "${slug}" has no categories`);
  }

  // ── leases ──
  const leaseExternalIds = new Set();
  for (const l of leases) {
    const ref = l.externalId || l.tenantName || '(unknown)';
    if (!l.externalId) err(`lease "${ref}" has no externalId (Monday item id)`);
    else {
      if (leaseExternalIds.has(l.externalId)) err(`duplicate lease externalId "${l.externalId}"`);
      leaseExternalIds.add(l.externalId);
    }
    if (!projectSlugs.has(l.projectSlug)) err(`lease "${ref}" references unknown project "${l.projectSlug}"`);
    if (!l.tenantName) err(`lease "${ref}" has empty tenantName`);
    if (!Number.isFinite(l.area)) err(`lease "${ref}" area is not a finite number`);
    else if (l.area < 0) err(`lease "${ref}" area is negative`);
    // Unknown status is an ERROR — it must NEVER be treated as active.
    if (l.statusKnown === false) err(`lease "${ref}" has unknown status "${l.rawStatus == null ? '' : l.rawStatus}" (add it to the board statusMap, or set statusOptional)`);
    if (l.categoryCode == null) warn(`lease "${ref}" has no category (will not map to retail/office)`);
    else if (catByProject.has(l.projectSlug) && !catByProject.get(l.projectSlug).has(l.categoryCode)) {
      err(`lease "${ref}" references unknown category "${l.categoryCode}" for project "${l.projectSlug}"`);
    }
    if (l.leaseDate == null) stats.missingLeaseDates++;
    else if (!ISO_DATE.test(l.leaseDate)) err(`lease "${ref}" leaseDate "${l.leaseDate}" is not YYYY-MM-DD`);
    if (l.logoPath) {
      if (path.isAbsolute(l.logoPath)) err(`lease "${ref}" logoPath is absolute`);
      else {
        const resolved = path.resolve(projectRoot, l.logoPath);
        if (!resolved.startsWith(path.resolve(projectRoot) + path.sep)) err(`lease "${ref}" logoPath escapes project root`);
      }
    }
  }

  // ── buildings / departments ──
  const buildingRefs = new Set(buildings.map((b) => `${b.projectSlug}:${b.externalId || b.name}`));
  for (const b of buildings) {
    if (!projectSlugs.has(b.projectSlug)) err(`building "${b.name}" references unknown project "${b.projectSlug}"`);
    if (!b.name) err(`building in "${b.projectSlug}" has no name`);
  }
  for (const d of departments) {
    if (!d.code) err('building department has no code');
    if (Number.isFinite(d.leasedArea) && Number.isFinite(d.totalArea) && d.leasedArea > d.totalArea) {
      err(`department "${d.code}" leasedArea ${d.leasedArea} > totalArea ${d.totalArea}`);
    }
  }
  void buildingRefs;

  // ── explicit-vs-derived reconciliation (preserved prototype behaviour → WARNING) ──
  for (const c of categories) {
    if (c.explicitLeasedPct != null && Number.isFinite(c.totalArea)) {
      const leaseSum = leases.filter((l) => l.projectSlug === c.projectSlug && l.categoryCode === c.code && Number.isFinite(l.area)).reduce((a, l) => a + l.area, 0);
      const explicit = c.totalArea * c.explicitLeasedPct;
      if (Math.abs(explicit - leaseSum) > 0.5) {
        stats.mismatches++;
        warn(`project "${c.projectSlug}" category "${c.code}": explicit leased ${explicit.toFixed(2)} m² differs from lease-row sum ${leaseSum.toFixed(2)} m² — preserved (sources not reconciled)`);
      }
    }
  }

  note(`canonical dataset: projects=${stats.projects} categories=${stats.categories} leases=${stats.leases} buildings=${stats.buildings} departments=${stats.departments}`);
  if (stats.missingLeaseDates) note(`${stats.missingLeaseDates} lease(s) have no leaseDate`);

  return { ok: errors.length === 0, errors, warnings, info, stats };
}

module.exports = { validateCanonicalDataset };
