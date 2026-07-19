'use strict';
/**
 * Monday hardening RULE tests (offline): status inclusion + unknown rejection, total-GLA
 * source safety, empty/collapse safety, mapping validator, and security (redaction /
 * secret detection). No network, no DB.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../../server/monday');
const { activeFlag, resolveStatus, CANONICAL_STATUSES } = require('../../server/monday/status');
const { evaluateSafety } = require('../../server/monday/safety');
const { validateMapping } = require('../../server/monday/mapping-validator');

// ── STATUS ──
test('status inclusion: only active counts as current-state (is_active=1)', () => {
  assert.strictEqual(activeFlag('active'), 1);
  for (const s of ['future', 'terminated', 'cancelled', 'expired', 'draft', 'unknown']) assert.strictEqual(activeFlag(s), 0, `${s} must not be active`);
});
test('resolveStatus maps labels, flags unknown, honours statusOptional', () => {
  const b = { statusMap: { Signed: 'active', Cancelled: 'cancelled' } };
  assert.deepStrictEqual(resolveStatus('Signed', b), { canonical: 'active', known: true });
  assert.deepStrictEqual(resolveStatus('Cancelled', b), { canonical: 'cancelled', known: true });
  assert.strictEqual(resolveStatus('Weird', b).known, false); // unknown label
  assert.strictEqual(resolveStatus(null, b).known, false); // missing, not optional
  assert.deepStrictEqual(resolveStatus(null, { statusOptional: true }), { canonical: 'active', known: true });
});
test('validator rejects a lease whose status is unknown (never silently active)', () => {
  const canonical = { projects: [{ slug: 'p', name: 'P', source: 'monday', externalId: 'B' }], categories: [{ projectSlug: 'p', code: 'retail', label: 'R', totalArea: 100, occupancySource: 'leases', explicitLeasedPct: null }], buildings: [], departments: [], leases: [{ externalId: '1', projectSlug: 'p', categoryCode: 'retail', tenantName: 'A', area: 5, leaseDate: null, status: 'unknown', statusKnown: false, rawStatus: 'Weird' }] };
  assert.ok(M.validateCanonicalDataset(canonical).errors.some((e) => /unknown status/.test(e)));
});
test('changing status changes the model dataVersion', () => {
  const mk = (status) => ({ source: 'monday', projects: [{ slug: 'p', name: 'P', address: 'A', categories: [{ code: 'retail', label: 'R', totalArea: 100, occupancySource: 'leases', explicitLeasedPct: null, sortOrder: 0 }], buildings: [], leases: [{ externalId: '1', categoryCode: 'retail', tenantName: 'A', tenantType: null, area: 5, leaseDate: null, status, isActive: activeFlag(status), logoPath: null }] }] });
  assert.notStrictEqual(M.syncEngine.computeModelVersion(mk('active')), M.syncEngine.computeModelVersion(mk('terminated')));
});

// ── TOTAL GLA ──
function ds(catOverride, leaseArea = 5) {
  return { projects: [{ slug: 'p', name: 'P', source: 'monday', externalId: 'B' }], categories: [Object.assign({ projectSlug: 'p', code: 'retail', label: 'R', occupancySource: 'leases', explicitLeasedPct: null }, catOverride)], buildings: [], departments: [], leases: [{ externalId: '1', projectSlug: 'p', categoryCode: 'retail', tenantName: 'A', area: leaseArea, leaseDate: null, status: 'active', statusKnown: true }] };
}
test('GLA: config value accepted; missing rejected; negative rejected; preserve-existing accepted; zero allowed', () => {
  assert.strictEqual(M.validateCanonicalDataset(ds({ totalArea: 1892 })).ok, true);
  assert.ok(M.validateCanonicalDataset(ds({ totalArea: null })).errors.some((e) => /no total GLA source/.test(e)));
  assert.ok(M.validateCanonicalDataset(ds({ totalArea: -1 })).errors.some((e) => /totalArea invalid/.test(e)));
  assert.strictEqual(M.validateCanonicalDataset(ds({ totalArea: null, preserveTotalArea: true })).ok, true);
  assert.strictEqual(M.validateCanonicalDataset(ds({ totalArea: 0 })).ok, true); // explicit zero allowed
});

// ── SAFETY ──
test('safety: empty rejected, collapse rejected, first cutover + override allowed', () => {
  assert.strictEqual(evaluateSafety({ acceptedCount: 0, previousCount: 10, previousSource: 'monday', boardConfig: {} }).ok, false);
  assert.strictEqual(evaluateSafety({ acceptedCount: 2, previousCount: 60, previousSource: 'monday', boardConfig: {} }).ok, false); // -97%
  assert.strictEqual(evaluateSafety({ acceptedCount: 55, previousCount: 60, previousSource: 'monday', boardConfig: {} }).ok, true); // -8%
  assert.strictEqual(evaluateSafety({ acceptedCount: 2, previousCount: 60, previousSource: 'seed', boardConfig: {} }).ok, true); // first cutover skips drop rule
  assert.strictEqual(evaluateSafety({ acceptedCount: 0, previousCount: 60, previousSource: 'monday', boardConfig: { safety: { allowEmpty: true } } }).ok, true);
  assert.strictEqual(evaluateSafety({ acceptedCount: 2, previousCount: 60, previousSource: 'monday', boardConfig: {}, override: true }).ok, true);
});

// ── MAPPING VALIDATOR ──
function goodBoard(over = {}) {
  return Object.assign({ enabled: true, required: true, projectSlug: 'business-address', projectName: 'BA', itemGrain: 'lease', buildingSource: 'manual', statusOptional: true, categories: [{ code: 'retail', label: 'R', occupancySource: 'leases', totalArea: 1892 }], columns: { tenantName: { id: 'a' }, category: { id: 'b', map: { R: 'retail' } }, area: { id: 'c' } } }, over);
}
test('mapping validator: valid board ok; placeholders error in prod, warn in draft', () => {
  assert.strictEqual(validateMapping({ boards: { B1: goodBoard() } }).ok, true);
  const ph = { boards: { '<board-id>': goodBoard() } };
  assert.strictEqual(validateMapping(ph, { allowPlaceholders: false }).ok, false);
  assert.strictEqual(validateMapping(ph, { allowPlaceholders: true }).ok, true);
});
test('mapping validator: catches missing column, empty statusMap, missing GLA, secret key, bad occupancy', () => {
  assert.ok(validateMapping({ boards: { B: goodBoard({ columns: { category: { id: 'b', map: { R: 'retail' } }, area: { id: 'c' } } }) } }).errors.some((e) => /required column "tenantName"/.test(e)));
  assert.ok(validateMapping({ boards: { B: goodBoard({ statusOptional: false, columns: { tenantName: { id: 'a' }, category: { id: 'b', map: { R: 'retail' } }, area: { id: 'c' }, status: { id: 's' } } }) } }).errors.some((e) => /statusMap is empty/.test(e)));
  assert.ok(validateMapping({ boards: { B: goodBoard({ categories: [{ code: 'retail', label: 'R', occupancySource: 'leases' }] }) } }).errors.some((e) => /no valid total GLA source/.test(e)));
  assert.ok(validateMapping({ boards: { B: goodBoard({ apiToken: 'x' }) } }).errors.some((e) => /secret-like key/.test(e)));
  assert.ok(validateMapping({ boards: { B: goodBoard({ categories: [{ code: 'retail', label: 'R', occupancySource: 'bogus', totalArea: 1 }] }) } }).errors.some((e) => /not canonical/.test(e)));
});

// ── SECURITY ──
test('security: logger redacts secrets; config never exposes token; mapping flags secret keys', () => {
  const log = M.createLogger({});
  assert.strictEqual(log.redact({ MONDAY_API_KEY: 'abcdefghijklmnopqrstuvwxyz012345' }).MONDAY_API_KEY, '***redacted***');
  const cfg = M.config.loadConfig({ env: { MONDAY_API_KEY: 'super-secret-token-value-1234567890' } });
  assert.ok(!JSON.stringify(M.config.describeConfig(cfg)).includes('super-secret'));
  assert.ok(!JSON.stringify(cfg).includes('super-secret')); // token is non-enumerable
});
