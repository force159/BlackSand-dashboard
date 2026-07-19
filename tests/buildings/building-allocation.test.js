'use strict';
/**
 * PHASE 8 (buildings) — authoritative unit→building mapping + allocation. Pure-function
 * tests (no DB, no network) covering the numbered spec: Town Center first-letter parser,
 * Business Address explicit lookup (incl. C06/C07 exclusion + no last-digit fallback),
 * and the GLA/status/dedup/ordering calculation rules.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const map = require('../../server/buildings/building-mapping');
const { allocateBuildings } = require('../../server/buildings/building-allocation');

const P = map.parseTownCenterBuilding;
const resolve = map.resolveBuildingForUnit;

// ── Town Center parser (1–11) ──
test('1 "(A-GF-R01)" → Building 1', () => assert.strictEqual(P('(A-GF-R01)'), 1));
test('2 "A-GF-R01" (no parens) → Building 1', () => assert.strictEqual(P('A-GF-R01'), 1));
test('3 lowercase "(a-gf-r01)" → Building 1', () => assert.strictEqual(P('(a-gf-r01)'), 1));
test('4 extra whitespace "  (D-FF-09)  " → Building 4', () => assert.strictEqual(P('  (D-FF-09)  '), 4));
test('5 "(D-FF-09)" → Building 4', () => assert.strictEqual(P('(D-FF-09)'), 4));
test('6 "(G-SF-10)" → Building 7', () => assert.strictEqual(P('(G-SF-10)'), 7));
test('7 "(F-GF-01) Outdoor" → Building 6 (suffix does not block detection)', () => assert.strictEqual(P('(F-GF-01) Outdoor'), 6));
test('8 malformed "123" → unassigned (null)', () => assert.strictEqual(P('123'), null));
test('9 blank / null → unassigned (null)', () => { assert.strictEqual(P(''), null); assert.strictEqual(P(null), null); assert.strictEqual(P('   '), null); });
test('10 leading letter outside A–G → unassigned', () => { assert.strictEqual(P('H-FF-01'), null); assert.strictEqual(P('(Z-GF-01)'), null); });
test('11 Town Center parser is NOT used for Business Address', () => {
  // A TC-style code is not in the BA lookup → unassigned (BA never uses the first-letter rule).
  assert.strictEqual(resolve('business-address', '(A-GF-R01)').status, 'unassigned');
  // And the TC parser itself maps it (proving the strategies differ).
  assert.strictEqual(resolve('town-center', '(A-GF-R01)').building, 1);
});

// ── Business Address lookup (12–32) ──
const BA = (u) => map.lookupBusinessAddressBuilding(u);
test('12 S01 → Building 1', () => assert.strictEqual(BA('S01').building, 1));
test('13 D01 → Building 1', () => assert.strictEqual(BA('D01').building, 1));
test('14 D601 → Building 1', () => assert.strictEqual(BA('D601').building, 1));
test('15 R01 → Building 2', () => assert.strictEqual(BA('R01').building, 2));
test('16 C02 → Building 2', () => assert.strictEqual(BA('C02').building, 2));
test('17 D602 → Building 2', () => assert.strictEqual(BA('D602').building, 2));
test('18 R03 → Building 3', () => assert.strictEqual(BA('R03').building, 3));
test('19 C04 → Building 3', () => assert.strictEqual(BA('C04').building, 3));
test('20 D603 → Building 3', () => assert.strictEqual(BA('D603').building, 3));
test('21 R04 → Building 4', () => assert.strictEqual(BA('R04').building, 4));
test('22 C05 → Building 4', () => assert.strictEqual(BA('C05').building, 4));
test('23 D604 → Building 4', () => assert.strictEqual(BA('D604').building, 4));
test('24 R05 → Building 5', () => assert.strictEqual(BA('R05').building, 5));
test('25 R06 → Building 5', () => assert.strictEqual(BA('R06').building, 5));
test('26 C08 → Building 5', () => assert.strictEqual(BA('C08').building, 5));
test('27 C06 → excluded/unassigned', () => { const r = BA('C06'); assert.strictEqual(r.excluded, true); assert.strictEqual(r.building, null); });
test('28 C07 → excluded/unassigned', () => { const r = BA('C07'); assert.strictEqual(r.excluded, true); assert.strictEqual(r.building, null); });
test('29 unknown BA unit → unassigned', () => { const r = BA('Z99'); assert.strictEqual(r.building, null); assert.strictEqual(r.excluded, false); });
test('30 NO last-digit fallback exists (e.g. "X05" is not Building 5)', () => {
  assert.strictEqual(BA('X05').building, null);
  assert.strictEqual(BA('D999').building, null);
});
test('31-32 Business Address never generates Building 6 or 7', () => {
  const { buildings } = allocateBuildings('business-address', [
    { externalId: 'x', unitCode: 'C06', area: 100, categoryCode: 'retail', status: 'active', isActive: 1 },
    { externalId: 'y', unitCode: 'C07', area: 100, categoryCode: 'retail', status: 'active', isActive: 1 },
  ]);
  assert.deepStrictEqual(buildings.map((b) => b.id), ['1', '2', '3', '4', '5']);
  assert.ok(!buildings.some((b) => b.id === '6' || b.id === '7'));
});

// ── Calculation rules (33–47) ──
const leased = (u, cat, area) => ({ externalId: u, unitCode: u, area, categoryCode: cat, status: 'active', isActive: 1 });
const vacant = (u, cat, area) => ({ externalId: u, unitCode: u, area, categoryCode: cat, status: 'terminated', isActive: 0 });

test('33-36 total = leased+vacant; leased only leased; vacant & occupancy correct', () => {
  // Business Address Building 5: R05 (retail, leased 100), C08 (retail, vacant 300).
  const { buildings, diagnostics } = allocateBuildings('business-address', [
    leased('R05', 'retail', 100), vacant('C08', 'retail', 300),
  ]);
  const b5 = buildings.find((b) => b.id === '5');
  assert.strictEqual(b5.departments.retail.total, 400);   // 100 + 300
  assert.strictEqual(b5.departments.retail.leased, 100);  // only leased
  const pb = diagnostics.perBuilding[5];
  assert.strictEqual(pb.total, 400);
  assert.strictEqual(pb.leased, 100);
  assert.strictEqual(pb.vacant, 300);                     // 400 - 100
  assert.strictEqual(pb.occupancyPct, 25);                // 100/400*100
});

test('37 zero total GLA → 0% (no divide-by-zero)', () => {
  const { buildings, diagnostics } = allocateBuildings('business-address', []);
  assert.strictEqual(buildings.length, 5);
  assert.strictEqual(diagnostics.perBuilding[1].occupancyPct, 0);
  assert.strictEqual(diagnostics.perBuilding[1].total, 0);
});

test('38-39 missing/malformed/negative GLA does not crash and is reported', () => {
  const { buildings, diagnostics } = allocateBuildings('business-address', [
    { externalId: 'a', unitCode: 'R05', area: null, categoryCode: 'retail', status: 'active', isActive: 1 },
    { externalId: 'b', unitCode: 'R06', area: 'abc', categoryCode: 'retail', status: 'active', isActive: 1 },
    { externalId: 'c', unitCode: 'C08', area: -5, categoryCode: 'retail', status: 'active', isActive: 1 },
    { externalId: 'd', unitCode: 'R05', area: Infinity, categoryCode: 'retail', status: 'active', isActive: 1 },
  ]);
  assert.strictEqual(diagnostics.missingGLACount, 4);
  assert.strictEqual(buildings.find((b) => b.id === '5').departments.retail.total, 0); // none counted
});

test('40 unknown status is reported; counts toward total but not leased', () => {
  const { buildings, diagnostics } = allocateBuildings('business-address', [
    { externalId: 'a', unitCode: 'R05', area: 100, categoryCode: 'retail', status: 'mystery', isActive: 0 },
  ]);
  assert.strictEqual(diagnostics.unknownStatusCount, 1);
  const b5 = buildings.find((b) => b.id === '5');
  assert.strictEqual(b5.departments.retail.total, 100);
  assert.strictEqual(b5.departments.retail.leased, 0);   // never assumed leased
});

test('41 duplicate stable source IDs do not double count', () => {
  const { buildings, diagnostics } = allocateBuildings('business-address', [
    leased('R05', 'retail', 100), { externalId: 'R05', unitCode: 'R05', area: 100, categoryCode: 'retail', status: 'active', isActive: 1 },
  ]);
  assert.deepStrictEqual(diagnostics.duplicateIds, ['R05']);
  assert.strictEqual(buildings.find((b) => b.id === '5').departments.retail.total, 100); // counted once
});

test('42 Retail and Offices stay separate within a building', () => {
  const { buildings } = allocateBuildings('business-address', [
    leased('C01', 'retail', 50), leased('D102', 'office', 200), // both Building 2
  ]);
  const b2 = buildings.find((b) => b.id === '2');
  assert.strictEqual(b2.departments.retail.total, 50);
  assert.strictEqual(b2.departments.offices.total, 200);
});

test('43 raw input records are not mutated', () => {
  const input = [leased('R05', 'retail', 100)];
  const snap = JSON.stringify(input);
  allocateBuildings('business-address', input);
  assert.strictEqual(JSON.stringify(input), snap);
});

test('44-45 C06/C07 are excluded from building values but reported (not dropped from input)', () => {
  const input = [leased('R05', 'retail', 100), leased('C06', 'retail', 999), leased('C07', 'retail', 999)];
  const { buildings, diagnostics } = allocateBuildings('business-address', input);
  assert.strictEqual(diagnostics.excluded.length, 2);
  const total = buildings.reduce((s, b) => s + b.departments.retail.total + b.departments.offices.total, 0);
  assert.strictEqual(total, 100);                          // C06/C07 contribute nothing
  assert.strictEqual(input.length, 3);                     // input untouched (records preserved)
});

test('46 Town Center produces Buildings 1–7 in order', () => {
  const { buildings } = allocateBuildings('town-center', [leased('(A-GF-01)', 'retail', 10), leased('(G-SF-01)', 'office', 20)]);
  assert.deepStrictEqual(buildings.map((b) => b.id), ['1', '2', '3', '4', '5', '6', '7']);
});
test('47 Business Address produces Buildings 1–5 in order', () => {
  const { buildings } = allocateBuildings('business-address', [leased('S01', 'office', 10)]);
  assert.deepStrictEqual(buildings.map((b) => b.id), ['1', '2', '3', '4', '5']);
});

test('category mismatch (truth-guide vs Monday) is REPORTED, not moved (S01 office)', () => {
  // S01 is Retail in the truth guide but arrives as office from Monday → reported, and
  // still allocated to offices (Monday authoritative), so Building 1 total stays complete.
  const { buildings, diagnostics } = allocateBuildings('business-address', [
    { externalId: 's', unitCode: 'S01', area: 100, categoryCode: 'office', status: 'active', isActive: 1 },
  ]);
  assert.strictEqual(diagnostics.categoryMismatches.length, 1);
  assert.strictEqual(diagnostics.categoryMismatches[0].expected, 'retail');
  assert.strictEqual(diagnostics.categoryMismatches[0].actual, 'office');
  assert.strictEqual(buildings.find((b) => b.id === '1').departments.offices.total, 100);
});
