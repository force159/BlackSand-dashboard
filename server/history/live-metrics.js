'use strict';
/**
 * Phase 9.1A — live-metric definitions the history engine reuses.
 *
 * IMPORTANT: tenant normalization/aggregation and leasing velocity live in the standalone
 * frontend (`Project Dashboard.html`) with no shared module. To keep the historical
 * snapshot IDENTICAL to what the dashboard shows, this module mirrors those definitions
 * EXACTLY (a faithful port), and a parity test asserts agreement with the /api/dashboard
 * tenant arrays. Building metrics are NOT ported here — those reuse the backend
 * `server/buildings` allocation via dashboard-service (single code path).
 */

const { resolveBuildingForUnit } = require('../buildings/building-mapping');
const { VELOCITY_WINDOW_DAYS } = require('./constants');

// ── mirror of the frontend's normalizeTenantName / displayTenantName / parseTenantArea ──
function normalizeTenantName(name) {
  return String(name == null ? '' : name).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function displayTenantName(name) {
  return String(name == null ? '' : name).normalize('NFKC').trim().replace(/\s+/g, ' ');
}
function parseTenantArea(a) {
  if (typeof a === 'number') return Number.isFinite(a) ? a : null;
  if (typeof a === 'string') {
    const t = a.trim();
    if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Project-wide tenant aggregation for the historical tenant snapshot. Mirrors the live
 * Tenant Directory + Top-Tenants identity: group by the SAME normalized name across BOTH
 * categories, sum valid areas, rank by area desc (tie-break normalized name asc, sequential
 * ordinal). categories_json reconstructs the per-category directory rows.
 * @param {string} projectKey  slug (for building resolution)
 * @param {Array} activeLeases  [{ tenantName, categoryCode:'retail'|'office', area, unitCode, leaseDate }]
 */
function aggregateProjectTenants(projectKey, activeLeases) {
  const byKey = new Map();
  for (const l of activeLeases) {
    const key = normalizeTenantName(l.tenantName);
    if (!byKey.has(key)) {
      byKey.set(key, {
        tenantKey: key, displayName: displayTenantName(l.tenantName), normalized: key,
        totalArea: 0, leaseRecordCount: 0, unitCount: 0, hasValidArea: false,
        categories: {}, buildingKeys: new Set(), activeLeaseCount: 0,
        earliest: null, latest: null,
      });
    }
    const t = byKey.get(key);
    t.leaseRecordCount += 1;
    t.unitCount += 1;              // each active lease is one unit at this grain
    t.activeLeaseCount += 1;
    const area = parseTenantArea(l.area);
    const cat = l.categoryCode || 'unspecified';
    if (area != null) {
      t.totalArea += area; t.hasValidArea = true;
      t.categories[cat] = (t.categories[cat] || 0) + area;
    } else if (!(cat in t.categories)) {
      t.categories[cat] = t.categories[cat] || 0;
    }
    // Building resolution from the unit code (authoritative mapping; excluded/unassigned → skip).
    const res = l.unitCode != null ? resolveBuildingForUnit(projectKey, l.unitCode) : null;
    if (res && res.status === 'assigned' && res.building != null) t.buildingKeys.add(String(res.building));
    if (l.leaseDate && /^\d{4}-\d{2}-\d{2}$/.test(l.leaseDate)) {
      if (!t.earliest || l.leaseDate < t.earliest) t.earliest = l.leaseDate;
      if (!t.latest || l.leaseDate > t.latest) t.latest = l.leaseDate;
    }
  }
  const rows = [...byKey.values()].map((t) => {
    const cats = Object.entries(t.categories).sort((a, b) => b[1] - a[1]);
    return {
      tenantKey: t.tenantKey,
      displayName: t.displayName,
      normalized: t.normalized,
      totalLeasedArea: t.hasValidArea ? t.totalArea : null,
      leaseRecordCount: t.leaseRecordCount,
      unitCount: t.unitCount,
      buildingKeys: [...t.buildingKeys].sort(),
      buildingCount: t.buildingKeys.size,
      primaryCategory: cats.length ? cats[0][0] : null,
      categories: t.categories,
      activeLeaseCount: t.activeLeaseCount,
      earliestActiveStartDate: t.earliest,
      latestActiveStartDate: t.latest,
    };
  });
  // Rank by area desc; deterministic tie-break by normalized name asc. Sequential ordinal.
  rows.sort((a, b) => (b.totalLeasedArea || 0) - (a.totalLeasedArea || 0) || a.normalized.localeCompare(b.normalized));
  rows.forEach((r, i) => {
    r.rankByArea = i + 1;
    r.isTop3 = i < 3; r.isTop5 = i < 5; r.isTop10 = i < 10;
  });
  return rows;
}

/**
 * Leasing velocity — mirrors the live definition: leases whose Lease Start falls within a
 * rolling 90-day window ending at the capture instant (inclusive of both ends, and of
 * today). Returns the 90-day TOTALS (area + count) per §10; the daily rate is total ÷ 90.
 * @param {Array} activeLeases  [{ area, leaseDate }]
 * @param {Date}  now  capture instant
 */
function computeVelocity(activeLeases, now) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  let area = 0, count = 0;
  for (const l of activeLeases) {
    if (!l.leaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(l.leaseDate)) continue;
    const ageDays = (nowMs - new Date(l.leaseDate + 'T12:00:00').getTime()) / 86400000;
    if (ageDays >= 0 && ageDays <= VELOCITY_WINDOW_DAYS) {
      const a = parseTenantArea(l.area);
      if (a != null) area += a;
      count += 1;
    }
  }
  return { area90d: area, leaseCount90d: count, windowDays: VELOCITY_WINDOW_DAYS };
}

module.exports = { normalizeTenantName, displayTenantName, parseTenantArea, aggregateProjectTenants, computeVelocity };
