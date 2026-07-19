'use strict';
/**
 * Phase 9.2A — metric registry. The SINGLE allowlist mapping a public metric key → a fixed
 * snapshot column, per level (project | building). Analytics services select ONLY columns
 * that come from this registry, so a request-supplied metric can never reach SQL as raw
 * text (no injection). Percentages are 0–100 (as stored). Velocity is READ, never recomputed.
 */

// key → { label, column, unit, higherIsBetter, kind }
const PROJECT_METRICS = {
  occupancyPercent: { label: 'Overall Occupancy', column: 'occupancy_percent', unit: 'percent', higherIsBetter: true, kind: 'percent' },
  totalGla: { label: 'Total GLA', column: 'total_gla', unit: 'sqm', higherIsBetter: null, kind: 'area' },
  leasedArea: { label: 'Leased Area', column: 'leased_area', unit: 'sqm', higherIsBetter: true, kind: 'area' },
  vacantArea: { label: 'Vacant Area', column: 'vacant_area', unit: 'sqm', higherIsBetter: false, kind: 'area' },
  retailOccupancyPercent: { label: 'Retail Occupancy', column: 'retail_occupancy_percent', unit: 'percent', higherIsBetter: true, kind: 'percent' },
  retailLeasedArea: { label: 'Retail Leased Area', column: 'retail_leased_area', unit: 'sqm', higherIsBetter: true, kind: 'area' },
  officeOccupancyPercent: { label: 'Office Occupancy', column: 'office_occupancy_percent', unit: 'percent', higherIsBetter: true, kind: 'percent' },
  officeLeasedArea: { label: 'Office Leased Area', column: 'office_leased_area', unit: 'sqm', higherIsBetter: true, kind: 'area' },
  tenantCountRaw: { label: 'Tenants (lease rows)', column: 'tenant_count_raw', unit: 'count', higherIsBetter: true, kind: 'count' },
  tenantCountAggregated: { label: 'Tenants (unique)', column: 'tenant_count_aggregated', unit: 'count', higherIsBetter: true, kind: 'count' },
  occupiedUnitCount: { label: 'Occupied Units', column: 'occupied_unit_count', unit: 'count', higherIsBetter: true, kind: 'count' },
  vacantUnitCount: { label: 'Vacant Units', column: 'vacant_unit_count', unit: 'count', higherIsBetter: false, kind: 'count' },
  totalUnitCount: { label: 'Total Units', column: 'total_unit_count', unit: 'count', higherIsBetter: null, kind: 'count' },
  // Leasing velocity is the STORED 9.1 value (never recalculated here).
  leasingVelocityArea90d: { label: 'Leasing Velocity — area (90d)', column: 'leasing_velocity_area_90d', unit: 'sqm', higherIsBetter: true, kind: 'area' },
  leasingVelocityLeaseCount90d: { label: 'Leasing Velocity — leases (90d)', column: 'leasing_velocity_lease_count_90d', unit: 'count', higherIsBetter: true, kind: 'count' },
};

const BUILDING_METRICS = {
  occupancyPercent: { label: 'Occupancy', column: 'occupancy_percent', unit: 'percent', higherIsBetter: true, kind: 'percent' },
  totalArea: { label: 'Total Area', column: 'total_area', unit: 'sqm', higherIsBetter: null, kind: 'area' },
  leasedArea: { label: 'Leased Area', column: 'leased_area', unit: 'sqm', higherIsBetter: true, kind: 'area' },
  vacantArea: { label: 'Vacant Area', column: 'vacant_area', unit: 'sqm', higherIsBetter: false, kind: 'area' },
  retailOccupancyPercent: { label: 'Retail Occupancy', column: 'retail_occupancy_percent', unit: 'percent', higherIsBetter: true, kind: 'percent' },
  officeOccupancyPercent: { label: 'Office Occupancy', column: 'office_occupancy_percent', unit: 'percent', higherIsBetter: true, kind: 'percent' },
  unitCount: { label: 'Units', column: 'unit_count', unit: 'count', higherIsBetter: null, kind: 'count' },
  occupiedUnitCount: { label: 'Occupied Units', column: 'occupied_unit_count', unit: 'count', higherIsBetter: true, kind: 'count' },
  vacantUnitCount: { label: 'Vacant Units', column: 'vacant_unit_count', unit: 'count', higherIsBetter: false, kind: 'count' },
};

const LEVELS = { project: PROJECT_METRICS, building: BUILDING_METRICS };

function getMetric(level, key) {
  const set = LEVELS[level];
  if (!set || !Object.prototype.hasOwnProperty.call(set, key)) return null;
  return { key, level, ...set[key] };
}
function listMetrics(level) {
  const set = LEVELS[level] || {};
  return Object.keys(set).map((k) => ({ key: k, level, ...set[k] }));
}
// Defensive: a column is usable in SQL only if it belongs to the registry for that level.
function assertRegistryColumn(level, key) {
  const m = getMetric(level, key);
  if (!m) throw Object.assign(new Error('unsupported metric: ' + key), { code: 'UNSUPPORTED_METRIC' });
  return m.column;
}

module.exports = { PROJECT_METRICS, BUILDING_METRICS, getMetric, listMetrics, assertRegistryColumn };
