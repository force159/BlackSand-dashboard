'use strict';
/**
 * Phase 9.2B — tenant movement between two snapshot dates. Reuses the Phase 9.2A snapshot
 * selection + change math. Identity is normalized-name (confidence 'low'), so results use
 * the LOW-confidence buckets (possibleRetained/possibleEntry/possibleExit). possibleRename
 * is NOT inferred — there is no reliable signal without a stable id, and fuzzy matching is
 * forbidden — so it is always empty + documented (evidence-based, never guessed).
 */

const repo = require('../query-repository');
const { resolveSelection } = require('./comparison-service');
const { computeChange, direction } = require('./change-math');
const { tenantIdentityModel } = require('./tenant-analytics');

const num = (v) => (v == null ? null : Number(v));
const parseJson = (v) => { if (v == null || v === '') return null; try { return JSON.parse(v); } catch (_) { return null; } };
const delta = (a, b) => ({ from: num(a), to: num(b), ...computeChange(num(a), num(b)) });
const mini = (t) => ({ tenantKey: t.tenant_key, displayName: t.tenant_display_name, leasedArea: num(t.total_leased_area), unitCount: num(t.unit_count), leaseCount: num(t.lease_record_count), buildings: parseJson(t.building_keys_json) || [] });

function computeMovement(db, { projectKey, from, to, policy }) {
  const sel = resolveSelection(db, projectKey, { from, to, policy }); // reused 9.2A selection
  const fromMap = new Map(repo.getAllTenantsForDate(db, projectKey, sel.from).map((t) => [t.tenant_key, t]));
  const toMap = new Map(repo.getAllTenantsForDate(db, projectKey, sel.to).map((t) => [t.tenant_key, t]));

  const possibleRetained = [], possibleEntry = [], possibleExit = [];
  for (const [k, tt] of toMap) {
    if (fromMap.has(k)) {
      const ft = fromMap.get(k);
      const area = delta(ft.total_leased_area, tt.total_leased_area);
      possibleRetained.push({
        tenantKey: k, displayName: tt.tenant_display_name,
        leasedArea: area, unitCount: delta(ft.unit_count, tt.unit_count),
        leaseCount: delta(ft.lease_record_count, tt.lease_record_count), buildingCount: delta(ft.building_count, tt.building_count),
        buildingsFrom: parseJson(ft.building_keys_json) || [], buildingsTo: parseJson(tt.building_keys_json) || [],
        movementType: direction(area.absolute) === 'up' ? 'expansion' : (direction(area.absolute) === 'down' ? 'contraction' : 'stable'),
      });
    } else possibleEntry.push(mini(tt));
  }
  for (const [k, ft] of fromMap) if (!toMap.has(k)) possibleExit.push(mini(ft));

  return {
    projectKey, from: sel.from, to: sel.to, sameSelection: sel.from === sel.to,
    identityConfidence: 'low', identity: tenantIdentityModel(),
    counts: { possibleRetained: possibleRetained.length, possibleEntry: possibleEntry.length, possibleExit: possibleExit.length, possibleRename: 0 },
    possibleRetained, possibleEntry, possibleExit, possibleRename: [],
    // High-confidence retained/entered/exited require a stable identity, which does not exist.
    limitations: [
      'Movement is LOW confidence (normalized-name identity).',
      'Rename/rebrand cannot be distinguished from an exit + a new entry; possibleRename is not inferred.',
      'Same normalized name is treated as the same tenant; genuinely different companies sharing a normalized name would be merged.',
    ],
  };
}

module.exports = { computeMovement };
