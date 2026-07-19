'use strict';
/**
 * BlackSand dashboard — read-only dashboard service (Phase 3).
 *
 * Reads the seeded SQLite data (via repositories) and assembles the JSON the
 * dashboard frontend consumes. The projects are shaped to be COMPATIBLE with the
 * current frontend `projects[]` (so the existing render layer works unchanged), and
 * each project also carries a backend-computed canonical `metrics` block (the future
 * single source of truth). No writes, no Monday, no KPI logic in the routes.
 *
 * Business behaviour is reproduced EXACTLY from the current prototype (CLAUDE.md §7):
 *   - leased area uses an explicit fraction when the category provides one, else the
 *     sum of tenant lease areas;
 *   - tenant count = lease-row count (duplicates are separate leases);
 *   - Town Center's explicit percentage vs lease-derived totals are NOT reconciled.
 */

const projectsRepo = require('../db/repositories/projects-repository');
const categoriesRepo = require('../db/repositories/categories-repository');
const buildingsRepo = require('../db/repositories/buildings-repository');
const leasesRepo = require('../db/repositories/leases-repository');
const deptRepo = require('../db/repositories/building-departments-repository');
const syncRepo = require('../db/repositories/sync-runs-repository');
const { allocateBuildings } = require('../buildings/building-allocation');

const API_VERSION = 1;

// Map a lease row → the frontend tenant shape ({ name, type, area, leaseDate?, logo? }).
function leaseToTenant(l) {
  const t = { name: l.tenant_name, type: l.tenant_type, area: l.area };
  if (l.lease_date) t.leaseDate = l.lease_date;
  if (l.logo_path) t.logo = l.logo_path;
  return t;
}

// Build a frontend category object ({ label, gla, leasedPct?, tenants:[] }).
function buildCategory(cat, leases) {
  const out = { label: cat.label, gla: cat.total_area, tenants: leases.map(leaseToTenant) };
  if (cat.explicit_leased_pct != null) out.leasedPct = cat.explicit_leased_pct;
  return out;
}

// Reconstruct a building's { id, departments:{ retail?, offices?, … } } shape.
function buildBuilding(db, b) {
  const departments = {};
  for (const d of deptRepo.listDepartmentsByBuilding(db, b.id)) {
    departments[d.code] = { label: d.label, leased: d.leased_area, total: d.total_area };
  }
  return { id: b.name, departments };
}

// Canonical metrics — mirrors the frontend computeMetrics() exactly.
function computeMetrics(retailCat, officeCat, retailLeases, officeLeases) {
  const sum = (rows) => rows.reduce((a, l) => a + l.area, 0);
  const retailTenantArea = sum(retailLeases);
  const officeTenantArea = sum(officeLeases);
  const retailGLA = retailCat.total_area != null ? retailCat.total_area : retailTenantArea;
  const officeGLA = officeCat.total_area != null ? officeCat.total_area : officeTenantArea;
  const retailLeased = retailCat.explicit_leased_pct != null ? retailGLA * retailCat.explicit_leased_pct : retailTenantArea;
  const officeLeased = officeCat.explicit_leased_pct != null ? officeGLA * officeCat.explicit_leased_pct : officeTenantArea;
  const totalGLA = retailGLA + officeGLA;
  const totalLeased = retailLeased + officeLeased;
  const totalVacant = Math.max(0, totalGLA - totalLeased);
  const retailPct = retailGLA ? (retailLeased / retailGLA) * 100 : 0;
  const officePct = officeGLA ? (officeLeased / officeGLA) * 100 : 0;
  const overallLeasedPct = totalGLA ? ((totalLeased / totalGLA) * 100).toFixed(1) : '0.0';
  const totalTenants = retailLeases.length + officeLeases.length;
  return {
    retailGLA, officeGLA, retailLeased, officeLeased, retailPct, officePct,
    totalGLA, totalLeased, totalVacant, overallLeasedPct, totalTenants,
  };
}

// PURE: map a project's authoritative leases → the unit-lease array `allocateBuildings`
// expects. Single source of truth for that mapping (used by the live serializer AND the
// history snapshot builder, so building numbers cannot diverge between them).
function projectUnitLeases(projectLeases, retailCat, officeCat) {
  const catCode = (cid) => (retailCat && cid === retailCat.id) ? 'retail'
    : (officeCat && cid === officeCat.id) ? 'office' : null;
  return projectLeases.map((l) => ({
    externalId: l.external_id, unitCode: l.unit_code, area: l.area,
    categoryCode: catCode(l.category_id), status: l.status, isActive: l.is_active,
  }));
}

// Reusable building allocation for a Monday-authoritative project — returns the full
// { buildings, diagnostics } (the history builder needs diagnostics; the live serializer
// uses only .buildings). Non-monday source → { buildings: [], diagnostics: null }.
function allocateProjectBuildings(db, project) {
  if ((project.current_data_source || 'seed') !== 'monday') return { buildings: [], diagnostics: null };
  const cats = categoriesRepo.listCategoriesByProject(db, project.id);
  const retailCat = cats.find((c) => c.code === 'retail');
  const officeCat = cats.find((c) => c.code === 'office');
  const projectLeases = leasesRepo.listLeasesByProject(db, project.id).filter((l) => l.source === 'monday');
  return allocateBuildings(project.slug, projectUnitLeases(projectLeases, retailCat, officeCat));
}

// Assemble one project in the frontend-compatible shape (+ slug + metrics).
function buildProject(db, project) {
  const cats = categoriesRepo.listCategoriesByProject(db, project.id);
  const retailCat = cats.find((c) => c.code === 'retail');
  const officeCat = cats.find((c) => c.code === 'office');

  // SOURCE OWNERSHIP: read ONLY the project's authoritative lease source, so seed and
  // Monday leases never count together. Before a Monday cutover this is 'seed'; after a
  // successful cutover it is 'monday' (seed rows remain stored but are excluded here).
  const authoritativeSource = project.current_data_source || 'seed';
  // ALL leases in the authoritative source (both active + inactive). KPIs/tenants use the
  // active subset; building allocation needs vacant units too (they count toward total GLA).
  const projectLeases = leasesRepo.listLeasesByProject(db, project.id)
    .filter((l) => l.source === authoritativeSource);
  const activeLeases = projectLeases.filter((l) => l.is_active !== 0);
  const retailLeases = retailCat ? activeLeases.filter((l) => l.category_id === retailCat.id) : [];
  const officeLeases = officeCat ? activeLeases.filter((l) => l.category_id === officeCat.id) : [];

  // Portfolio Occupancy by Building:
  //   - LIVE (source='monday'): AUTHORITATIVE unit→building allocation from the unit codes
  //     (Town Center first-letter A–G; Business Address explicit lookup). Vacant units
  //     count toward total GLA; leased only if active. Manual buildings table is NOT used.
  //   - SEED: keep the existing manual buildings table (unchanged demo/seed behaviour).
  let buildings;
  if (authoritativeSource === 'monday') {
    // Reuse the SAME pure mapper the history snapshot builder uses, so the two can never
    // drift (behaviour identical to the previous inline mapping; single lease read here).
    buildings = allocateBuildings(project.slug, projectUnitLeases(projectLeases, retailCat, officeCat)).buildings;
  } else {
    buildings = buildingsRepo.listBuildingsByProject(db, project.id)
      .filter((b) => b.is_active !== 0)
      .map((b) => buildBuilding(db, b));
  }

  const out = {
    slug: project.slug,
    project: project.name,   // the frontend renderer reads `p.project`
    address: project.address,
    retail: retailCat ? buildCategory(retailCat, retailLeases) : { label: 'Retail', gla: 0, tenants: [] },
    office: officeCat ? buildCategory(officeCat, officeLeases) : { label: 'Offices', gla: 0, tenants: [] },
    buildings,
  };

  if (retailCat && officeCat) {
    out.metrics = computeMetrics(retailCat, officeCat, retailLeases, officeLeases);
  }
  return out;
}

/**
 * Build the full dashboard payload. `checkedAt` is the moment this response is
 * produced (a fresh SQLite read). Returns { ok, status, body }.
 * status 200 with data, or 503 when there is no usable data (never fake data).
 */
function buildDashboardPayload(db, now = new Date().toISOString()) {
  const projectRows = projectsRepo.listProjects(db).filter((p) => p.is_active !== 0);
  const latestSuccess = syncRepo.getLatestSuccessful(db);

  if (projectRows.length === 0 || !latestSuccess) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'no-data',
        message: 'No dashboard data is available yet.',
        meta: {
          apiVersion: API_VERSION,
          source: 'sqlite',
          checkedAt: now,
          dataVersion: latestSuccess ? latestSuccess.data_version : null,
          lastSuccessfulSync: latestSuccess ? latestSuccess.finished_at : null,
          lastDataChange: latestSuccess ? latestSuccess.last_data_change_at : null,
        },
      },
    };
  }

  const projects = projectRows.map((p) => buildProject(db, p));

  return {
    ok: true,
    status: 200,
    body: {
      data: { projects },
      meta: {
        apiVersion: API_VERSION,
        source: 'sqlite',
        checkedAt: now,
        dataVersion: latestSuccess.data_version,
        lastSuccessfulSync: latestSuccess.finished_at,
        lastDataChange: latestSuccess.last_data_change_at,
        projectCount: projects.length,
      },
    },
  };
}

/** Build the sync status payload (read-only telemetry). */
function buildSyncStatus(db, now = new Date().toISOString()) {
  const latestSuccess = syncRepo.getLatestSuccessful(db);
  const latestRun = syncRepo.getLatestRun(db);
  // Safe per-project authoritative source (slug + source only; NO secrets/ids/paths).
  let projectSources = [];
  try {
    projectSources = projectsRepo.listProjects(db)
      .filter((p) => p.is_active !== 0)
      .map((p) => ({ slug: p.slug, currentSource: p.current_data_source || 'seed' }));
  } catch (_) { /* leave empty */ }
  return {
    ok: true,
    status: 200,
    body: {
      data: {
        status: latestRun ? latestRun.status : 'none',
        source: latestRun ? latestRun.source : null,
        lastSuccessfulSync: latestSuccess ? latestSuccess.finished_at : null,
        lastAttemptedSync: latestRun ? latestRun.started_at : null,
        lastDataChange: latestSuccess ? latestSuccess.last_data_change_at : null,
        dataVersion: latestSuccess ? latestSuccess.data_version : null,
        recordCount: latestSuccess ? latestSuccess.record_count : 0,
        warningCount: latestSuccess ? latestSuccess.warning_count : 0,
        syncInProgress: false, // no background sync exists yet (Monday arrives later)
        projectSources,        // [{ slug, currentSource: 'seed'|'monday'|… }]
      },
      meta: { apiVersion: API_VERSION, source: 'sqlite', checkedAt: now },
    },
  };
}

module.exports = { buildDashboardPayload, buildSyncStatus, computeMetrics, allocateProjectBuildings, projectUnitLeases, API_VERSION };
