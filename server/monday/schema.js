'use strict';
/**
 * BlackSand dashboard — canonical model + raw-Monday shape definitions (Phase 6).
 *
 * The CANONICAL model is the ONLY thing that flows past the mapper. It mirrors the
 * shape the existing repositories/seed already use, so Monday data ends up identical
 * to seed data (same /api/dashboard, no frontend change). This module also declares
 * what a valid raw Monday item/column looks like, so a changed API schema is detected
 * (SchemaMismatchError) rather than silently corrupting data.
 */

// Canonical record field lists (the persistence/repository contract).
const CANONICAL_FIELDS = {
  project: ['slug', 'name', 'address', 'externalId', 'source'],
  category: ['projectSlug', 'code', 'label', 'totalArea', 'occupancySource', 'explicitLeasedPct'],
  building: ['projectSlug', 'externalId', 'name', 'code', 'sortOrder'],
  department: ['buildingRef', 'code', 'label', 'totalArea', 'leasedArea'],
  lease: ['externalId', 'projectSlug', 'categoryCode', 'tenantName', 'tenantType', 'area', 'leaseDate', 'status', 'buildingRef', 'logoPath'],
};

// Canonical occupancy sources (mirrors the seed/schema constraint).
const OCCUPANCY_SOURCES = ['leases', 'explicit_percentage', 'building_totals'];

/** Shape check for a raw Monday item from items_page. */
function isRawItem(item) {
  return Boolean(item && typeof item === 'object' && item.id != null && Array.isArray(item.column_values));
}
/** Shape check for a raw Monday column_value. */
function isRawColumnValue(cv) {
  return Boolean(cv && typeof cv === 'object' && typeof cv.id === 'string');
}
/** Shape check for the boards[].items_page envelope. */
function isItemsPage(page) {
  return Boolean(page && typeof page === 'object' && Array.isArray(page.items));
}

/** Empty canonical dataset (the transformer/diff/persistence input shape). */
function emptyCanonicalDataset() {
  return { projects: [], categories: [], buildings: [], departments: [], leases: [] };
}

module.exports = { CANONICAL_FIELDS, OCCUPANCY_SOURCES, isRawItem, isRawColumnValue, isItemsPage, emptyCanonicalDataset };
