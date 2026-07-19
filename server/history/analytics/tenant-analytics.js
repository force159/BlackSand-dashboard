'use strict';
/**
 * Phase 9.2B — tenant portfolio, identity, concentration, and lease-exposure services.
 * Read-only over the immutable 9.1 tenant snapshots (aggregated tenant-directory rows).
 *
 * HONEST DATA AVAILABILITY (Checkpoint 1 findings — the source simply does not carry these):
 *   - No annual RENT anywhere → rent-based portfolio/concentration are `available:false`.
 *   - No lease END/EXPIRY date (only lease START is captured) → lease-EXPIRY exposure is
 *     `available:false` (never fabricated, never compared against today's date).
 *   - No stable tenant id (tenant spans many Monday item ids) → identity is normalized-name,
 *     confidence 'low'.
 */

const repo = require('../query-repository');
const { round } = require('./change-math');

class AnalyticsError extends Error { constructor(code, message) { super(message); this.code = code; } }

// ── Checkpoint 2: tenant identity (documented hierarchy; nothing fabricated) ──
function tenantIdentityModel() {
  return {
    identityMethod: 'normalized-name',   // no stable source tenant id / persistent per-tenant Monday id / curated map exists
    identityConfidence: 'low',
    sourceTenantId: null,
    warnings: [
      'No stable source tenant identifier exists; identity is the normalized directory name.',
      'Renames/rebrands cannot be distinguished from an exit + a new entry.',
    ],
  };
}

const num = (v) => (v == null ? null : Number(v));
const parseJson = (v) => { if (v == null || v === '') return null; try { return JSON.parse(v); } catch (_) { return null; } };

// ── Checkpoint 3: tenant portfolio ──
function buildPortfolio(db, { projectKey, date }) {
  if (!repo.getProjectSnapshotsByDate(db, date).some((p) => p.project_key === projectKey)) {
    throw new AnalyticsError('SNAPSHOT_NOT_FOUND', `no snapshot for ${projectKey} on ${date}`);
  }
  const rows = repo.getAllTenantsForDate(db, projectKey, date);
  let leasedArea = 0, leaseRows = 0, units = 0, missingArea = 0;
  const buildingSet = new Set();
  for (const t of rows) {
    const a = num(t.total_leased_area);
    if (a == null) missingArea += 1; else leasedArea += a;
    leaseRows += num(t.lease_record_count) || 0;
    units += num(t.unit_count) || 0;
    (parseJson(t.building_keys_json) || []).forEach((k) => buildingSet.add(k));
  }
  return {
    projectKey, date,
    aggregatedTenantCount: rows.length,
    leaseRowCount: leaseRows,
    leasedArea: round(leasedArea),
    unitCount: units,
    buildingCount: buildingSet.size,
    annualRent: null, // not captured in the source
    completeness: {
      tenantsWithArea: rows.length - missingArea, tenantsMissingArea: missingArea,
      rentAvailable: false, rentReason: 'RENT_NOT_CAPTURED',
      identity: tenantIdentityModel(),
    },
  };
}

// ── Checkpoint 4: concentration (Top-N share + HHI) ──
const SUPPORTED_DIMENSIONS = { area: 'total_leased_area', units: 'unit_count' };
function computeConcentration(db, { projectKey, date, dimension }) {
  const dim = dimension || 'area';
  if (dim === 'rent') return { projectKey, date, dimension: 'rent', available: false, reason: 'RENT_NOT_CAPTURED' };
  if (!SUPPORTED_DIMENSIONS[dim]) throw new AnalyticsError('UNSUPPORTED_DIMENSION', 'dimension must be area or units');
  if (!repo.getProjectSnapshotsByDate(db, date).some((p) => p.project_key === projectKey)) {
    throw new AnalyticsError('SNAPSHOT_NOT_FOUND', `no snapshot for ${projectKey} on ${date}`);
  }
  const col = SUPPORTED_DIMENSIONS[dim];
  const rows = repo.getAllTenantsForDate(db, projectKey, date);
  const values = rows.map((t) => num(t[col])).filter((v) => v != null && Number.isFinite(v) && v >= 0);
  const excluded = rows.length - values.length;
  const total = values.reduce((a, b) => a + b, 0);
  const sorted = values.slice().sort((a, b) => b - a);
  const topShare = (n) => (total > 0 ? round((sorted.slice(0, n).reduce((a, b) => a + b, 0) / total) * 100) : null);
  // HHI = Σ share² (share as a fraction → 0..1; and ×100 → points 0..10000).
  let hhi = null, hhiPoints = null;
  if (total > 0) { hhi = round(values.reduce((s, v) => s + Math.pow(v / total, 2), 0), 4); hhiPoints = round(hhi * 10000, 2); }
  return {
    projectKey, date, dimension: dim, available: true,
    top1SharePercent: topShare(1), top3SharePercent: topShare(3), top5SharePercent: topShare(5), top10SharePercent: topShare(10),
    hhi, hhiPoints,
    coverage: { tenantsCounted: values.length, excludedRecords: excluded, total: round(total) },
  };
}

// ── Checkpoint 5: lease exposure (expiry buckets) — expiry not captured → unavailable ──
const EXPOSURE_BUCKETS = ['expired', '0-30', '31-90', '91-180', '181-365', 'over-365', 'unknown'];
function computeLeaseExposure(db, { projectKey, date }) {
  if (!repo.getProjectSnapshotsByDate(db, date).some((p) => p.project_key === projectKey)) {
    throw new AnalyticsError('SNAPSHOT_NOT_FOUND', `no snapshot for ${projectKey} on ${date}`);
  }
  const rows = repo.getAllTenantsForDate(db, projectKey, date);
  const leaseCount = rows.reduce((a, t) => a + (num(t.lease_record_count) || 0), 0);
  // Lease END/EXPIRY dates are NOT captured (only lease START). All leases → 'unknown'.
  // Never compare against today's date; never invent an expiry. Zero-lease denominator →
  // percentages are null (not a misleading 100%).
  const pct = (n) => (leaseCount > 0 ? n : null);
  return {
    projectKey, date, available: false, reason: 'LEASE_EXPIRY_NOT_CAPTURED',
    leaseCount, tenantCount: rows.length,
    buckets: EXPOSURE_BUCKETS.map((b) => ({ bucket: b, leaseCount: b === 'unknown' ? leaseCount : 0, tenantCount: b === 'unknown' ? rows.length : 0, leasedArea: null, rent: null, percentOfLeases: pct(b === 'unknown' ? 100 : 0) })),
    missingExpiryCount: leaseCount,
    note: 'Lease expiry/end dates are not present in the source; expiry exposure requires capturing a lease-end column in a future phase.',
  };
}

module.exports = { tenantIdentityModel, buildPortfolio, computeConcentration, computeLeaseExposure, AnalyticsError, SUPPORTED_DIMENSIONS, EXPOSURE_BUCKETS };
