'use strict';
/**
 * Property-categories repository — parameterized SQLite access only.
 * Natural identity: (project_id, code). Percentages are stored as fractions (0..1);
 * this layer does NOT convert or interpret them.
 */

/** Upsert a category by (project_id, code). Returns the category id. */
function upsertSeedCategory(db, projectId, data, now) {
  const row = db
    .prepare(
      `INSERT INTO property_categories
         (project_id, code, label, total_area, occupancy_source, explicit_leased_pct, sort_order, is_active, created_at, updated_at)
       VALUES
         (@project_id, @code, @label, @total_area, @occupancy_source, @explicit_leased_pct, @sort_order, 1, @now, @now)
       ON CONFLICT(project_id, code) DO UPDATE SET
         label = excluded.label,
         total_area = excluded.total_area,
         occupancy_source = excluded.occupancy_source,
         explicit_leased_pct = excluded.explicit_leased_pct,
         sort_order = excluded.sort_order,
         is_active = 1,
         updated_at = excluded.updated_at
       RETURNING id`
    )
    .get({
      project_id: projectId,
      code: data.code,
      label: data.label,
      total_area: data.totalArea,
      occupancy_source: data.occupancySource,
      explicit_leased_pct: data.explicitLeasedPct ?? null,
      sort_order: data.sortOrder ?? 0,
      now,
    });
  return row.id;
}

function listCategoriesByProject(db, projectId) {
  return db
    .prepare('SELECT * FROM property_categories WHERE project_id = ? ORDER BY code ASC')
    .all(projectId);
}

function countCategories(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM property_categories').get().n;
}

/** Remove categories of a (seed) project whose code is no longer present. */
function deleteObsoleteCategories(db, projectId, activeCodes) {
  const all = db.prepare('SELECT id, code FROM property_categories WHERE project_id = ?').all(projectId);
  const keep = new Set(activeCodes);
  const del = db.prepare('DELETE FROM property_categories WHERE id = ?');
  let removed = 0;
  for (const c of all) {
    if (!keep.has(c.code)) { del.run(c.id); removed++; }
  }
  return removed;
}

module.exports = {
  upsertSeedCategory,
  listCategoriesByProject,
  countCategories,
  deleteObsoleteCategories,
};
