'use strict';
/**
 * Phase 9.1A — snapshot validator (§11). Returns { valid, errors, warnings }. ERRORs block
 * persistence; WARNINGs are recorded but allow it. Centralized + pure. Normalization has
 * already happened in the builder; this asserts invariants and never silently "fixes"
 * serious problems.
 */

const { isValidBusinessDate } = require('./riyadh-date');
const { AREA_BALANCE_TOLERANCE, PERCENT_DECIMALS } = require('./constants');

const PCT_TOL = 0.01; // allow 2-dp rounding noise around the 0–100 bounds

function validateProjectSnapshot(snapshot) {
  const errors = [];
  const warnings = [];
  const err = (code, path, message, actual) => errors.push({ code, severity: 'error', path, message, actual });
  const warn = (code, path, message, actual) => warnings.push({ code, severity: 'warning', path, message, actual });

  if (!snapshot || typeof snapshot !== 'object') {
    return { valid: false, errors: [{ code: 'INVALID_SNAPSHOT', severity: 'error', path: '', message: 'snapshot is not an object' }], warnings: [] };
  }
  const p = snapshot.project || {};
  const prov = snapshot.provenance || {};

  // identity / provenance
  if (!p.projectKey || typeof p.projectKey !== 'string') err('MISSING_PROJECT_KEY', 'project.projectKey', 'missing project key', p.projectKey);
  if (!prov.snapshotId) err('MISSING_SNAPSHOT_ID', 'provenance.snapshotId', 'missing snapshot identifier');
  if (!isValidBusinessDate(prov.businessDate)) err('INVALID_BUSINESS_DATE', 'provenance.businessDate', 'missing/invalid business date', prov.businessDate);
  if (!prov.capturedAtUtc || Number.isNaN(Date.parse(prov.capturedAtUtc))) err('INVALID_CAPTURED_AT', 'provenance.capturedAtUtc', 'invalid captured timestamp', prov.capturedAtUtc);
  if (prov.sourceType !== 'monday') err('UNSUPPORTED_SOURCE_TYPE', 'provenance.sourceType', 'source type is not authoritative live data', prov.sourceType);

  // numeric finiteness + non-negative areas
  const finiteOrNull = (v) => v === null || (typeof v === 'number' && Number.isFinite(v));
  const checkArea = (v, path) => {
    if (!finiteOrNull(v)) err('NON_FINITE_NUMBER', path, 'value is not finite', v);
    else if (v !== null && v < 0) err('NEGATIVE_AREA', path, 'area is negative', v);
  };
  for (const f of ['totalGla', 'leasedArea', 'vacantArea', 'retailTotalArea', 'retailLeasedArea', 'retailVacantArea', 'officeTotalArea', 'officeLeasedArea', 'officeVacantArea', 'leasingVelocityArea90d', 'unassignedArea']) {
    checkArea(p[f], 'project.' + f);
  }
  const checkPct = (v, path) => {
    if (!finiteOrNull(v)) err('NON_FINITE_NUMBER', path, 'value is not finite', v);
    else if (v !== null && (v < -PCT_TOL || v > 100 + PCT_TOL)) err('OCCUPANCY_OUT_OF_BOUNDS', path, 'occupancy percent outside 0..100', v);
  };
  for (const f of ['occupancyPercent', 'retailOccupancyPercent', 'officeOccupancyPercent']) checkPct(p[f], 'project.' + f);

  // leased must not materially exceed total GLA
  if (finiteOrNull(p.leasedArea) && finiteOrNull(p.totalGla) && p.leasedArea !== null && p.totalGla !== null
      && p.leasedArea > p.totalGla + AREA_BALANCE_TOLERANCE) {
    err('LEASED_EXCEEDS_TOTAL', 'project.leasedArea', 'leased area materially greater than total GLA', { leased: p.leasedArea, total: p.totalGla });
  }

  // counts non-negative integers
  for (const f of ['activeLeaseCount', 'tenantCountRaw', 'tenantCountAggregated', 'occupiedUnitCount', 'vacantUnitCount', 'totalUnitCount', 'leasingVelocityLeaseCount90d', 'unassignedUnitCount', 'excludedRecordCount']) {
    const v = p[f];
    if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0)) err('INVALID_COUNT', 'project.' + f, 'count must be a non-negative integer', v);
  }

  // children structure + uniqueness
  if (!Array.isArray(snapshot.buildings)) err('NON_ARRAY_BUILDINGS', 'buildings', 'buildings is not an array');
  else {
    const seen = new Set();
    for (const b of snapshot.buildings) {
      if (!b.buildingKey) err('MISSING_BUILDING_KEY', 'buildings[].buildingKey', 'building missing key');
      else if (seen.has(b.buildingKey)) err('DUPLICATE_BUILDING_KEY', 'buildings[].buildingKey', 'duplicate building key', b.buildingKey);
      else seen.add(b.buildingKey);
      checkArea(b.totalArea, 'buildings[' + b.buildingKey + '].totalArea');
      checkArea(b.leasedArea, 'buildings[' + b.buildingKey + '].leasedArea');
      checkPct(b.occupancyPercent, 'buildings[' + b.buildingKey + '].occupancyPercent');
      if (b.totalArea === 0) warn('BUILDING_ZERO_AREA', 'buildings[' + b.buildingKey + '].totalArea', 'building has zero total area');
    }
  }
  if (!Array.isArray(snapshot.tenants)) err('NON_ARRAY_TENANTS', 'tenants', 'tenants is not an array');
  else {
    const seen = new Set();
    for (const t of snapshot.tenants) {
      if (!t.tenantKey) err('MISSING_TENANT_KEY', 'tenants[].tenantKey', 'tenant missing key');
      else if (seen.has(t.tenantKey)) err('DUPLICATE_TENANT_KEY', 'tenants[].tenantKey', 'duplicate tenant key', t.tenantKey);
      else seen.add(t.tenantKey);
      checkArea(t.totalLeasedArea, 'tenants[' + t.tenantKey + '].totalLeasedArea');
      if (!t.primaryCategory) warn('TENANT_CATEGORY_MISSING', 'tenants[' + t.tenantKey + '].primaryCategory', 'tenant has no category');
    }
  }

  // fold builder warnings (data quality) in
  for (const w of (snapshot.warnings || [])) warnings.push({ code: w.code, severity: 'warning', path: '', message: w.message, actual: w.count != null ? w.count : (w.diff != null ? w.diff : undefined) });

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validateProjectSnapshot };
