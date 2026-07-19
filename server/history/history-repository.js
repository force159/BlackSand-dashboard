'use strict';
/**
 * Phase 9.1A — historical persistence + audit repository (§13, §14).
 *
 * All writes for ONE project snapshot happen in ONE better-sqlite3 transaction (parent +
 * buildings + tenants, commit-all / rollback-all). Prepared statements + bound parameters
 * only (never string-concatenated data). Duplicate (project_key, business_date) is caught
 * via the UNIQUE constraint — the ultimate race-condition defense — and reported cleanly
 * as duplicate_skipped (no overwrite, INSERT OR REPLACE never used).
 */

const crypto = require('crypto');

const newRunId = () => 'run_' + crypto.randomUUID();
const newSnapshotId = () => 'snap_' + crypto.randomUUID();

const j = (v) => (v == null ? null : JSON.stringify(v)); // bounded JSON; never raw payloads

// ── audit run rows ──
function insertRunStarted(db, r) {
  db.prepare(
    `INSERT INTO historical_snapshot_runs
       (run_id, trigger_type, requested_project_key, started_at_utc, business_date, timezone, mode, status,
        source_type, source_data_version, source_synced_at_utc, snapshot_count_requested)
     VALUES (@run_id,@trigger_type,@requested_project_key,@started_at_utc,@business_date,@timezone,@mode,'started',
        @source_type,@source_data_version,@source_synced_at_utc,@snapshot_count_requested)`
  ).run({
    run_id: r.runId, trigger_type: r.triggerType, requested_project_key: r.requestedProjectKey || null,
    started_at_utc: r.startedAtUtc, business_date: r.businessDate || null, timezone: r.timezone || null,
    mode: r.mode, source_type: r.sourceType || null, source_data_version: r.sourceDataVersion || null,
    source_synced_at_utc: r.sourceSyncedAtUtc || null, snapshot_count_requested: r.snapshotCountRequested != null ? r.snapshotCountRequested : null,
  });
}
function finalizeRun(db, runId, f) {
  db.prepare(
    `UPDATE historical_snapshot_runs SET
       completed_at_utc=@completed_at_utc, status=@status,
       source_type=COALESCE(@source_type, source_type),
       source_data_version=COALESCE(@source_data_version, source_data_version),
       source_synced_at_utc=COALESCE(@source_synced_at_utc, source_synced_at_utc),
       snapshot_count_created=@snapshot_count_created, snapshot_count_skipped=@snapshot_count_skipped,
       validation_error_count=@validation_error_count, error_code=@error_code, error_message=@error_message,
       metadata_json=@metadata_json
     WHERE run_id=@run_id`
  ).run({
    run_id: runId, completed_at_utc: f.completedAtUtc, status: f.status,
    source_type: f.sourceType || null, source_data_version: f.sourceDataVersion || null, source_synced_at_utc: f.sourceSyncedAtUtc || null,
    snapshot_count_created: f.created != null ? f.created : null, snapshot_count_skipped: f.skipped != null ? f.skipped : null,
    validation_error_count: f.validationErrorCount != null ? f.validationErrorCount : null,
    error_code: f.errorCode || null, error_message: f.errorMessage ? String(f.errorMessage).slice(0, 500) : null,
    metadata_json: j(f.metadata),
  });
}

// ── duplicate lookup (clean pre-check; UNIQUE constraint is the final guard) ──
function findProjectSnapshot(db, projectKey, businessDate) {
  return db.prepare(
    'SELECT id, snapshot_id AS snapshotId, run_id AS runId, captured_at_utc AS capturedAtUtc FROM historical_project_snapshots WHERE project_key=? AND business_date=?'
  ).get(projectKey, businessDate) || null;
}

// ONLY the project-date/snapshot-id uniqueness on the PARENT is a "duplicate skip". A
// UNIQUE violation on a child (building/tenant) is a real error → must roll back + rethrow,
// never be silently swallowed. (Matching e.code alone would wrongly catch child violations.)
function isProjectDuplicate(e) {
  return e && /UNIQUE constraint failed: historical_project_snapshots\.(project_key|snapshot_id|business_date)/.test(String(e.message));
}

/**
 * Persist ONE canonical snapshot atomically. Returns a structured result:
 *   { status:'created', created:true, snapshotId, projectSnapshotId }
 *   { status:'duplicate_skipped', created:false, existingSnapshotId }
 * Throws (with cause) only on unexpected DB failure.
 */
function persistProjectSnapshot(db, snapshot, runContext) {
  const p = snapshot.project, prov = snapshot.provenance;
  const nowUtc = prov.capturedAtUtc;

  const tx = db.transaction(() => {
    const parent = db.prepare(
      `INSERT INTO historical_project_snapshots
        (snapshot_id, run_id, project_key, project_name, business_date, timezone, captured_at_utc,
         source_type, source_data_version, source_synced_at_utc, source_record_count, schema_version, calculation_version,
         total_gla, leased_area, vacant_area, occupancy_percent,
         retail_total_area, retail_leased_area, retail_vacant_area, retail_occupancy_percent,
         office_total_area, office_leased_area, office_vacant_area, office_occupancy_percent,
         active_lease_count, tenant_count_raw, tenant_count_aggregated,
         occupied_unit_count, vacant_unit_count, total_unit_count,
         leasing_velocity_area_90d, leasing_velocity_lease_count_90d,
         unassigned_area, unassigned_unit_count, excluded_record_count,
         warning_count, warnings_json, metadata_json, created_at_utc)
       VALUES (@snapshot_id,@run_id,@project_key,@project_name,@business_date,@timezone,@captured_at_utc,
         @source_type,@source_data_version,@source_synced_at_utc,@source_record_count,@schema_version,@calculation_version,
         @total_gla,@leased_area,@vacant_area,@occupancy_percent,
         @retail_total_area,@retail_leased_area,@retail_vacant_area,@retail_occupancy_percent,
         @office_total_area,@office_leased_area,@office_vacant_area,@office_occupancy_percent,
         @active_lease_count,@tenant_count_raw,@tenant_count_aggregated,
         @occupied_unit_count,@vacant_unit_count,@total_unit_count,
         @leasing_velocity_area_90d,@leasing_velocity_lease_count_90d,
         @unassigned_area,@unassigned_unit_count,@excluded_record_count,
         @warning_count,@warnings_json,@metadata_json,@created_at_utc)`
    ).run({
      snapshot_id: prov.snapshotId, run_id: prov.runId, project_key: p.projectKey, project_name: p.projectName,
      business_date: prov.businessDate, timezone: prov.timezone, captured_at_utc: prov.capturedAtUtc,
      source_type: prov.sourceType, source_data_version: prov.sourceDataVersion, source_synced_at_utc: prov.sourceSyncedAtUtc,
      source_record_count: prov.sourceRecordCount, schema_version: prov.schemaVersion, calculation_version: prov.calculationVersion,
      total_gla: p.totalGla, leased_area: p.leasedArea, vacant_area: p.vacantArea, occupancy_percent: p.occupancyPercent,
      retail_total_area: p.retailTotalArea, retail_leased_area: p.retailLeasedArea, retail_vacant_area: p.retailVacantArea, retail_occupancy_percent: p.retailOccupancyPercent,
      office_total_area: p.officeTotalArea, office_leased_area: p.officeLeasedArea, office_vacant_area: p.officeVacantArea, office_occupancy_percent: p.officeOccupancyPercent,
      active_lease_count: p.activeLeaseCount, tenant_count_raw: p.tenantCountRaw, tenant_count_aggregated: p.tenantCountAggregated,
      occupied_unit_count: p.occupiedUnitCount, vacant_unit_count: p.vacantUnitCount, total_unit_count: p.totalUnitCount,
      leasing_velocity_area_90d: p.leasingVelocityArea90d, leasing_velocity_lease_count_90d: p.leasingVelocityLeaseCount90d,
      unassigned_area: p.unassignedArea, unassigned_unit_count: p.unassignedUnitCount, excluded_record_count: p.excludedRecordCount,
      warning_count: (snapshot.warnings || []).length, warnings_json: j(snapshot.warnings || []),
      metadata_json: j({ metadataVersion: prov.metadataVersion, calculationVersion: prov.calculationVersion, address: prov.address,
        buildingCount: snapshot.buildings.length, tenantCountAggregated: snapshot.tenants.length }),
      created_at_utc: nowUtc,
    });
    const projectSnapshotId = parent.lastInsertRowid;

    const insB = db.prepare(
      `INSERT INTO historical_building_snapshots
        (project_snapshot_id, snapshot_id, project_key, business_date, building_key, building_name, building_order,
         total_area, leased_area, vacant_area, occupancy_percent,
         retail_total_area, retail_leased_area, retail_vacant_area, retail_occupancy_percent,
         office_total_area, office_leased_area, office_vacant_area, office_occupancy_percent,
         tenant_count_raw, tenant_count_aggregated, unit_count, occupied_unit_count, vacant_unit_count,
         excluded_record_count, warnings_json, metadata_json, created_at_utc)
       VALUES (@psid,@snapshot_id,@project_key,@business_date,@building_key,@building_name,@building_order,
         @total_area,@leased_area,@vacant_area,@occupancy_percent,
         @retail_total_area,@retail_leased_area,@retail_vacant_area,@retail_occupancy_percent,
         @office_total_area,@office_leased_area,@office_vacant_area,@office_occupancy_percent,
         @tenant_count_raw,@tenant_count_aggregated,@unit_count,@occupied_unit_count,@vacant_unit_count,
         @excluded_record_count,@warnings_json,@metadata_json,@created_at_utc)`
    );
    for (const b of snapshot.buildings) {
      insB.run({
        psid: projectSnapshotId, snapshot_id: prov.snapshotId, project_key: p.projectKey, business_date: prov.businessDate,
        building_key: b.buildingKey, building_name: b.buildingName, building_order: b.buildingOrder,
        total_area: b.totalArea, leased_area: b.leasedArea, vacant_area: b.vacantArea, occupancy_percent: b.occupancyPercent,
        retail_total_area: b.retailTotalArea, retail_leased_area: b.retailLeasedArea, retail_vacant_area: b.retailVacantArea, retail_occupancy_percent: b.retailOccupancyPercent,
        office_total_area: b.officeTotalArea, office_leased_area: b.officeLeasedArea, office_vacant_area: b.officeVacantArea, office_occupancy_percent: b.officeOccupancyPercent,
        tenant_count_raw: b.tenantCountRaw, tenant_count_aggregated: b.tenantCountAggregated, unit_count: b.unitCount,
        occupied_unit_count: b.occupiedUnitCount, vacant_unit_count: b.vacantUnitCount,
        excluded_record_count: b.excludedRecordCount, warnings_json: j(b.warnings || []), metadata_json: null, created_at_utc: nowUtc,
      });
    }

    const insT = db.prepare(
      `INSERT INTO historical_tenant_snapshots
        (project_snapshot_id, snapshot_id, project_key, business_date, tenant_key, tenant_display_name, tenant_normalized_name,
         total_leased_area, lease_record_count, unit_count, building_count, building_keys_json, primary_category, categories_json,
         rank_by_area, is_top_3, is_top_5, is_top_10, active_lease_count, earliest_active_start_date, latest_active_start_date,
         warnings_json, metadata_json, created_at_utc)
       VALUES (@psid,@snapshot_id,@project_key,@business_date,@tenant_key,@display,@normalized,
         @total_leased_area,@lease_record_count,@unit_count,@building_count,@building_keys_json,@primary_category,@categories_json,
         @rank_by_area,@is_top_3,@is_top_5,@is_top_10,@active_lease_count,@earliest,@latest,
         @warnings_json,@metadata_json,@created_at_utc)`
    );
    for (const t of snapshot.tenants) {
      insT.run({
        psid: projectSnapshotId, snapshot_id: prov.snapshotId, project_key: p.projectKey, business_date: prov.businessDate,
        tenant_key: t.tenantKey, display: t.tenantDisplayName, normalized: t.tenantNormalizedName,
        total_leased_area: t.totalLeasedArea, lease_record_count: t.leaseRecordCount, unit_count: t.unitCount,
        building_count: t.buildingCount, building_keys_json: j(t.buildingKeys), primary_category: t.primaryCategory, categories_json: j(t.categories),
        rank_by_area: t.rankByArea, is_top_3: t.isTop3 ? 1 : 0, is_top_5: t.isTop5 ? 1 : 0, is_top_10: t.isTop10 ? 1 : 0,
        active_lease_count: t.activeLeaseCount, earliest: t.earliestActiveStartDate, latest: t.latestActiveStartDate,
        // CP9: record the identity basis explicitly (no confident cross-date entity id yet).
        warnings_json: null, metadata_json: j({ identityMethod: 'normalized-name', identityConfidence: 'low' }), created_at_utc: nowUtc,
      });
    }
    return projectSnapshotId;
  });

  try {
    const projectSnapshotId = tx();
    return { status: 'created', created: true, snapshotId: prov.snapshotId, projectSnapshotId };
  } catch (e) {
    if (isProjectDuplicate(e)) {
      const existing = findProjectSnapshot(db, p.projectKey, prov.businessDate);
      return { status: 'duplicate_skipped', created: false, existingSnapshotId: existing ? existing.snapshotId : null };
    }
    throw e; // unexpected (incl. child-constraint violation) → rolled back; caller records failure
  }
}

// ── dev inspection helpers (§29) — read-only, no destructive endpoints ──
function listRecentSnapshots(db, limit = 20) {
  return db.prepare(
    `SELECT snapshot_id, project_key, business_date, captured_at_utc, occupancy_percent, tenant_count_aggregated, source_data_version
     FROM historical_project_snapshots ORDER BY captured_at_utc DESC, id DESC LIMIT ?`
  ).all(limit);
}
function listRecentRuns(db, limit = 20) {
  return db.prepare(
    `SELECT run_id, trigger_type, mode, status, business_date, started_at_utc, completed_at_utc, snapshot_count_created, snapshot_count_skipped
     FROM historical_snapshot_runs ORDER BY started_at_utc DESC, id DESC LIMIT ?`
  ).all(limit);
}
function countSnapshots(db) { return db.prepare('SELECT COUNT(*) n FROM historical_project_snapshots').get().n; }

module.exports = {
  newRunId, newSnapshotId,
  insertRunStarted, finalizeRun, findProjectSnapshot, persistProjectSnapshot,
  listRecentSnapshots, listRecentRuns, countSnapshots,
};
