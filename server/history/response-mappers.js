'use strict';
/**
 * Phase 9.1B CP8 — public API response mappers. Turn raw SQLite rows into a STABLE public
 * contract: camelCase, parsed JSON columns, booleans for 0/1 flags, numbers stay numbers,
 * nullable preserved, internal columns (row ids, project_snapshot_id, snapshot linkage
 * beyond the public id) omitted. No SQL/stack/secret ever reaches these objects.
 */

// Parse a stored JSON column safely. Policy: malformed JSON → null + a recorded warning
// (never throws, never leaks the raw string as data).
function parseJson(v, warnings, field) {
  if (v == null || v === '') return null;
  try { return JSON.parse(v); } catch (_) { if (warnings) warnings.push('malformed JSON in ' + field); return null; }
}
const bool = (v) => v === 1 || v === true;
const numOrNull = (v) => (v == null ? null : Number(v));

function mapProjectSnapshot(row) {
  const w = [];
  return {
    snapshotId: row.snapshot_id, projectKey: row.project_key, projectName: row.project_name,
    businessDate: row.business_date, timezone: row.timezone, capturedAtUtc: row.captured_at_utc,
    source: { type: row.source_type, dataVersion: row.source_data_version, syncedAtUtc: row.source_synced_at_utc, recordCount: numOrNull(row.source_record_count) },
    schemaVersion: numOrNull(row.schema_version), calculationVersion: row.calculation_version,
    totalGla: numOrNull(row.total_gla), leasedArea: numOrNull(row.leased_area), vacantArea: numOrNull(row.vacant_area), occupancyPercent: numOrNull(row.occupancy_percent),
    retail: { totalArea: numOrNull(row.retail_total_area), leasedArea: numOrNull(row.retail_leased_area), vacantArea: numOrNull(row.retail_vacant_area), occupancyPercent: numOrNull(row.retail_occupancy_percent) },
    office: { totalArea: numOrNull(row.office_total_area), leasedArea: numOrNull(row.office_leased_area), vacantArea: numOrNull(row.office_vacant_area), occupancyPercent: numOrNull(row.office_occupancy_percent) },
    activeLeaseCount: numOrNull(row.active_lease_count), tenantCountRaw: numOrNull(row.tenant_count_raw), tenantCountAggregated: numOrNull(row.tenant_count_aggregated),
    occupiedUnitCount: numOrNull(row.occupied_unit_count), vacantUnitCount: numOrNull(row.vacant_unit_count), totalUnitCount: numOrNull(row.total_unit_count),
    leasingVelocityArea90d: numOrNull(row.leasing_velocity_area_90d), leasingVelocityLeaseCount90d: numOrNull(row.leasing_velocity_lease_count_90d),
    unassignedArea: numOrNull(row.unassigned_area), unassignedUnitCount: numOrNull(row.unassigned_unit_count), excludedRecordCount: numOrNull(row.excluded_record_count),
    warningCount: numOrNull(row.warning_count), warnings: parseJson(row.warnings_json, w, 'warnings') || [],
    metadata: parseJson(row.metadata_json, w, 'metadata') || {},
    dataIntegrityWarnings: w.length ? w : undefined,
  };
}

function mapBuilding(row) {
  return {
    buildingKey: row.building_key, buildingName: row.building_name, buildingOrder: numOrNull(row.building_order),
    projectKey: row.project_key, businessDate: row.business_date,
    totalArea: numOrNull(row.total_area), leasedArea: numOrNull(row.leased_area), vacantArea: numOrNull(row.vacant_area), occupancyPercent: numOrNull(row.occupancy_percent),
    retail: { totalArea: numOrNull(row.retail_total_area), leasedArea: numOrNull(row.retail_leased_area), vacantArea: numOrNull(row.retail_vacant_area), occupancyPercent: numOrNull(row.retail_occupancy_percent) },
    office: { totalArea: numOrNull(row.office_total_area), leasedArea: numOrNull(row.office_leased_area), vacantArea: numOrNull(row.office_vacant_area), occupancyPercent: numOrNull(row.office_occupancy_percent) },
    tenantCountRaw: numOrNull(row.tenant_count_raw), tenantCountAggregated: numOrNull(row.tenant_count_aggregated),
    unitCount: numOrNull(row.unit_count), occupiedUnitCount: numOrNull(row.occupied_unit_count), vacantUnitCount: numOrNull(row.vacant_unit_count),
    excludedRecordCount: numOrNull(row.excluded_record_count),
  };
}

function mapTenant(row) {
  const w = [];
  const meta = parseJson(row.metadata_json, w, 'metadata') || {};
  return {
    tenantKey: row.tenant_key, displayName: row.tenant_display_name, normalizedName: row.tenant_normalized_name,
    projectKey: row.project_key, businessDate: row.business_date,
    totalLeasedArea: numOrNull(row.total_leased_area), leaseRecordCount: numOrNull(row.lease_record_count), unitCount: numOrNull(row.unit_count),
    buildingCount: numOrNull(row.building_count), buildingKeys: parseJson(row.building_keys_json, w, 'buildingKeys') || [],
    primaryCategory: row.primary_category, categories: parseJson(row.categories_json, w, 'categories') || {},
    rankByArea: numOrNull(row.rank_by_area), isTop3: bool(row.is_top_3), isTop5: bool(row.is_top_5), isTop10: bool(row.is_top_10),
    activeLeaseCount: numOrNull(row.active_lease_count), earliestActiveStartDate: row.earliest_active_start_date, latestActiveStartDate: row.latest_active_start_date,
    // CP9: identity basis is explicit (no confident cross-date entity identity yet).
    identityMethod: meta.identityMethod || 'normalized-name', identityConfidence: meta.identityConfidence || 'low',
    dataIntegrityWarnings: w.length ? w : undefined,
  };
}

function mapRun(row) {
  const w = [];
  const meta = parseJson(row.metadata_json, w, 'metadata') || {};
  return {
    runId: row.run_id, businessDate: row.business_date, trigger: row.trigger_type, originalTrigger: meta.originalTrigger || row.trigger_type,
    mode: row.mode, status: row.status, decisionCode: (meta.results && meta.results[0] && meta.results[0].decisionCode) || null,
    correlationId: meta.correlationId || null, durationMs: numOrNull(meta.durationMs),
    source: { type: row.source_type, dataVersion: row.source_data_version, syncedAtUtc: row.source_synced_at_utc, syncRunId: meta.sourceSyncRunId || null },
    snapshotCountRequested: numOrNull(row.snapshot_count_requested), snapshotCountCreated: numOrNull(row.snapshot_count_created), snapshotCountSkipped: numOrNull(row.snapshot_count_skipped),
    validationErrorCount: numOrNull(row.validation_error_count), errorCode: row.error_code, errorMessage: row.error_message,
    startedAtUtc: row.started_at_utc, completedAtUtc: row.completed_at_utc,
  };
}

function mapDate(row) {
  return { date: row.date, projectCount: numOrNull(row.projectCount), firstCapturedAtUtc: row.firstCreatedAt, projects: row.projects || [] };
}

module.exports = { mapProjectSnapshot, mapBuilding, mapTenant, mapRun, mapDate };
