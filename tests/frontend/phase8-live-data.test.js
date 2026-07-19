'use strict';
/**
 * PHASE 8 — live-data completion + validation (frontend). Loads the REAL inline
 * functions from Project Dashboard.html into a vm sandbox (same technique as
 * tenant-directory.test.js / dashboard-client.test.js) and verifies:
 *   - Top Tenants: normalized identity aggregation + SAFE DOM (untrusted name/logo
 *     never parsed as HTML).
 *   - Occupancy-breakdown by TYPE: blank/missing type → "Unspecified" (never bucketed
 *     into a real type); finite-area guard.
 *   - computeMetrics / sumAreas: no NaN from invalid areas, zero-GLA is divide-safe,
 *     vacancy is clamped ≥ 0, decimals sum without float artifacts.
 *   - Performance Summary: live mode → safe "unavailable" state; demo mode → the mock.
 * No network, no DB.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'Project Dashboard.html'), 'utf8');
const FULL = HTML.match(/<script(?![^>]*type=["']module["'])(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i)[1];
const DEFS = FULL.slice(0, FULL.indexOf('\n    fitDashboard();'));

function makeEl(tag) {
  const el = {
    tagName: tag, _text: '', className: '', colSpan: 0, children: [], _html: '', dataset: {}, _attrs: {},
    appendChild(c) { el.children.push(c); return c; },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k] != null ? el._attrs[k] : null; },
    querySelector() { return makeEl('any'); }, querySelectorAll() { return []; },
    addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
    getContext() { return { canvas: {}, fillRect() {}, clearRect() {}, createLinearGradient() { return { addColorStop() {} }; } }; },
    style: { setProperty() {}, width: '', height: '' },
  };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); el.children = []; } });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); el.children = []; } });
  return el;
}

// Recursively find the first descendant whose className contains `cls`.
function findByClass(el, cls) {
  for (const c of (el.children || [])) {
    if (typeof c.className === 'string' && c.className.split(/\s+/).includes(cls)) return c;
    const deep = findByClass(c, cls);
    if (deep) return deep;
  }
  return null;
}
function findAllByClass(el, cls, acc = []) {
  for (const c of (el.children || [])) {
    if (typeof c.className === 'string' && c.className.split(/\s+/).includes(cls)) acc.push(c);
    findAllByClass(c, cls, acc);
  }
  return acc;
}

function loadClient(protocol) {
  const byId = {};
  const getEl = (id) => (byId[id] || (byId[id] = makeEl('div#' + id)));
  const doc = {
    createElement: (t) => makeEl(t),
    querySelector: () => makeEl('any'),
    getElementById: getEl,
    addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { style: {} },
    fonts: null,
  };
  const win = {
    location: { protocol: protocol || 'http:', search: '' }, history: { replaceState() {} },
    addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; },
    devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080, requestAnimationFrame(cb) { return setTimeout(cb, 0); },
  };
  const ctx = {
    window: win, document: doc, navigator: { userAgent: 'n' }, location: win.location, history: win.history,
    URLSearchParams, URL, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    console, Math, Date, JSON, Number, String, Array, Object, Boolean, Map, Set, isNaN, parseInt, parseFloat,
    fetch: async () => { throw new Error('x'); }, Chart: undefined, THREE: undefined, requestAnimationFrame: win.requestAnimationFrame,
  };
  win.window = win; ctx.globalThis = ctx; vm.createContext(ctx);
  const EPILOGUE = ';globalThis.__P={computeMetrics,sumAreas,computeTopTenants,renderTopTenants,leasedAreaByType,renderPerformanceSummary,DASHBOARD_MODE_INITIAL};';
  vm.runInContext(DEFS + EPILOGUE, ctx, { filename: 'p8.js' });
  return { P: ctx.__P, byId };
}

const proj = (retail, office) => ({
  slug: 's', project: 'P', address: 'A',
  retail: { label: 'Retail', gla: 1000, tenants: retail },
  office: { label: 'Offices', gla: 2000, tenants: office },
});

// ── Top Tenants ──
test('Top Tenants: normalized identity combines "Al  Tamimi"/"Al Tamimi"; ranks by area', () => {
  const { P } = loadClient();
  const top = P.computeTopTenants(proj(
    [{ name: 'Al  Tamimi', type: 'Retail', area: 100 }, { name: 'Al Tamimi', type: 'Retail', area: 50 }],
    [{ name: 'Beta', type: 'Office', area: 30 }]
  ));
  assert.strictEqual(top.length, 2);
  assert.strictEqual(top[0].name, 'Al Tamimi');   // clean display name
  assert.strictEqual(top[0].area, 150);           // combined
  assert.strictEqual(top[1].name, 'Beta');
});

test('Top Tenants: distinct names are NOT merged; finite-area guard', () => {
  const { P } = loadClient();
  const top = P.computeTopTenants(proj(
    [{ name: 'A', type: 'R', area: 10 }, { name: 'B', type: 'R', area: 'not-a-number' }],
    []
  ));
  assert.strictEqual(top.length, 2);
  assert.strictEqual(top.find(t => t.name === 'A').area, 10);
  assert.strictEqual(top.find(t => t.name === 'B').area, 0); // invalid area contributes 0, no NaN
});

test('Top Tenants: malicious HTML-like name renders as TEXT; medallion carries only the rank digit (Phase 10)', () => {
  const { P, byId } = loadClient();
  const evil = '<img src=x onerror=alert(1)>';
  P.renderTopTenants(proj([{ name: evil, type: 'R', area: 99, logo: 'logos/evil.png' }], []));
  const grid = byId['topTenantsGrid'];
  const nameEl = findByClass(grid, 'plaque-name');
  assert.ok(nameEl, 'plaque-name rendered');
  assert.strictEqual(nameEl.textContent, evil, 'name inserted verbatim as text');
  assert.strictEqual(nameEl.children.length, 0, 'no child elements parsed from the name');
  // Phase 10: the medallion holds ONLY the rank digit — no logo, no initials.
  const med = findByClass(grid, 'plaque-initials');
  assert.ok(med, 'medallion element rendered');
  assert.strictEqual(med.getAttribute('data-rank'), '1', 'rank digit from list position');
  assert.strictEqual(med.getAttribute('data-logo'), null, 'no tenant logo attribute');
  assert.strictEqual(med.getAttribute('data-initials'), null, 'no initials attribute');
});

// ── Occupancy breakdown by tenant TYPE ──
test('Type breakdown: blank/missing type → "Unspecified", not a real type or asset group', () => {
  const { P } = loadClient();
  const bt = P.leasedAreaByType(proj(
    [{ name: 'A', type: '', area: 40 }, { name: 'B', type: '   ', area: 10 }, { name: 'C', type: 'Shop', area: 100 }],
    [{ name: 'D', type: null, area: 5 }]
  ));
  assert.ok(bt.labels.includes('Unspecified'));
  const idx = bt.labels.indexOf('Unspecified');
  assert.strictEqual(bt.values[idx], 55);        // 40 + 10 + 5
  assert.ok(bt.labels.includes('Shop'));
  assert.ok(!bt.labels.includes('Retail') && !bt.labels.includes('Offices')); // not the asset group
});

test('Type breakdown: Arabic labels survive; sorted largest-first', () => {
  const { P } = loadClient();
  const bt = P.leasedAreaByType(proj(
    [{ name: 'A', type: 'Shop (محل)', area: 10 }],
    [{ name: 'B', type: 'Office (مكتب)', area: 90 }]
  ));
  assert.strictEqual(bt.labels[0], 'Office (مكتب)'); // larger first
  assert.ok(bt.labels.includes('Shop (محل)'));
});

// ── computeMetrics / sumAreas safety ──
test('computeMetrics: invalid areas never produce NaN', () => {
  const { P } = loadClient();
  const m = P.computeMetrics(proj(
    [{ name: 'A', type: 'R', area: 100 }, { name: 'B', type: 'R', area: 'x' }, { name: 'C', type: 'R', area: NaN }],
    [{ name: 'D', type: 'O', area: 200 }]
  ));
  for (const k of ['retailLeased', 'officeLeased', 'totalLeased', 'totalVacant', 'retailPct', 'officePct']) {
    assert.ok(Number.isFinite(k === 'overallLeasedPct' ? Number(m[k]) : m[k]), k + ' finite');
  }
  assert.strictEqual(m.retailLeased, 100);         // only the valid 100 counts
  assert.strictEqual(m.officeLeased, 200);
});

test('computeMetrics: zero GLA is divide-safe (0%, no NaN/Infinity)', () => {
  const { P } = loadClient();
  const p = proj([], []); p.retail.gla = 0; p.office.gla = 0;
  const m = P.computeMetrics(p);
  assert.strictEqual(m.retailPct, 0);
  assert.strictEqual(m.officePct, 0);
  assert.strictEqual(m.overallLeasedPct, '0.0');
  assert.strictEqual(m.totalVacant, 0);
});

test('computeMetrics: vacancy clamps ≥ 0 when leased exceeds GLA', () => {
  const { P } = loadClient();
  const p = proj([{ name: 'A', type: 'R', area: 5000 }], []); // 5000 leased vs 1000 GLA
  const m = P.computeMetrics(p);
  assert.strictEqual(m.totalVacant, 0);            // never negative
  assert.ok(m.retailPct > 100);                    // over-100 surfaced, not hidden
});

test('computeMetrics: decimals sum without float artifacts at display rounding', () => {
  const { P } = loadClient();
  const m = P.computeMetrics(proj([{ name: 'A', type: 'R', area: 70.47 }, { name: 'B', type: 'R', area: 70.31 }], []));
  assert.strictEqual(m.retailLeased, 140.78);
});

// ── Performance Summary: live unavailable vs demo mock ──
test('Performance Summary: LIVE mode shows a safe unavailable state (—), not mock deltas', () => {
  const { P, byId } = loadClient('http:');           // live
  assert.strictEqual(P.DASHBOARD_MODE_INITIAL, 'live');
  P.renderPerformanceSummary();
  const html = byId['perfSummary'].innerHTML;
  assert.ok(html.includes('—'), 'neutral placeholder shown');
  assert.ok(!/\+2\.3|\+14|420/.test(html), 'no mock delta values in live mode');
  assert.ok(html.includes('Overall Occupancy') && html.includes('Leasing Velocity') && html.includes('New Leasing'));
});

test('Performance Summary: DEMO mode still renders the embedded mock deltas', () => {
  const { P, byId } = loadClient('file:');           // demo
  assert.strictEqual(P.DASHBOARD_MODE_INITIAL, 'demo');
  P.renderPerformanceSummary();
  const html = byId['perfSummary'].innerHTML;
  assert.ok(/2\.3/.test(html) && /14/.test(html) && /420/.test(html), 'mock deltas present in demo');
});
