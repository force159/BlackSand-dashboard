'use strict';
/**
 * BlackSand dashboard — canonical dataVersion hashing (Phase 2).
 *
 * Produces a deterministic SHA-256 over the NORMALIZED canonical business data only,
 * using Node's built-in `crypto` (no hashing dependency). The same seed data always
 * yields the same hash; changing any business value (e.g. one tenant area) changes it.
 *
 * Included: project slugs/names/addresses, category code/label/totalArea/
 * occupancySource/explicitLeasedPct, lease tenantName/type/area/leaseDate/logoPath/
 * sourceRecordKey, building name/code/totalArea, department code/label/totals.
 * Excluded: DB primary keys, created/updated timestamps, seed execution time, sync
 * duration, warnings, and any non-semantic ordering.
 *
 * Determinism: projects sorted by slug, categories by code, buildings by
 * sourceRecordKey-equivalent (name), leases by sourceRecordKey, departments by code.
 */

const crypto = require('crypto');

function canonicalize(normalized) {
  const projects = [...normalized.projects]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      address: p.address,
      categories: [...p.categories]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => ({
          code: c.code,
          label: c.label,
          totalArea: c.totalArea,
          occupancySource: c.occupancySource,
          explicitLeasedPct: c.explicitLeasedPct,
        })),
      buildings: [...p.buildings]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          name: b.name,
          code: b.code,
          totalArea: b.totalArea,
          departments: [...b.departments]
            .sort((x, y) => x.code.localeCompare(y.code))
            .map((d) => ({ code: d.code, label: d.label, totalArea: d.totalArea, leasedArea: d.leasedArea })),
        })),
      leases: [...p.leases]
        .sort((a, b) => a.sourceRecordKey.localeCompare(b.sourceRecordKey))
        .map((l) => ({
          sourceRecordKey: l.sourceRecordKey,
          tenantName: l.tenantName,
          tenantType: l.tenantType,
          area: l.area,
          leaseDate: l.leaseDate,
          logoPath: l.logoPath,
        })),
    }));

  return { seedVersion: normalized.seedVersion, projects };
}

/** Compute the canonical dataVersion (hex SHA-256) for a normalized seed dataset. */
function computeDataVersion(normalized) {
  const canonical = canonicalize(normalized);
  const json = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(json).digest('hex');
}

module.exports = { canonicalize, computeDataVersion };
