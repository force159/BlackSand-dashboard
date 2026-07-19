'use strict';
/**
 * Tenant Directory consolidation tests. Loads the REAL inline functions from
 * Project Dashboard.html into a vm sandbox (same technique as dashboard-client.test.js)
 * and tests the pure aggregation/normalization + the secure directory row renderer.
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

// Minimal DOM element that records textContent + children (so we can assert the DOM
// tree the renderer builds, and prove no HTML parsing of tenant names occurs).
function makeEl(tag) {
  const el = {
    tagName: tag, _text: '', className: '', colSpan: 0, children: [], _html: '',
    appendChild(c) { el.children.push(c); return c; },
    querySelector() { return makeEl('any'); }, querySelectorAll() { return []; },
    setAttribute() {}, addEventListener() {}, getContext() { return { canvas: {}, fillRect() {}, clearRect() {}, createLinearGradient() { return { addColorStop() {} }; } }; },
    style: { setProperty() {} },
  };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); el.children = []; } });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); el.children = []; } });
  return el;
}

function loadClient() {
  const tbodies = { retailTable: makeEl('tbody'), officeTable: makeEl('tbody') };
  const doc = {
    createElement: (t) => makeEl(t),
    querySelector: (sel) => { const m = sel.match(/#(\w+)\s+tbody/); if (m && tbodies[m[1]]) return tbodies[m[1]]; return makeEl('any'); },
    getElementById: () => makeEl('any'),
    addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } }, documentElement: { style: {} },
  };
  const win = { location: { protocol: 'http:', search: '' }, history: { replaceState() {} }, addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; }, devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080, requestAnimationFrame(cb) { return setTimeout(cb, 0); } };
  const ctx = { window: win, document: doc, navigator: { userAgent: 'n' }, location: win.location, history: win.history, URLSearchParams, URL, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, console, Math, Date, JSON, Number, String, Array, Object, Boolean, isNaN, parseInt, parseFloat, fetch: async () => { throw new Error('x'); }, Chart: undefined, THREE: undefined, requestAnimationFrame: win.requestAnimationFrame };
  win.window = win; ctx.globalThis = ctx; vm.createContext(ctx);
  const EPILOGUE = ';globalThis.__T={aggregateTenantsForDirectory,normalizeTenantName,displayTenantName,parseTenantArea,tenantMatches,renderTenantTable,__tbodies:null};';
  vm.runInContext(DEFS + EPILOGUE, ctx, { filename: 'dir.js' });
  return { T: ctx.__T, tbodies };
}

const T = loadClient().T;
const agg = T.aggregateTenantsForDirectory;
const areaOf = (rows, name) => rows.find(r => r.name === name).area;

test('1 empty array → empty', () => { const r = agg([]); assert.ok(Array.isArray(r)); assert.strictEqual(r.length, 0); });
test('2 one tenant → one row', () => { const r = agg([{ name: 'A', type: 'Retail', area: 10 }]); assert.strictEqual(r.length, 1); });
test('3-4 exact duplicates merge and sum area', () => {
  const r = agg([{ name: 'Luna Pilates Studio', type: 'Retail', area: 142.66 }, { name: 'Luna Pilates Studio', type: 'Retail', area: 56.45 }]);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].area, 199.11); assert.strictEqual(r[0].unitCount, 2);
});
test('LABOCCA example sums to 140.78 (no float artifact)', () => {
  const r = agg([{ name: 'LABOCCA', type: 'Restaurant', area: 70.47 }, { name: 'LABOCCA', type: 'Restaurant', area: 70.31 }]);
  assert.strictEqual(r[0].area, 140.78);
});
test('5-8 normalization: case / trim / inner whitespace / NFKC', () => {
  const r = agg([{ name: '  Luna   Pilates Studio ', type: 'Retail', area: 1 }, { name: 'LUNA PILATES STUDIO', type: 'Retail', area: 1 }, { name: 'Luna Pilates Studio', type: 'Retail', area: 1 }]);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].area, 3);
  // NFKC: full-width vs ascii equivalence
  const r2 = agg([{ name: 'ＡＢＣ', type: 'Retail', area: 1 }, { name: 'ABC', type: 'Retail', area: 1 }]);
  assert.strictEqual(r2.length, 1);
});
test('9 display name is clean + human-readable', () => {
  assert.strictEqual(agg([{ name: '  luna   pilates ', type: 'Retail', area: 1 }])[0].name, 'luna pilates');
});
test('10-11 different / hyphenated names are NOT merged', () => {
  assert.strictEqual(agg([{ name: 'Al Tamimi', type: 'Retail', area: 1 }, { name: 'Al-Tamimi', type: 'Retail', area: 1 }, { name: 'Al Tamimi Markets', type: 'Retail', area: 1 }]).length, 3);
});
test('14 equal-area distinct records both counted', () => {
  assert.strictEqual(agg([{ name: 'A', type: 'Retail', area: 100 }, { name: 'B', type: 'Retail', area: 100 }]).reduce((s, r) => s + r.area, 0), 200);
});
test('16-17 blank/invalid area do not crash; valid total preserved', () => {
  const r = agg([{ name: 'A', type: 'Retail', area: 100.25 }, { name: 'A', type: 'Retail', area: '' }, { name: 'A', type: 'Retail', area: '120 abc' }, { name: 'A', type: 'Retail', area: NaN }, { name: 'A', type: 'Retail', area: Infinity }]);
  assert.strictEqual(r[0].area, 100.25);
});
test('all-invalid area → null (renders em dash), row kept', () => {
  const r = agg([{ name: 'A', type: 'Retail', area: '' }, { name: 'A', type: 'Retail', area: 'x' }]);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].area, null);
});
test('19-20 type preserved; blank→valid uses valid; conflict → first valid deterministically', () => {
  assert.strictEqual(agg([{ name: 'A', type: '', area: 1 }, { name: 'A', type: 'Retail', area: 1 }])[0].type, 'Retail');
  assert.strictEqual(agg([{ name: 'A', type: 'Restaurant', area: 1 }, { name: 'A', type: 'Cafe', area: 1 }])[0].type, 'Restaurant');
});
test('21-22 input array and objects are NOT mutated', () => {
  const input = [{ name: 'A', type: 'Retail', area: 10 }, { name: 'A', type: 'Retail', area: 20 }];
  const snap = JSON.stringify(input);
  agg(input);
  assert.strictEqual(input.length, 2); assert.strictEqual(JSON.stringify(input), snap);
});
test('23 deterministic (same input → same output; source order preserved)', () => {
  const input = [{ name: 'B', type: 'Retail', area: 1 }, { name: 'A', type: 'Retail', area: 1 }];
  assert.strictEqual(agg(input).map(r => r.name).join(','), 'B,A');
  assert.strictEqual(JSON.stringify(agg(input)), JSON.stringify(agg(input)));
});
test('18 decimal addition displays without float artifact', () => {
  assert.strictEqual(agg([{ name: 'A', type: 'R', area: 0.1 }, { name: 'A', type: 'R', area: 0.2 }])[0].area, 0.3);
});

// ── Secure DOM rendering ──
test('35-37 renderTenantTable uses textContent (no HTML parse), preserves type-pill class', () => {
  const { T: t2, tbodies } = loadClient();
  const evil = '<img src=x onerror=alert(1)>';
  t2.renderTenantTable('retailTable', [{ name: evil, type: 'Retail', area: 199.11 }], '');
  const tb = tbodies.retailTable;
  assert.strictEqual(tb.children.length, 1);
  const tr = tb.children[0];
  assert.strictEqual(tr.children[0].textContent, evil, 'name inserted as TEXT, verbatim');
  assert.strictEqual(tr.children[0].children.length, 0, 'no parsed child elements from the name');
  assert.strictEqual(tr.children[1].children[0].className, 'type-pill');
  assert.strictEqual(tr.children[1].children[0].textContent, 'Retail');
  assert.strictEqual(tr.children[2].textContent, (199.11).toLocaleString());
});
test('34 empty search result → single row, colSpan 3, exact wording', () => {
  const { T: t2, tbodies } = loadClient();
  t2.renderTenantTable('officeTable', [{ name: 'A', type: 'Office', area: 1 }], 'zzzznomatch');
  const tb = tbodies.officeTable;
  assert.strictEqual(tb.children.length, 1);
  assert.strictEqual(tb.children[0].className, 'tenant-empty');
  assert.strictEqual(tb.children[0].children[0].colSpan, 3);
  assert.strictEqual(tb.children[0].children[0].textContent, 'No matching tenants');
});
test('32-33 search matches name / type / total area (raw + formatted); null-area safe', () => {
  assert.strictEqual(T.tenantMatches({ name: 'Luna Pilates', type: 'Retail', area: 199.11 }, 'luna'), true);
  assert.strictEqual(T.tenantMatches({ name: 'Luna Pilates', type: 'Retail', area: 199.11 }, '199.11'), true);
  assert.strictEqual(T.tenantMatches({ name: 'Luna Pilates', type: 'Retail', area: 199.11 }, 'retail'), true);
  assert.strictEqual(T.tenantMatches({ name: 'X', type: 'Retail', area: null }, 'y'), false); // null area, no crash
});
