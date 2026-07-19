'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSeedData } = require('../../server/seed/normalize-seed-data');
const { computeDataVersion } = require('../../server/seed/data-version');

function baseRaw() {
  return {
    source: 'seed', seedVersion: 1, mockDateAnchor: '2026-07-15',
    projects: [{
      slug: 'p', name: 'P', address: 'A',
      categories: [{ code: 'retail', label: 'Retail', totalArea: 100, occupancySource: 'leases', explicitLeasedPct: null }],
      leases: [
        { categoryCode: 'retail', tenantName: 'A', tenantType: 'X', area: 10, leaseDate: '2026-01-01' },
        { categoryCode: 'retail', tenantName: 'B', tenantType: 'X', area: 20, leaseDate: '2026-02-01' },
      ],
      buildings: [],
    }],
  };
}

test('hash is deterministic across runs', () => {
  const h1 = computeDataVersion(normalizeSeedData(baseRaw()));
  const h2 = computeDataVersion(normalizeSeedData(baseRaw()));
  assert.strictEqual(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('array order does not change the hash when record identities are fixed', () => {
  // Build a normalized structure directly with FIXED sourceRecordKeys, then shuffle
  // the arrays. The canonicalizer sorts by key, so the hash must be identical.
  const mk = (leaseOrder) => ({
    source: 'seed', seedVersion: 1, mockDateAnchor: '2026-07-15',
    projects: [{
      slug: 'p', name: 'P', address: 'A',
      categories: [{ code: 'retail', label: 'Retail', totalArea: 100, occupancySource: 'leases', explicitLeasedPct: null }],
      buildings: [],
      leases: leaseOrder,
    }],
  });
  const l1 = { categoryCode: 'retail', sourceRecordKey: 'seed:lease:p:retail:001', tenantName: 'A', tenantType: 'X', area: 10, leaseDate: '2026-01-01', logoPath: null };
  const l2 = { categoryCode: 'retail', sourceRecordKey: 'seed:lease:p:retail:002', tenantName: 'B', tenantType: 'X', area: 20, leaseDate: '2026-02-01', logoPath: null };
  const h1 = computeDataVersion(mk([l1, l2]));
  const h2 = computeDataVersion(mk([l2, l1]));
  assert.strictEqual(h1, h2, 'canonicalizer sorts by sourceRecordKey → order-independent');
});

test('changing a tenant area changes the hash', () => {
  const before = computeDataVersion(normalizeSeedData(baseRaw()));
  const raw = baseRaw();
  raw.projects[0].leases[0].area = 999;
  const after = computeDataVersion(normalizeSeedData(raw));
  assert.notStrictEqual(before, after);
});

test('changing category total changes the hash', () => {
  const before = computeDataVersion(normalizeSeedData(baseRaw()));
  const raw = baseRaw();
  raw.projects[0].categories[0].totalArea = 12345;
  const after = computeDataVersion(normalizeSeedData(raw));
  assert.notStrictEqual(before, after);
});
