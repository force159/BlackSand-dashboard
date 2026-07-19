'use strict';
/**
 * Buildings repository — parameterized SQLite access only.
 * Natural identity: (project_id, name). Seed rows carry source = 'seed'. The
 * building's `total_area` is supplied by the caller (the seed normalizer sums the
 * building's own department totals — mirroring the frontend's buildingOverall()).
 */

/** Upsert a building by (project_id, name). Returns the building id. */
function upsertSeedBuilding(db, projectId, data, now) {
  const row = db
    .prepare(
      `INSERT INTO buildings
         (external_id, project_id, code, name, total_area, sort_order, is_active, source, source_updated_at, created_at, updated_at)
       VALUES
         (@external_id, @project_id, @code, @name, @total_area, @sort_order, 1, 'seed', @source_updated_at, @now, @now)
       ON CONFLICT(project_id, name) DO UPDATE SET
         code = excluded.code,
         total_area = excluded.total_area,
         sort_order = excluded.sort_order,
         is_active = 1,
         source = 'seed',
         source_updated_at = excluded.source_updated_at,
         updated_at = excluded.updated_at
       RETURNING id`
    )
    .get({
      external_id: data.externalId ?? null,
      project_id: projectId,
      code: data.code ?? null,
      name: data.name,
      total_area: data.totalArea,
      sort_order: data.sortOrder ?? 0,
      source_updated_at: data.sourceUpdatedAt ?? null,
      now,
    });
  return row.id;
}

function findBuildingByProjectAndName(db, projectId, name) {
  return db.prepare('SELECT * FROM buildings WHERE project_id = ? AND name = ?').get(projectId, name);
}

function listBuildingsByProject(db, projectId) {
  return db
    .prepare('SELECT * FROM buildings WHERE project_id = ? ORDER BY sort_order ASC, name ASC')
    .all(projectId);
}

function countBuildings(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM buildings').get().n;
}

/** Remove seed buildings of a project whose name is no longer present. */
function deleteObsoleteSeedBuildings(db, projectId, activeNames) {
  const all = db
    .prepare("SELECT id, name FROM buildings WHERE project_id = ? AND source = 'seed'")
    .all(projectId);
  const keep = new Set(activeNames);
  const del = db.prepare('DELETE FROM buildings WHERE id = ?');
  let removed = 0;
  for (const b of all) {
    if (!keep.has(b.name)) { del.run(b.id); removed++; }
  }
  return removed;
}

module.exports = {
  upsertSeedBuilding,
  findBuildingByProjectAndName,
  listBuildingsByProject,
  countBuildings,
  deleteObsoleteSeedBuildings,
};
