'use strict';
/**
 * Leases repository — parameterized SQLite access only.
 *
 * Leases are the tenant-directory grain: duplicate tenant names and duplicate-looking
 * rows are LEGITIMATE (one tenant, many leases). Identity is the deterministic
 * `source_record_key` (e.g. "seed:lease:business-address:retail:001") — NEVER the
 * tenant name and NEVER a fabricated Monday id (external_id stays null for seed rows).
 *
 * Seed strategy (the simplest safe deterministic option, per the plan): within the
 * seed transaction, DELETE all source='seed' leases for a project, then INSERT fresh.
 * This is idempotent, handles removed rows automatically, and never touches
 * source='monday' rows.
 */

/** Insert one seed lease. Returns the lease id. */
function insertSeedLease(db, ids, data, now) {
  const row = db
    .prepare(
      `INSERT INTO leases
         (external_id, project_id, category_id, building_id, tenant_name, tenant_external_id,
          tenant_type, area, lease_date, status, logo_path, is_active, source, source_updated_at,
          source_record_key, created_at, updated_at)
       VALUES
         (@external_id, @project_id, @category_id, @building_id, @tenant_name, @tenant_external_id,
          @tenant_type, @area, @lease_date, @status, @logo_path, 1, 'seed', @source_updated_at,
          @source_record_key, @now, @now)
       RETURNING id`
    )
    .get({
      external_id: data.externalId ?? null,
      project_id: ids.projectId,
      category_id: ids.categoryId ?? null,
      building_id: ids.buildingId ?? null,
      tenant_name: data.tenantName,
      tenant_external_id: data.tenantExternalId ?? null,
      tenant_type: data.tenantType ?? null,
      area: data.area,
      lease_date: data.leaseDate ?? null,
      status: data.status ?? null,
      logo_path: data.logoPath ?? null,
      source_updated_at: data.sourceUpdatedAt ?? null,
      source_record_key: data.sourceRecordKey,
      now,
    });
  return row.id;
}

/** Delete every seed lease for a project (Monday rows untouched). Returns count. */
function deleteSeedLeasesForProject(db, projectId) {
  const info = db.prepare("DELETE FROM leases WHERE project_id = ? AND source = 'seed'").run(projectId);
  return info.changes;
}

/**
 * Deactivate/remove obsolete seed leases across the whole DB by active key set.
 * Provided for the removal-test semantics; the seed coordinator uses the simpler
 * per-project delete-then-insert above. Only affects source='seed'.
 */
function deleteObsoleteSeedLeases(db, activeKeys) {
  const all = db.prepare("SELECT id, source_record_key FROM leases WHERE source = 'seed'").all();
  const keep = new Set(activeKeys);
  const del = db.prepare('DELETE FROM leases WHERE id = ?');
  let removed = 0;
  for (const l of all) {
    if (!keep.has(l.source_record_key)) { del.run(l.id); removed++; }
  }
  return removed;
}

function listLeasesByProject(db, projectId) {
  return db
    .prepare('SELECT * FROM leases WHERE project_id = ? ORDER BY source_record_key ASC')
    .all(projectId);
}

function countLeases(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM leases').get().n;
}

function countLeasesBySource(db, source) {
  return db.prepare('SELECT COUNT(*) AS n FROM leases WHERE source = ?').get(source).n;
}

module.exports = {
  insertSeedLease,
  deleteSeedLeasesForProject,
  deleteObsoleteSeedLeases,
  listLeasesByProject,
  countLeases,
  countLeasesBySource,
};
