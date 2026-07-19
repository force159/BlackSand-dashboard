'use strict';
/**
 * BlackSand dashboard — difference engine (Phase 6).
 *
 * Compares an INCOMING transformed dataset against the CURRENT database rows and
 * classifies each record as inserted / updated / deleted / unchanged, keyed by a
 * stable external identity. A per-record content hash (SHA-256 of canonical business
 * fields) drives update detection so unchanged rows are NOT rewritten. Pure + offline:
 * the "current" side is passed in (read by the caller), so this module never touches
 * the DB or the network. Produces a concise summary for logging + the sync result.
 */

const crypto = require('crypto');

function hashFields(obj, fields) {
  const canonical = {};
  for (const f of fields) canonical[f] = obj[f] === undefined ? null : obj[f];
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Diff two keyed maps. Returns { inserts, updates, deletes, unchanged } as arrays of
 * { key, incoming?, current? }.
 * @param {Map} currentByKey  key -> current record (with a `hash`)
 * @param {Map} incomingByKey key -> incoming record (with a `hash`)
 */
function diffByKey(currentByKey, incomingByKey) {
  const inserts = [], updates = [], deletes = [], unchanged = [];
  for (const [key, incoming] of incomingByKey) {
    const current = currentByKey.get(key);
    if (!current) inserts.push({ key, incoming });
    else if (current.hash !== incoming.hash) updates.push({ key, incoming, current });
    else unchanged.push({ key, incoming, current });
  }
  for (const [key, current] of currentByKey) {
    if (!incomingByKey.has(key)) deletes.push({ key, current });
  }
  return { inserts, updates, deletes, unchanged };
}

// Field sets that define "changed" per entity (business fields only; ids/timestamps
// excluded). Includes canonical status + current-state inclusion (isActive) — both
// visible. `buildingRef` is NOT included: in v1 it is diagnostic-only (not persisted,
// not shown), so it must not trigger rewrites; add it here when buildings become
// Monday-authoritative and lease→building assignment is visible.
// `unitCode` IS included: it drives building allocation (visible in the dashboard), so a
// unit-code change must produce an update + a new dataVersion. (`buildingRef` remains
// excluded — still diagnostic-only.)
const LEASE_HASH_FIELDS = ['categoryCode', 'unitCode', 'tenantName', 'tenantType', 'area', 'leaseDate', 'status', 'isActive', 'logoPath'];
const PROJECT_HASH_FIELDS = ['name', 'address'];
const CATEGORY_HASH_FIELDS = ['label', 'totalArea', 'occupancySource', 'explicitLeasedPct'];

/** Build a keyed map of leases (key = externalId) with content hashes, for one project. */
function indexLeases(leases) {
  const map = new Map();
  for (const l of leases) map.set(String(l.externalId), { ...l, hash: hashFields(l, LEASE_HASH_FIELDS) });
  return map;
}

/**
 * Diff leases for a project. `currentLeases` are DB rows (must expose externalId +
 * the LEASE_HASH_FIELDS), `incomingLeases` are transformed Monday leases.
 */
function diffLeases(currentLeases, incomingLeases) {
  return diffByKey(indexLeases(currentLeases), indexLeases(incomingLeases));
}

/** Summarise one or more diffs into counts for logging / the sync result. */
function summarize(diffs) {
  const acc = { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };
  for (const d of [].concat(diffs)) {
    acc.inserted += d.inserts.length;
    acc.updated += d.updates.length;
    acc.deleted += d.deletes.length;
    acc.unchanged += d.unchanged.length;
  }
  acc.changed = acc.inserted + acc.updated + acc.deleted;
  return acc;
}

module.exports = {
  hashFields, diffByKey, diffLeases, indexLeases, summarize,
  LEASE_HASH_FIELDS, PROJECT_HASH_FIELDS, CATEGORY_HASH_FIELDS,
};
