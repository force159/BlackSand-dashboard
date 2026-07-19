'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  normalizeSlug, normalizeCode, parseArea, normalizeDate, prototypeMockDate, normalizeSeedData,
} = require('../../server/seed/normalize-seed-data');

test('slug normalization matches frontend projectSlug', () => {
  assert.strictEqual(normalizeSlug('Business Address'), 'business-address');
  assert.strictEqual(normalizeSlug('Town Center'), 'town-center');
  assert.strictEqual(normalizeSlug('  Multi__Word  Name! '), 'multi-word-name');
});

test('category code normalization', () => {
  assert.strictEqual(normalizeCode('Retail'), 'retail');
  assert.strictEqual(normalizeCode(' Office '), 'office');
  assert.strictEqual(normalizeCode('F&B'), 'f-b');
});

test('area parsing keeps precision and rejects non-finite', () => {
  assert.strictEqual(parseArea(317.71), 317.71);
  assert.strictEqual(parseArea('56.45'), 56.45);
  assert.ok(Number.isNaN(parseArea('nope')));
});

test('date validation accepts ISO date, rejects malformed', () => {
  assert.strictEqual(normalizeDate('2026-05-20'), '2026-05-20');
  assert.strictEqual(normalizeDate('2026-13-40'), null);
  assert.strictEqual(normalizeDate('not-a-date'), null);
  assert.strictEqual(normalizeDate(null), null);
});

test('prototype mock date is deterministic for a fixed anchor', () => {
  const a = prototypeMockDate('Town Center0Al Tamimi', 0, '2026-07-15');
  const b = prototypeMockDate('Town Center0Al Tamimi', 0, '2026-07-15');
  assert.strictEqual(a, b);
  assert.match(a, /^\d{4}-\d{2}-\d{2}$/);
});

test('normalizer preserves duplicate lease rows and assigns unique source keys', () => {
  const raw = {
    source: 'seed', seedVersion: 1, mockDateAnchor: '2026-07-15',
    projects: [{
      slug: 'p', name: 'P', address: 'A',
      categories: [{ code: 'retail', label: 'Retail', totalArea: 100, occupancySource: 'leases', explicitLeasedPct: null }],
      leases: [
        { categoryCode: 'retail', tenantName: 'Dup', tenantType: 'X', area: 10, leaseDate: '2026-01-01' },
        { categoryCode: 'retail', tenantName: 'Dup', tenantType: 'X', area: 20, leaseDate: '2026-02-01' },
      ],
      buildings: [],
    }],
  };
  const n = normalizeSeedData(raw);
  const leases = n.projects[0].leases;
  assert.strictEqual(leases.length, 2, 'duplicate rows preserved');
  assert.notStrictEqual(leases[0].sourceRecordKey, leases[1].sourceRecordKey, 'unique keys');
  assert.strictEqual(leases[0].sourceRecordKey, 'seed:lease:p:retail:001');
  assert.strictEqual(leases[1].sourceRecordKey, 'seed:lease:p:retail:002');
});

test('building total_area is derived as sum of department totals', () => {
  const raw = {
    source: 'seed', seedVersion: 1, mockDateAnchor: '2026-07-15',
    projects: [{
      slug: 'p', name: 'P', address: 'A',
      categories: [{ code: 'retail', label: 'Retail', totalArea: 0, occupancySource: 'leases', explicitLeasedPct: null }],
      leases: [],
      buildings: [{ name: '1', code: '1', sortOrder: 0, departments: [
        { code: 'retail', label: 'Retail', totalArea: 100, leasedArea: 50 },
        { code: 'offices', label: 'Offices', totalArea: 200, leasedArea: 0 },
      ] }],
    }],
  };
  const n = normalizeSeedData(raw);
  assert.strictEqual(n.projects[0].buildings[0].totalArea, 300);
});
