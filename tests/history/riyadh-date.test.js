'use strict';
/** Phase 9.1A — Riyadh business-date utility (deterministic; fixed clocks, no real now). */
const { test } = require('node:test');
const assert = require('node:assert');
const { toRiyadhBusinessDate, captureContext, isValidBusinessDate } = require('../../server/history/riyadh-date');

// Riyadh = UTC+3, no DST.
test('UTC evening maps to the SAME Riyadh date', () => {
  // 2026-07-19T20:00:00Z → 23:00 Riyadh, still the 19th.
  assert.strictEqual(toRiyadhBusinessDate(new Date('2026-07-19T20:00:00Z')), '2026-07-19');
});
test('just BEFORE Riyadh midnight (20:59Z = 23:59 Riyadh) → same day', () => {
  assert.strictEqual(toRiyadhBusinessDate(new Date('2026-07-19T20:59:59Z')), '2026-07-19');
});
test('exactly AT Riyadh midnight (21:00Z = 00:00 Riyadh next day) → next day', () => {
  assert.strictEqual(toRiyadhBusinessDate(new Date('2026-07-19T21:00:00Z')), '2026-07-20');
});
test('just AFTER Riyadh midnight (21:30Z) → next day', () => {
  assert.strictEqual(toRiyadhBusinessDate(new Date('2026-07-19T21:30:00Z')), '2026-07-20');
});
test('UTC date differs from Riyadh date (late-UTC evening)', () => {
  // 22:10Z on the 19th is 01:10 Riyadh on the 20th — UTC says 19, Riyadh says 20.
  const d = new Date('2026-07-19T22:10:00Z');
  assert.strictEqual(d.toISOString().slice(0, 10), '2026-07-19'); // naive UTC slice (WRONG for business date)
  assert.strictEqual(toRiyadhBusinessDate(d), '2026-07-20');      // correct Riyadh business date
});
test('year boundary: 2026-12-31T21:00:00Z → 2027-01-01 Riyadh', () => {
  assert.strictEqual(toRiyadhBusinessDate(new Date('2026-12-31T21:00:00Z')), '2027-01-01');
});
test('leap day: 2028-02-28T21:00:00Z → 2028-02-29 Riyadh', () => {
  assert.strictEqual(toRiyadhBusinessDate(new Date('2028-02-28T21:00:00Z')), '2028-02-29');
});
test('captureContext returns capturedAtUtc + businessDate + timezone', () => {
  const c = captureContext(new Date('2026-07-19T22:10:00Z'));
  assert.strictEqual(c.capturedAtUtc, '2026-07-19T22:10:00.000Z');
  assert.strictEqual(c.businessDate, '2026-07-20');
  assert.strictEqual(c.timezone, 'Asia/Riyadh');
});
test('invalid date throws', () => {
  assert.throws(() => toRiyadhBusinessDate(new Date('nope')));
});
test('isValidBusinessDate', () => {
  assert.ok(isValidBusinessDate('2026-07-19'));
  assert.ok(isValidBusinessDate('2028-02-29')); // valid leap day
  assert.ok(!isValidBusinessDate('2026-13-01'));
  assert.ok(!isValidBusinessDate('2026-02-30'));
  assert.ok(!isValidBusinessDate('2026-7-9'));
  assert.ok(!isValidBusinessDate(''));
  assert.ok(!isValidBusinessDate(null));
});
