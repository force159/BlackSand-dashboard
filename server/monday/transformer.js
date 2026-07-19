'use strict';
/**
 * BlackSand dashboard — canonical → repository-model transformer (Phase 6).
 *
 * Groups the FLAT canonical dataset (mapper output) into the SAME nested per-project
 * structure the seed pipeline produces (projects → categories/buildings/leases), so
 * persistence and /api/dashboard treat Monday data identically to seed data. Strings
 * are trimmed, area precision is preserved, building total_area is derived from its
 * department totals (mirroring the frontend's buildingOverall). No business rule is
 * invented — Monday leases keep source='monday' and use externalId (Monday item id)
 * as their stable identity (source_record_key stays null for Monday rows).
 */

const { activeFlag } = require('./status');

const trim = (s) => (s == null ? null : String(s).trim());

function transformCanonicalToRepositoryModel(dataset) {
  const byProject = new Map();
  const ensure = (slug) => {
    if (!byProject.has(slug)) byProject.set(slug, { slug, name: null, address: null, externalId: null, categories: [], buildings: [], leases: [] });
    return byProject.get(slug);
  };

  for (const p of dataset.projects || []) {
    const proj = ensure(p.slug);
    proj.name = trim(p.name);
    proj.address = trim(p.address);
    proj.externalId = p.externalId != null ? String(p.externalId) : null;
  }
  for (const c of dataset.categories || []) {
    ensure(c.projectSlug).categories.push({
      code: c.code, label: trim(c.label),
      // Preserve-existing → null totalArea + flag (persistence keeps the stored value,
      // never overwrites with 0). Otherwise the validated finite config value.
      totalArea: c.preserveTotalArea ? null : (c.totalArea != null && Number.isFinite(c.totalArea) ? c.totalArea : null),
      preserveTotalArea: Boolean(c.preserveTotalArea),
      occupancySource: c.occupancySource || 'leases',
      explicitLeasedPct: c.explicitLeasedPct != null ? c.explicitLeasedPct : null,
      sortOrder: c.sortOrder != null ? c.sortOrder : 0,
    });
  }
  // Buildings + departments (present only for building-grain boards; empty otherwise).
  const buildingKey = (b) => `${b.projectSlug}::${b.externalId || b.name}`;
  const buildingByKey = new Map();
  for (const b of dataset.buildings || []) {
    const rec = {
      name: trim(b.name), code: b.code != null ? trim(b.code) : null,
      externalId: b.externalId != null ? String(b.externalId) : null,
      sortOrder: b.sortOrder != null ? b.sortOrder : 0, totalArea: 0, departments: [],
    };
    buildingByKey.set(buildingKey(b), rec);
    ensure(b.projectSlug).buildings.push(rec);
  }
  for (const d of dataset.departments || []) {
    const key = `${d.projectSlug}::${d.buildingRef}`;
    const b = buildingByKey.get(key);
    if (!b) continue; // department without a resolvable building is dropped (validator warns)
    b.departments.push({
      code: d.code, label: trim(d.label),
      totalArea: Number.isFinite(d.totalArea) ? d.totalArea : 0,
      leasedArea: Number.isFinite(d.leasedArea) ? d.leasedArea : 0,
      categoryCode: d.code === 'offices' ? 'office' : d.code,
    });
  }
  for (const b of buildingByKey.values()) {
    b.totalArea = b.departments.reduce((s, d) => s + (Number.isFinite(d.totalArea) ? d.totalArea : 0), 0);
  }
  for (const l of dataset.leases || []) {
    const status = l.status || 'unknown';
    ensure(l.projectSlug).leases.push({
      externalId: String(l.externalId),
      categoryCode: l.categoryCode,
      unitCode: l.unitCode != null ? trim(l.unitCode) : null, // Monday item name → building allocation key
      tenantName: trim(l.tenantName),
      tenantType: l.tenantType != null ? trim(l.tenantType) : null,
      area: l.area,
      leaseDate: l.leaseDate || null,
      status,                                 // canonical status
      isActive: activeFlag(status),           // current-state inclusion (0/1) — drives is_active
      buildingRef: l.buildingRef != null ? trim(l.buildingRef) : null, // diagnostic (buildingSource=manual)
      logoPath: l.logoPath || null,
      sourceUpdatedAt: l.sourceUpdatedAt || null,
    });
  }

  return { source: 'monday', projects: [...byProject.values()].sort((a, b) => a.slug.localeCompare(b.slug)) };
}

module.exports = { transformCanonicalToRepositoryModel };
