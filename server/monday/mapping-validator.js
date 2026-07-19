'use strict';
/**
 * BlackSand dashboard — Monday mapping validator (Phase 6 hardening).
 *
 * Validates a mapping object for PRODUCTION readiness. In production mode a `<...>`
 * placeholder id (or empty id) is an ERROR; in draft mode (allowPlaceholders) it is a
 * WARNING so offline development can proceed. No network — this checks structure only.
 * Never inspects or emits secret values.
 */

const { OCCUPANCY_SOURCES } = require('./schema');
const { CANONICAL_STATUSES } = require('./status');

const REQUIRED_COLUMNS = ['tenantName', 'category', 'area'];
const PLACEHOLDER_RE = /^<.*>$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SECRET_KEYS = /(token|apikey|api_key|secret|password|authorization)/i;
const BUILDING_SOURCES = ['manual', 'monday-board', 'lease-column'];

function isPlaceholder(v) { return v == null || v === '' || PLACEHOLDER_RE.test(String(v)); }

function validateMapping(mapping, options = {}) {
  const allowPlaceholders = options.allowPlaceholders === true;
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  const flagId = (label, v) => { if (isPlaceholder(v)) { (allowPlaceholders ? warn : err)(`${label} is a placeholder/empty ("${v}")`); } };

  if (!mapping || typeof mapping !== 'object') { return { ok: false, errors: ['mapping is not an object'], warnings }; }
  if (mapping.version == null) warn('mapping has no version');
  const boards = mapping.boards || {};
  const boardIds = Object.keys(boards);
  if (boardIds.length === 0) { return { ok: false, errors: ['mapping has no boards'], warnings }; }

  const seenSlugs = new Set();
  const seenBoardIds = new Set();
  let enabledRequired = 0;

  for (const [boardId, b] of Object.entries(boards)) {
    if (b.enabled === false) continue; // disabled boards are ignored
    const required = b.required !== false;
    if (required) enabledRequired++;
    const scope = `board "${String(boardId).slice(0, 24)}"`;

    if (seenBoardIds.has(boardId)) err(`${scope}: duplicate board id`);
    seenBoardIds.add(boardId);
    flagId(`${scope} board id`, boardId);

    if (!b.projectSlug) err(`${scope}: missing projectSlug`);
    else if (!SLUG_RE.test(b.projectSlug)) err(`${scope}: projectSlug "${b.projectSlug}" not normalized`);
    if (b.projectSlug) { if (seenSlugs.has(b.projectSlug)) err(`duplicate projectSlug "${b.projectSlug}"`); seenSlugs.add(b.projectSlug); }
    if (b.itemGrain !== 'lease') err(`${scope}: itemGrain must be "lease" in v1 (got "${b.itemGrain}")`);
    if (!BUILDING_SOURCES.includes(b.buildingSource)) err(`${scope}: buildingSource must be one of ${BUILDING_SOURCES.join('/')} (got "${b.buildingSource}")`);

    // columns — `category` is required only when the category comes from a column;
    // group-based boards (categorySource:'group') use `groupMap` instead.
    const cols = b.columns || {};
    const groupBased = b.categorySource === 'group';
    const requiredCols = groupBased ? REQUIRED_COLUMNS.filter((c) => c !== 'category') : REQUIRED_COLUMNS;
    for (const rc of requiredCols) {
      if (!cols[rc] || !('id' in cols[rc])) err(`${scope}: required column "${rc}" is missing`);
      else flagId(`${scope} column "${rc}" id`, cols[rc].id);
    }
    for (const [cn, c] of Object.entries(cols)) {
      if (c && c.id != null) flagId(`${scope} column "${cn}" id`, c.id);
    }
    if (groupBased) {
      if (!b.groupMap || Object.keys(b.groupMap).length === 0) err(`${scope}: categorySource is "group" but groupMap is empty`);
    } else if (cols.category && (!cols.category.map || Object.keys(cols.category.map).length === 0)) {
      err(`${scope}: category column has an empty "map"`);
    }

    // status
    if (b.statusOptional === true) { /* ok: no status column expected */ }
    else if (!cols.status || !cols.status.id) err(`${scope}: no status column and statusOptional is not true`);
    else if (!b.statusMap || Object.keys(b.statusMap).length === 0) err(`${scope}: status column mapped but statusMap is empty`);
    if (b.statusMap) {
      for (const [label, canon] of Object.entries(b.statusMap)) {
        if (!CANONICAL_STATUSES.includes(canon)) err(`${scope}: statusMap "${label}" → "${canon}" is not a canonical status`);
      }
    }

    // categories
    const cats = b.categories || [];
    if (cats.length === 0) err(`${scope}: no categories`);
    const catCodes = new Set();
    for (const c of cats) {
      if (!c.code) err(`${scope}: a category has no code`);
      else { if (catCodes.has(c.code)) err(`${scope}: duplicate category code "${c.code}"`); catCodes.add(c.code); }
      if (!c.label) err(`${scope}: category "${c.code}" has no label`);
      if (!OCCUPANCY_SOURCES.includes(c.occupancySource)) err(`${scope}: category "${c.code}" occupancySource "${c.occupancySource}" not canonical`);
      const hasGla = (c.totalArea != null && Number.isFinite(Number(c.totalArea)) && Number(c.totalArea) >= 0) || c.totalAreaSource === 'preserve-existing';
      if (!hasGla) err(`${scope}: category "${c.code}" has no valid total GLA source (config value >=0 or totalAreaSource:"preserve-existing")`);
      if (c.explicitLeasedPct != null && (!(Number(c.explicitLeasedPct) >= 0 && Number(c.explicitLeasedPct) <= 1))) err(`${scope}: category "${c.code}" explicitLeasedPct out of 0..1`);
    }

    // safety block
    if (b.safety) {
      for (const k of ['minAcceptedRecords', 'maxRecordDropPercent']) {
        if (b.safety[k] != null && !Number.isFinite(Number(b.safety[k]))) err(`${scope}: safety.${k} must be a number`);
      }
    }

    // secret-like values embedded anywhere in the board config
    for (const k of Object.keys(b)) if (SECRET_KEYS.test(k)) err(`${scope}: contains a secret-like key "${k}" (tokens belong in .env only)`);
  }

  if (enabledRequired === 0) warn('no enabled+required boards');
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateMapping, REQUIRED_COLUMNS, BUILDING_SOURCES, isPlaceholder };
