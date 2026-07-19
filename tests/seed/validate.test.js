'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSeedData } = require('../../server/seed/normalize-seed-data');
const { validateSeedData } = require('../../server/seed/validate-seed-data');

function validate(raw) {
  return validateSeedData(normalizeSeedData(raw), { checkLogos: false });
}

function project(overrides = {}) {
  return {
    slug: 'p', name: 'P', address: 'A',
    categories: [{ code: 'retail', label: 'Retail', totalArea: 100, occupancySource: 'leases', explicitLeasedPct: null }],
    leases: [{ categoryCode: 'retail', tenantName: 'A', tenantType: 'X', area: 10, leaseDate: '2026-01-01' }],
    buildings: [],
    ...overrides,
  };
}
function raw(projects) {
  return { source: 'seed', seedVersion: 1, mockDateAnchor: '2026-07-15', projects };
}

test('valid dataset has no errors', () => {
  const r = validate(raw([project()]));
  assert.strictEqual(r.errors.length, 0, r.errors.join('; '));
});

test('duplicate tenant names are allowed (no error)', () => {
  const p = project({ leases: [
    { categoryCode: 'retail', tenantName: 'Same', tenantType: 'X', area: 10, leaseDate: '2026-01-01' },
    { categoryCode: 'retail', tenantName: 'Same', tenantType: 'X', area: 20, leaseDate: '2026-02-01' },
  ] });
  const r = validate(raw([p]));
  assert.strictEqual(r.errors.length, 0);
  assert.ok(r.stats.duplicateTenantNameRows >= 2);
});

test('missing tenant name is an error', () => {
  const p = project({ leases: [{ categoryCode: 'retail', tenantName: '', tenantType: 'X', area: 10 }] });
  assert.ok(validate(raw([p])).errors.some((e) => /empty tenantName/.test(e)));
});

test('negative area is an error', () => {
  const p = project({ leases: [{ categoryCode: 'retail', tenantName: 'A', tenantType: 'X', area: -5 }] });
  assert.ok(validate(raw([p])).errors.some((e) => /negative/.test(e)));
});

test('unknown category reference is an error', () => {
  const p = project({ leases: [{ categoryCode: 'nonexistent', tenantName: 'A', tenantType: 'X', area: 10 }] });
  assert.ok(validate(raw([p])).errors.some((e) => /unknown category/.test(e)));
});

test('duplicate project slug is an error', () => {
  const r = validate(raw([project(), project()]));
  assert.ok(r.errors.some((e) => /duplicate project slug/.test(e)));
});

test('explicit percentage > 1 is an error (percent-vs-fraction)', () => {
  const p = project({ categories: [{ code: 'retail', label: 'R', totalArea: 100, occupancySource: 'explicit_percentage', explicitLeasedPct: 40 }] });
  assert.ok(validate(raw([p])).errors.some((e) => /out of 0\.\.1/.test(e)));
});

test('department leased > total is an error', () => {
  const p = project({ buildings: [{ name: '1', code: '1', sortOrder: 0, departments: [
    { code: 'retail', label: 'R', totalArea: 100, leasedArea: 150 },
  ] }] });
  assert.ok(validate(raw([p])).errors.some((e) => /leasedArea .* > totalArea/.test(e)));
});

test('project with no categories is an error', () => {
  const p = project({ categories: [], leases: [] });
  assert.ok(validate(raw([p])).errors.some((e) => /no categories/.test(e)));
});

test('non-canonical occupancy source is an error', () => {
  const p = project({ categories: [{ code: 'retail', label: 'R', totalArea: 100, occupancySource: 'made-up', explicitLeasedPct: null }] });
  assert.ok(validate(raw([p])).errors.some((e) => /not canonical/.test(e)));
});

test('explicit-vs-derived mismatch is a WARNING, not an error', () => {
  const p = project({
    categories: [{ code: 'retail', label: 'R', totalArea: 1000, occupancySource: 'explicit_percentage', explicitLeasedPct: 0.9 }],
    leases: [{ categoryCode: 'retail', tenantName: 'A', tenantType: 'X', area: 10, leaseDate: '2026-01-01' }],
  });
  const r = validate(raw([p]));
  assert.strictEqual(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => /PRESERVED current prototype behaviour/.test(w)));
});
