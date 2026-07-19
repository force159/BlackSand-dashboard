'use strict';
/**
 * PHASE 9.3 — Historical Analytics frontend. Loads the REAL inline functions from
 * Project Dashboard.html into a vm sandbox (same technique as the other frontend tests)
 * and verifies the DISPLAY-only helpers + the controller surface + the overlay markup.
 * These helpers must NEVER compute a business value — they only format, choose a
 * tone/arrow from a backend-provided change, derive a UI state, and validate a snapshot
 * selection. No network, no DB.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'Project Dashboard.html'), 'utf8');
const FULL = HTML.match(/<script(?![^>]*type=["']module["'])(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i)[1];
const DEFS = FULL.slice(0, FULL.indexOf('\n    fitDashboard();'));

function load() {
  const byId = {};
  const makeEl = (tag) => {
    const el = {
      tagName: tag, _text: '', className: '', children: [], _html: '', dataset: {}, _attrs: {}, style: {},
      appendChild(c) { el.children.push(c); return c; }, setAttribute(k, v) { el._attrs[k] = String(v); }, getAttribute(k) { return el._attrs[k] != null ? el._attrs[k] : null; },
      querySelector() { return makeEl('any'); }, querySelectorAll() { return []; }, addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {} }, getContext() { return {}; },
    };
    Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); el.children = []; } });
    Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); el.children = []; } });
    return el;
  };
  const getEl = (id) => (byId[id] || (byId[id] = makeEl('div#' + id)));
  const doc = { createElement: (t) => makeEl(t), createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }), querySelector: () => makeEl('any'), querySelectorAll: () => [], getElementById: getEl, addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { style: {}, dataset: {} }, fonts: null };
  const win = { location: { protocol: 'http:', search: '' }, history: { replaceState() {} }, addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; }, devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080, requestAnimationFrame(cb) { return setTimeout(cb, 0); }, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } };
  const ctx = {
    window: win, document: doc, navigator: { userAgent: 'n', hardwareConcurrency: 8 }, location: win.location, history: win.history, localStorage: win.localStorage,
    URLSearchParams, URL, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    console, Math, Date, JSON, Number, String, Array, Object, Boolean, Map, Set, isNaN, parseInt, parseFloat, isFinite,
    fetch: async () => { throw new Error('x'); }, Chart: undefined, THREE: undefined, requestAnimationFrame: win.requestAnimationFrame,
  };
  win.window = win; ctx.globalThis = ctx; vm.createContext(ctx);
  const EPI = ';globalThis.__H={hFmtNum,hFmtArea,hFmtPct,hDelta,hStateFrom,hValidateComparison,HIST};';
  vm.runInContext(DEFS + EPI, ctx, { filename: 'p93.js' });
  return ctx.__H;
}

// ── formatting (display only) ──
test('formatting: numbers/area/percent + null/NaN → em dash', () => {
  const H = load();
  assert.strictEqual(H.hFmtNum(1234.6), '1,235');
  assert.strictEqual(H.hFmtArea(1000), '1,000 m²');
  assert.strictEqual(H.hFmtPct(46.63), '46.6%');
  for (const bad of [null, undefined, NaN, 'x']) { assert.strictEqual(H.hFmtNum(bad), '—'); assert.strictEqual(H.hFmtArea(bad), '—'); assert.strictEqual(H.hFmtPct(bad), '—'); }
});

// ── hDelta: tone + arrow chosen from a BACKEND change (never computes it) ──
test('hDelta: direction→arrow, higherIsBetter→tone, unavailable when absolute null', () => {
  const H = load();
  const up = H.hDelta({ absolute: 5, percent: 10, direction: 'up' }, true);
  assert.strictEqual(up.gly, '▲'); assert.strictEqual(up.tone, 'good'); assert.ok(up.text.indexOf('+5') === 0 && up.available);
  const upBad = H.hDelta({ absolute: 5, percent: 10, direction: 'up' }, false); // up is bad for vacancy
  assert.strictEqual(upBad.tone, 'bad');
  const down = H.hDelta({ absolute: -3, percent: -6, direction: 'down' }, true);
  assert.strictEqual(down.gly, '▼'); assert.strictEqual(down.tone, 'bad');
  const flat = H.hDelta({ absolute: 0, percent: 0, direction: 'flat' }, true);
  assert.strictEqual(flat.gly, '▬'); assert.strictEqual(flat.tone, 'neutral');
  const na = H.hDelta({ absolute: null, percent: null, direction: 'unknown' }, true);
  assert.strictEqual(na.available, false); assert.strictEqual(na.text, '—'); assert.strictEqual(na.tone, 'neutral');
  const neutralMetric = H.hDelta({ absolute: 10, direction: 'up' }, null); // higherIsBetter null → neutral tone
  assert.strictEqual(neutralMetric.tone, 'neutral');
});

// ── hStateFrom: loading / empty(404) / error / unavailable / ready ──
test('hStateFrom: maps every fetch outcome to a widget state', () => {
  const H = load();
  assert.strictEqual(H.hStateFrom({ loading: true }), 'loading');
  assert.strictEqual(H.hStateFrom({ error: true, httpStatus: 404 }), 'empty');   // valid-but-absent
  assert.strictEqual(H.hStateFrom({ error: true, httpStatus: 500 }), 'error');
  assert.strictEqual(H.hStateFrom({ data: { available: false, reason: 'RENT_NOT_CAPTURED' } }), 'unavailable');
  assert.strictEqual(H.hStateFrom({ data: [] }), 'empty');
  assert.strictEqual(H.hStateFrom({ data: { points: [] } }), 'empty');
  assert.strictEqual(H.hStateFrom({ data: { points: [{ date: '2026-07-10', value: 5 }] } }), 'ready');
  assert.strictEqual(H.hStateFrom({ data: { occupancyPercent: 50 } }), 'ready');
  assert.strictEqual(H.hStateFrom(null), 'loading');
});

// ── hValidateComparison: prevents invalid / future / same-date comparisons ──
test('hValidateComparison: guards the two-snapshot selection', () => {
  const H = load();
  const dates = ['2026-07-10', '2026-07-15', '2026-07-20'];
  assert.strictEqual(H.hValidateComparison('2026-07-10', '2026-07-20', dates).ok, true);
  assert.strictEqual(H.hValidateComparison(null, '2026-07-20', dates).ok, false);          // missing
  assert.strictEqual(H.hValidateComparison('2026-07-20', '2026-07-10', dates).ok, false);  // from>to
  assert.strictEqual(H.hValidateComparison('2026-07-15', '2026-07-15', dates).ok, false);  // same
  assert.strictEqual(H.hValidateComparison('2026-07-10', '2026-12-31', dates).ok, false);  // not a captured snapshot ("future"/invalid)
  const r = H.hValidateComparison('2026-07-10', '2026-12-31', dates);
  assert.ok(/captured snapshots/i.test(r.reason));
});

// ── controller surface (loaded, side-effect-free at import) ──
test('HIST controller exposes the expected read-only surface', () => {
  const H = load();
  assert.ok(H.HIST && typeof H.HIST.wire === 'function' && typeof H.HIST.open === 'function' && typeof H.HIST.close === 'function');
  assert.ok(typeof H.HIST.resizeCharts === 'function' && typeof H.HIST.applyQuality === 'function');
  assert.strictEqual(H.HIST._state.view, 'overview');   // default sub-view
  assert.strictEqual(H.HIST._state.open, false);
});

// ── markup: the overlay, its 6 views, the trigger, and no page-scroll violation ──
test('HTML carries the historical overlay, all six views, and the trigger', () => {
  assert.ok(/id="histOverlay"/.test(HTML) && /class="hist-overlay"/.test(HTML));
  assert.ok(/id="histTrigger"/.test(HTML));
  for (const v of ['overview', 'trends', 'buildings', 'tenants', 'comparison', 'quality']) {
    assert.ok(new RegExp('id="histView-' + v + '"').test(HTML), 'view present: ' + v);
    assert.ok(new RegExp('data-view="' + v + '"').test(HTML), 'nav tab present: ' + v);
  }
  // the body is the ONE internal scroll region (never the page)
  assert.ok(/\.hist-body\s*\{[^}]*overflow-y:\s*auto/.test(HTML));
  // the historical stat/chart cards inherit the subordinate elevation tier
  assert.ok(/\.historical-card\s*\{/.test(HTML) || /,\s*\n\s*\.historical-card\s*\{/.test(HTML));
});
