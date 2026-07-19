'use strict';
/**
 * Building-departments repository — parameterized SQLite access only.
 * Natural identity: (building_id, code). No KPI calculation here. Seed strategy:
 * delete-then-insert per building (departments have no `source` column; they belong
 * to a seed building, so all of a seed building's departments are seed-origin).
 * The DB CHECK (leased_area <= total_area) is the last guard; validation catches it first.
 */

/** Insert one department for a building. Returns the department id. */
function insertSeedDepartment(db, buildingId, categoryId, data, now) {
  const row = db
    .prepare(
      `INSERT INTO building_departments
         (building_id, category_id, code, label, total_area, leased_area, created_at, updated_at)
       VALUES
         (@building_id, @category_id, @code, @label, @total_area, @leased_area, @now, @now)
       RETURNING id`
    )
    .get({
      building_id: buildingId,
      category_id: categoryId ?? null,
      code: data.code,
      label: data.label,
      total_area: data.totalArea,
      leased_area: data.leasedArea,
      now,
    });
  return row.id;
}

/** Delete all departments of a building (used before re-inserting). Returns count. */
function deleteDepartmentsForBuilding(db, buildingId) {
  return db.prepare('DELETE FROM building_departments WHERE building_id = ?').run(buildingId).changes;
}

function listDepartmentsByBuilding(db, buildingId) {
  return db
    .prepare('SELECT * FROM building_departments WHERE building_id = ? ORDER BY code ASC')
    .all(buildingId);
}

function countDepartments(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM building_departments').get().n;
}

module.exports = {
  insertSeedDepartment,
  deleteDepartmentsForBuilding,
  listDepartmentsByBuilding,
  countDepartments,
};
