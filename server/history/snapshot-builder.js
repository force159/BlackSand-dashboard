'use strict';
/**
 * Phase 9.1A — canonical snapshot builder (§8). PURE: no DB writes, no live-state
 * mutation, deterministic for identical inputs. Reuses live business logic — project
 * metrics come from the dashboard payload's `metrics` (the live computeMetrics), building
 * areas from the reused `allocateProjectBuildings`, tenant aggregation + velocity from the
 * live-mirrored `live-metrics`. It only shapes/normalizes; it never re-derives occupancy
 * with a second formula.
 */

const { resolveBuildingForUnit } = require('../buildings/building-mapping');
const { aggregateProjectTenants, computeVelocity, parseTenantArea } = require('./live-metrics');
const {
  HISTORY_SCHEMA_VERSION, HISTORY_CALCULATION_VERSION, HISTORY_METADATA_VERSION,
  roundArea, roundPercent,
} = require('./constants');

const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : (v == null ? null : Number(v));

/**
 * @param {object} args
 *   projectKey, projectName, address
 *   metrics            payload project.metrics (authoritative live values)
 *   buildingsPayload   payload project.buildings (authoritative building areas)
 *   allLeases          raw monday leases (ALL statuses): { externalId, tenantName, categoryCode, area, unitCode, status, isActive, leaseDate }
 *   capture            { capturedAtUtc, businessDate, timezone }
 *   sourceContext      { sourceType, sourceDataVersion, sourceSyncedAtUtc, sourceRecordCount }
 *   ids                { snapshotId, runId }
 * @returns canonical { project, buildings, tenants, provenance, warnings }
 */
function buildProjectSnapshot(args) {
  const { projectKey, projectName, address, metrics, buildingsPayload, allLeases, capture, sourceContext, ids } = args;
  const warnings = [];
  const leases = Array.isArray(allLeases) ? allLeases : [];
  const activeLeases = leases.filter((l) => l.isActive === 1 || l.isActive === true);

  // ── project-level unit counts (include C06/C07 — excluded only from BUILDINGS) ──
  const totalUnitCount = leases.length;
  const occupiedUnitCount = activeLeases.length;
  const vacantUnitCount = totalUnitCount - occupiedUnitCount;

  // ── unassigned / excluded (reuse the authoritative building mapping) ──
  let unassignedArea = 0, unassignedUnitCount = 0, excludedRecordCount = 0;
  const perBuilding = new Map(); // buildingKey → { units, occupied, vacant, names:Set(active) }
  for (const l of leases) {
    const res = l.unitCode != null ? resolveBuildingForUnit(projectKey, l.unitCode) : { status: 'unassigned' };
    const area = parseTenantArea(l.area);
    if (res.status === 'excluded') { excludedRecordCount += 1; continue; }
    if (res.status !== 'assigned' || res.building == null) {
      unassignedUnitCount += 1; if (area != null) unassignedArea += area; continue;
    }
    if (area == null) continue; // invalid GLA → not counted in building area basis
    const key = String(res.building);
    if (!perBuilding.has(key)) perBuilding.set(key, { units: 0, occupied: 0, vacant: 0, names: new Set() });
    const b = perBuilding.get(key);
    b.units += 1;
    const active = l.isActive === 1 || l.isActive === true;
    if (active) { b.occupied += 1; b.names.add(String(l.tenantName || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()); }
    else b.vacant += 1;
  }

  // ── tenants (project-wide aggregation matching the live directory / top-tenants) ──
  const tenantRows = aggregateProjectTenants(projectKey, activeLeases);

  // ── velocity (live rolling-90-day definition) ──
  const vel = computeVelocity(activeLeases, new Date(capture.capturedAtUtc));

  // ── project object (areas/percents normalized; nulls preserved, never faked) ──
  const m = metrics || {};
  const retailVacant = (num(m.retailGLA) != null && num(m.retailLeased) != null) ? Math.max(0, num(m.retailGLA) - num(m.retailLeased)) : null;
  const officeVacant = (num(m.officeGLA) != null && num(m.officeLeased) != null) ? Math.max(0, num(m.officeGLA) - num(m.officeLeased)) : null;
  const project = {
    projectKey, projectName: projectName || null,
    totalGla: roundArea(num(m.totalGLA)),
    leasedArea: roundArea(num(m.totalLeased)),
    vacantArea: roundArea(num(m.totalVacant)),
    occupancyPercent: roundPercent(num(m.overallLeasedPct)), // metrics.overallLeasedPct is a 0–100 string
    retailTotalArea: roundArea(num(m.retailGLA)),
    retailLeasedArea: roundArea(num(m.retailLeased)),
    retailVacantArea: roundArea(retailVacant),
    retailOccupancyPercent: roundPercent(num(m.retailPct)),
    officeTotalArea: roundArea(num(m.officeGLA)),
    officeLeasedArea: roundArea(num(m.officeLeased)),
    officeVacantArea: roundArea(officeVacant),
    officeOccupancyPercent: roundPercent(num(m.officePct)),
    activeLeaseCount: occupiedUnitCount,
    tenantCountRaw: num(m.totalTenants),          // lease-row count (live invariant)
    tenantCountAggregated: tenantRows.length,     // unique normalized tenants
    occupiedUnitCount, vacantUnitCount, totalUnitCount,
    leasingVelocityArea90d: roundArea(vel.area90d),
    leasingVelocityLeaseCount90d: vel.leaseCount90d,
    unassignedArea: roundArea(unassignedArea),
    unassignedUnitCount,
    excludedRecordCount,
  };

  // ── buildings (authoritative areas from the payload + reused-mapping counts) ──
  const buildings = (buildingsPayload || []).map((b) => {
    const r = (b.departments && b.departments.retail) || {};
    const o = (b.departments && b.departments.offices) || {};
    const rTotal = num(r.total), rLeased = num(r.leased), oTotal = num(o.total), oLeased = num(o.leased);
    const total = (rTotal || 0) + (oTotal || 0);
    const leased = (rLeased || 0) + (oLeased || 0);
    const stats = perBuilding.get(String(b.id)) || { units: null, occupied: null, vacant: null, names: null };
    return {
      buildingKey: String(b.id),
      buildingName: b.name || null,
      buildingOrder: /^\d+$/.test(String(b.id)) ? Number(b.id) : null,
      totalArea: roundArea(total),
      leasedArea: roundArea(leased),
      vacantArea: roundArea(Math.max(0, total - leased)),
      occupancyPercent: total > 0 ? roundPercent((leased / total) * 100) : 0,
      retailTotalArea: roundArea(rTotal), retailLeasedArea: roundArea(rLeased),
      retailVacantArea: roundArea(rTotal != null ? Math.max(0, rTotal - (rLeased || 0)) : null),
      retailOccupancyPercent: (rTotal && rTotal > 0) ? roundPercent((rLeased || 0) / rTotal * 100) : (rTotal === 0 ? 0 : null),
      officeTotalArea: roundArea(oTotal), officeLeasedArea: roundArea(oLeased),
      officeVacantArea: roundArea(oTotal != null ? Math.max(0, oTotal - (oLeased || 0)) : null),
      officeOccupancyPercent: (oTotal && oTotal > 0) ? roundPercent((oLeased || 0) / oTotal * 100) : (oTotal === 0 ? 0 : null),
      unitCount: stats.units,
      occupiedUnitCount: stats.occupied,
      vacantUnitCount: stats.vacant,
      tenantCountRaw: stats.occupied,               // active lease rows in the building
      tenantCountAggregated: stats.names ? stats.names.size : null,
      excludedRecordCount: 0,
    };
  });

  // ── tenants shaped for persistence ──
  const tenants = tenantRows.map((t) => ({
    tenantKey: t.tenantKey,
    tenantDisplayName: t.displayName,
    tenantNormalizedName: t.normalized,
    totalLeasedArea: roundArea(t.totalLeasedArea),
    leaseRecordCount: t.leaseRecordCount,
    unitCount: t.unitCount,
    buildingCount: t.buildingCount,
    buildingKeys: t.buildingKeys,
    primaryCategory: t.primaryCategory,
    categories: Object.fromEntries(Object.entries(t.categories).map(([k, v]) => [k, roundArea(v)])),
    rankByArea: t.rankByArea,
    isTop3: t.isTop3, isTop5: t.isTop5, isTop10: t.isTop10,
    activeLeaseCount: t.activeLeaseCount,
    earliestActiveStartDate: t.earliestActiveStartDate,
    latestActiveStartDate: t.latestActiveStartDate,
  }));

  // ── warnings (data-quality; non-blocking) ──
  if (unassignedUnitCount > 0) warnings.push({ code: 'UNASSIGNED_UNITS', message: unassignedUnitCount + ' unit(s) not assigned to any building', count: unassignedUnitCount });
  if (excludedRecordCount > 0) warnings.push({ code: 'EXCLUDED_RECORDS', message: excludedRecordCount + ' record(s) intentionally excluded from building allocation (e.g. C06/C07)', count: excludedRecordCount });
  if (tenants.length === 0) warnings.push({ code: 'NO_TENANTS', message: 'no aggregated tenants' });
  if (buildings.length === 0) warnings.push({ code: 'NO_BUILDINGS', message: 'no buildings' });
  if (project.totalGla != null && project.leasedArea != null && project.vacantArea != null) {
    const diff = Math.abs((project.leasedArea + project.vacantArea) - project.totalGla);
    if (diff > 0.5) warnings.push({ code: 'AREA_BALANCE', message: 'leased + vacant differs from total GLA by ' + diff.toFixed(2) + ' m²', diff });
  }

  const provenance = {
    snapshotId: ids.snapshotId, runId: ids.runId,
    businessDate: capture.businessDate, timezone: capture.timezone, capturedAtUtc: capture.capturedAtUtc,
    sourceType: sourceContext.sourceType,
    sourceDataVersion: sourceContext.sourceDataVersion || null,
    sourceSyncedAtUtc: sourceContext.sourceSyncedAtUtc || null,
    sourceRecordCount: sourceContext.sourceRecordCount != null ? sourceContext.sourceRecordCount : totalUnitCount,
    schemaVersion: HISTORY_SCHEMA_VERSION,
    calculationVersion: HISTORY_CALCULATION_VERSION,
    metadataVersion: HISTORY_METADATA_VERSION,
    address: address || null,
  };

  return { project, buildings, tenants, provenance, warnings };
}

module.exports = { buildProjectSnapshot };
