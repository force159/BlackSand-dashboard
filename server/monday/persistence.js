'use strict';
/**
 * BlackSand dashboard — Monday persistence layer (Phase 6 hardening).
 *
 * Writes a transformed Monday dataset into the EXISTING SQLite tables inside ONE
 * transaction (commit-all or rollback-all — no partial sync), then performs the
 * source CUTOVER by setting `projects.current_data_source = 'monday'`. The dashboard
 * reads leases WHERE source = current_data_source, so seed and Monday leases never
 * count together. Leases are applied via the difference engine so UNCHANGED rows are
 * not rewritten. `is_active` is driven by the canonical status (never hardcoded).
 *
 * IMPORTANT (source ownership, v1):
 *   - LEASES are source-partitioned: seed rows AND monday rows coexist in the table;
 *     which set the dashboard shows is chosen by `projects.current_data_source`. Seed
 *     leases are PRESERVED (never deleted) so seed fallback stays recoverable.
 *   - PROJECT + CATEGORY rows are SHARED (one row per project / per (project,code)).
 *     Monday updates project name/address and category label/occupancy/percentage, and
 *     total_area ONLY when a config value is given (never null/0 over a valid total;
 *     `preserve-existing` keeps the stored value). Monday does NOT change a project
 *     row's provenance `source` field.
 *   - BUILDINGS/DEPARTMENTS are MANUAL/seed in v1 — Monday lease sync does NOT touch
 *     them (lease-grain boards carry no building data). The lease `buildingRef` is
 *     diagnostic only and is not persisted to `building_id` yet.
 *
 * No network here. Invoked only by the sync engine (download gated off in Phase 6).
 */

const { diffLeases, summarize } = require('./diff-engine');
const { PersistenceError } = require('./errors');

// ── project (upsert by slug; provenance `source` NOT overwritten on conflict) ──
function upsertProject(db, p, now) {
  const existing = db.prepare('SELECT id, current_data_source FROM projects WHERE slug = ?').get(p.slug);
  if (existing) {
    db.prepare(
      `UPDATE projects SET external_id=@external_id, name=@name, address=@address, is_active=1,
         source_updated_at=@now, updated_at=@now WHERE id=@id`
    ).run({ external_id: p.externalId ?? null, name: p.name, address: p.address ?? null, now, id: existing.id });
    return { id: existing.id, previousSource: existing.current_data_source };
  }
  const id = db.prepare(
    `INSERT INTO projects (external_id, slug, name, address, is_active, source, current_data_source, source_updated_at, created_at, updated_at)
     VALUES (@external_id, @slug, @name, @address, 1, 'monday', 'seed', @now, @now, @now) RETURNING id`
  ).get({ external_id: p.externalId ?? null, slug: p.slug, name: p.name, address: p.address ?? null, now }).id;
  return { id, previousSource: 'seed' };
}

function setCurrentDataSource(db, projectId, source, now) {
  db.prepare('UPDATE projects SET current_data_source=@src, updated_at=@now WHERE id=@id').run({ src: source, now, id: projectId });
}

// ── category (upsert by (project_id, code)); total_area never null/0 over a valid value ──
function upsertCategory(db, projectId, c, now) {
  const existing = db.prepare('SELECT id, total_area FROM property_categories WHERE project_id=? AND code=?').get(projectId, c.code);
  // Resolve the total_area to persist: preserve-existing keeps the stored value; a
  // config value is used as-is; otherwise keep existing (validator blocks the null case).
  let total;
  if (c.preserveTotalArea) total = existing ? existing.total_area : 0;
  else if (c.totalArea != null && Number.isFinite(c.totalArea)) total = c.totalArea;
  else total = existing ? existing.total_area : 0;

  if (existing) {
    db.prepare(
      `UPDATE property_categories SET label=@label, total_area=@total, occupancy_source=@src,
         explicit_leased_pct=@pct, sort_order=@sort, is_active=1, updated_at=@now WHERE id=@id`
    ).run({ label: c.label, total, src: c.occupancySource, pct: c.explicitLeasedPct ?? null, sort: c.sortOrder ?? 0, now, id: existing.id });
    return existing.id;
  }
  return db.prepare(
    `INSERT INTO property_categories (project_id, code, label, total_area, occupancy_source, explicit_leased_pct, sort_order, is_active, created_at, updated_at)
     VALUES (@pid, @code, @label, @total, @src, @pct, @sort, 1, @now, @now) RETURNING id`
  ).get({ pid: projectId, code: c.code, label: c.label, total, src: c.occupancySource, pct: c.explicitLeasedPct ?? null, sort: c.sortOrder ?? 0, now }).id;
}

// ── leases (diff-driven; is_active from canonical status; load ALL monday rows) ──
function currentMondayLeases(db, projectId) {
  // ALL source='monday' leases (active AND inactive) so the diff matches existing rows
  // by external_id regardless of is_active. Fields/values mirror the transformed lease
  // (category CODE resolved from category_id) so unchanged rows hash-match.
  return db.prepare(
    `SELECT l.external_id AS externalId, l.unit_code AS unitCode, l.tenant_name AS tenantName, l.tenant_type AS tenantType, l.area,
            l.lease_date AS leaseDate, l.status, l.is_active AS isActive, l.logo_path AS logoPath,
            pc.code AS categoryCode, NULL AS buildingRef
     FROM leases l
     LEFT JOIN property_categories pc ON pc.id = l.category_id
     WHERE l.project_id = ? AND l.source = 'monday'`
  ).all(projectId);
}

function insertLease(db, projectId, categoryId, l, now) {
  db.prepare(
    `INSERT INTO leases (external_id, project_id, category_id, building_id, tenant_name, tenant_external_id, tenant_type, area, lease_date, status, logo_path, is_active, source, source_updated_at, source_record_key, unit_code, created_at, updated_at)
     VALUES (@ext, @pid, @cid, NULL, @name, NULL, @type, @area, @date, @status, @logo, @active, 'monday', @sua, NULL, @unit, @now, @now)`
  ).run({ ext: l.externalId, pid: projectId, cid: categoryId ?? null, name: l.tenantName, type: l.tenantType ?? null, area: l.area, date: l.leaseDate ?? null, status: l.status ?? null, logo: l.logoPath ?? null, active: l.isActive != null ? l.isActive : 1, sua: l.sourceUpdatedAt ?? null, unit: l.unitCode ?? null, now });
}
function updateLease(db, externalId, categoryId, l, now) {
  db.prepare(
    `UPDATE leases SET category_id=@cid, tenant_name=@name, tenant_type=@type, area=@area, lease_date=@date,
       status=@status, logo_path=@logo, is_active=@active, source_updated_at=@sua, unit_code=@unit, updated_at=@now
     WHERE external_id=@ext AND source='monday'`
  ).run({ cid: categoryId ?? null, name: l.tenantName, type: l.tenantType ?? null, area: l.area, date: l.leaseDate ?? null, status: l.status ?? null, logo: l.logoPath ?? null, active: l.isActive != null ? l.isActive : 1, sua: l.sourceUpdatedAt ?? null, unit: l.unitCode ?? null, now, ext: externalId });
}
function deactivateLease(db, externalId, now) {
  return db.prepare(`UPDATE leases SET is_active=0, updated_at=@now WHERE external_id=@ext AND source='monday' AND is_active=1`).run({ now, ext: externalId }).changes;
}

/**
 * Apply a transformed Monday model in ONE transaction, then cut the synced projects'
 * authoritative source over to 'monday'. Returns a summary incl. per-project cutover
 * info. Rolls back on any error (throws PersistenceError). Never deletes seed rows.
 */
function writeMondayDataset(db, model, options = {}) {
  const now = options.now || new Date().toISOString();
  const perProject = [];

  const run = db.transaction(() => {
    for (const p of model.projects) {
      const { id: projectId, previousSource } = upsertProject(db, p, now);
      const catIdByCode = {};
      for (const c of p.categories) catIdByCode[c.code] = upsertCategory(db, projectId, c, now);

      // v1: buildings are MANUAL — Monday lease boards carry no buildings, so this
      // loop is a no-op. (Guard keeps it that way even if a model ever carried them.)
      if (options.persistBuildings === true) {
        for (const b of p.buildings || []) {
          const bid = db.prepare(`INSERT INTO buildings (external_id, project_id, code, name, total_area, sort_order, is_active, source, source_updated_at, created_at, updated_at)
            VALUES (@ext,@pid,@code,@name,@total,@sort,1,'monday',@now,@now,@now)
            ON CONFLICT(project_id, name) DO UPDATE SET total_area=excluded.total_area, updated_at=excluded.updated_at RETURNING id`)
            .get({ ext: b.externalId ?? null, pid: projectId, code: b.code ?? null, name: b.name, total: b.totalArea ?? 0, sort: b.sortOrder ?? 0, now }).id;
          db.prepare('DELETE FROM building_departments WHERE building_id=?').run(bid);
          const ins = db.prepare(`INSERT INTO building_departments (building_id, category_id, code, label, total_area, leased_area, created_at, updated_at) VALUES (@bid,@cid,@code,@label,@total,@leased,@now,@now)`);
          for (const d of b.departments || []) ins.run({ bid, cid: catIdByCode[d.categoryCode] ?? null, code: d.code, label: d.label, total: d.totalArea ?? 0, leased: d.leasedArea ?? 0, now });
        }
      }

      // Diff incoming leases vs ALL current monday leases for this project.
      const current = currentMondayLeases(db, projectId);
      const currentByKey = new Map(current.map((l) => [String(l.externalId), l]));
      const diff = diffLeases(current, p.leases);
      for (const { incoming } of diff.inserts) insertLease(db, projectId, catIdByCode[incoming.categoryCode], incoming, now);
      for (const { incoming } of diff.updates) updateLease(db, incoming.externalId, catIdByCode[incoming.categoryCode], incoming, now);
      let deactivated = 0;
      for (const { key } of diff.deletes) { const wasActive = currentByKey.get(key) && currentByKey.get(key).isActive === 1; if (wasActive) deactivated += deactivateLease(db, key, now); else deactivateLease(db, key, now); }

      // CUTOVER — this project's authoritative source becomes 'monday'.
      setCurrentDataSource(db, projectId, 'monday', now);

      const s = summarize(diff);
      perProject.push({ slug: p.slug, ...s, deleted: deactivated || s.deleted, previousSource, newSource: 'monday', cutover: previousSource !== 'monday' });
    }
  });

  try { run(); }
  catch (e) { throw new PersistenceError('Monday dataset write failed and was rolled back', { cause: e.message }); }

  const totals = perProject.reduce((a, s) => ({ inserted: a.inserted + s.inserted, updated: a.updated + s.updated, deleted: a.deleted + s.deleted, unchanged: a.unchanged + s.unchanged }), { inserted: 0, updated: 0, deleted: 0, unchanged: 0 });
  totals.changed = totals.inserted + totals.updated + totals.deleted;
  return { ok: true, perProject, totals, cutover: perProject.some((p) => p.cutover) };
}

module.exports = {
  writeMondayDataset,
  upsertProject, upsertCategory, setCurrentDataSource,
  currentMondayLeases, insertLease, updateLease, deactivateLease,
};
