'use strict';
/**
 * BlackSand dashboard — Monday → canonical mapper (Phase 6).
 *
 * Converts RAW Monday board items into CANONICAL records using the board's column
 * mapping (config) + the type adapters. All Monday-specific knowledge lives here and
 * in adapters.js — nothing downstream (transformer/validator/persistence/renderer)
 * ever sees a raw Monday object or contains mapping logic.
 *
 * Column IDs are resolved from the mapping config (never display titles). The set of
 * column IDs a board needs is derived here too (for the GraphQL `columnIds` variable).
 */

const { coerce } = require('./adapters');
const { isRawItem, isRawColumnValue } = require('./schema');
const { resolveStatus } = require('./status');
const { SchemaMismatchError, TransformError } = require('./errors');

/** All column IDs a board's mapping references (feeds the GraphQL columnIds variable). */
function columnIdsForBoard(boardConfig) {
  const cols = boardConfig.columns || {};
  return Object.values(cols).map((c) => c && c.id).filter(Boolean);
}

// Build an { columnId -> rawColumnValue } lookup for one item.
function indexColumns(item) {
  const idx = {};
  for (const cv of item.column_values) {
    if (!isRawColumnValue(cv)) throw new SchemaMismatchError('malformed column_value in Monday item', { itemId: item.id });
    idx[cv.id] = cv;
  }
  return idx;
}

// Coerce one mapped field from an item's column lookup. Returns null when unmapped.
function readField(colIndex, spec) {
  if (!spec || !spec.id) return null;
  const raw = colIndex[spec.id] || null;
  return coerce(raw, spec);
}

/**
 * Map a lease-grain board's items → { project, categories, leases }.
 * @param {object} rawBoard   { id, name, items } (items from the client)
 * @param {object} boardConfig one entry of mapping.boards[boardId]
 */
function mapLeaseBoard(rawBoard, boardConfig) {
  if (!boardConfig || !boardConfig.projectSlug) {
    throw new TransformError('board mapping missing projectSlug', { board: rawBoard && rawBoard.id });
  }
  const cols = boardConfig.columns || {};
  const projectSlug = boardConfig.projectSlug;

  const project = {
    slug: projectSlug,
    name: boardConfig.projectName || rawBoard.name || projectSlug,
    address: boardConfig.address || null,
    externalId: String(rawBoard.id != null ? rawBoard.id : ''),
    source: 'monday',
  };

  const categories = (boardConfig.categories || []).map((c, i) => {
    // Total GLA source is EXPLICIT: a config constant (c.totalArea), or
    // preserve-existing (do not overwrite the stored value). Never defaulted to 0.
    const preserveTotalArea = c.totalAreaSource === 'preserve-existing';
    return {
      projectSlug,
      code: c.code,
      label: c.label,
      totalArea: preserveTotalArea ? null : (c.totalArea != null ? Number(c.totalArea) : null),
      totalAreaSource: c.totalAreaSource || (c.totalArea != null ? 'config' : null),
      preserveTotalArea,
      occupancySource: c.occupancySource || 'leases',
      explicitLeasedPct: c.explicitLeasedPct != null ? Number(c.explicitLeasedPct) : null,
      sortOrder: i,
    };
  });

  const leases = (rawBoard.items || []).map((item) => {
    if (!isRawItem(item)) throw new SchemaMismatchError('malformed Monday item', { board: rawBoard.id });
    const colIndex = indexColumns(item);
    const tenantName = readField(colIndex, cols.tenantName) || (item.name != null ? String(item.name).trim() : null);
    const rawStatus = readField(colIndex, cols.status);
    const { canonical: canonicalStatus, known: statusKnown } = resolveStatus(rawStatus, boardConfig);
    // Category may come from the item's GROUP (categorySource:'group' + groupMap keyed
    // by group id, falling back to group title) or from a mapped column (default).
    let categoryCode;
    if (boardConfig.categorySource === 'group') {
      const g = item.group || {};
      const gm = boardConfig.groupMap || {};
      categoryCode = (g.id != null && gm[g.id] != null) ? gm[g.id] : (g.title != null ? gm[g.title] : null);
      if (categoryCode == null) categoryCode = null; // unmapped group → validator flags it
    } else {
      categoryCode = readField(colIndex, cols.category);
    }
    return {
      externalId: String(item.id),               // stable Monday item id → lease external key
      projectSlug,
      categoryCode,
      // The Monday item NAME is the unit code (e.g. "(A-GF-R01)" / "C04" / "D101"). Kept
      // RAW here (only trimmed) — building allocation normalizes it downstream. Distinct
      // from tenantName (a column); one may exist without the other.
      unitCode: item.name != null ? String(item.name).trim() : null,
      tenantName,
      tenantType: readField(colIndex, cols.tenantType),
      area: readField(colIndex, cols.area),
      leaseDate: readField(colIndex, cols.leaseDate),
      status: canonicalStatus,                    // CANONICAL status (active/future/…/unknown)
      rawStatus: rawStatus != null ? String(rawStatus) : null,
      statusKnown,                                // false → validation error (never silently active)
      buildingRef: readField(colIndex, cols.building), // diagnostic in v1 (buildingSource='manual')
      logoPath: (() => {
        const f = readField(colIndex, cols.logo);
        return Array.isArray(f) ? (f[0] || null) : (f || null);
      })(),
      sourceUpdatedAt: item.updated_at || null,
    };
  });

  return { project, categories, leases };
}

/**
 * Map every configured board's raw items into one merged canonical dataset.
 * @param {object} rawByBoard  { [boardId]: { id, name, items } }
 * @param {object} mapping     the mapping config (mapping.boards)
 */
function mapDataset(rawByBoard, mapping) {
  const dataset = { projects: [], categories: [], buildings: [], departments: [], leases: [] };
  for (const [boardId, boardConfig] of Object.entries(mapping.boards || {})) {
    const rawBoard = rawByBoard[boardId];
    if (!rawBoard) continue; // board not fetched (e.g. offline) — skip cleanly
    const grain = boardConfig.itemGrain || 'lease';
    if (grain !== 'lease') {
      // Building-grain boards are a documented Phase 7+ extension; skip for now.
      continue;
    }
    const { project, categories, leases } = mapLeaseBoard(rawBoard, boardConfig);
    dataset.projects.push(project);
    dataset.categories.push(...categories);
    dataset.leases.push(...leases);
  }
  return dataset;
}

module.exports = { columnIdsForBoard, mapLeaseBoard, mapDataset, indexColumns, readField };
