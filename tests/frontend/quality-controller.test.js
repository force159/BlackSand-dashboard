'use strict';
/**
 * PHASE 8.5 — adaptive quality controller. Loads the REAL inline controller from
 * Project Dashboard.html into a vm sandbox (same technique as the other frontend tests)
 * and verifies mode resolution, the per-mode config, URL override precedence, safe
 * localStorage handling, prefers-reduced-motion, and capability fallbacks. The controller
 * top-block runs once per sandbox, so each scenario builds its own sandbox.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'Project Dashboard.html'), 'utf8');
const FULL = HTML.match(/<script(?![^>]*type=["']module["'])(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i)[1];
const DEFS = FULL.slice(0, FULL.indexOf('\n    fitDashboard();'));

function makeEl(noWebgl) {
  const el = {
    _text: '', className: '', children: [], _attrs: {},
    appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() {},
    setAttribute(k, v) { el._attrs[k] = String(v); }, getAttribute(k) { return el._attrs[k] != null ? el._attrs[k] : null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} },
    getContext(type) {
      if (/webgl/.test(String(type))) return noWebgl ? null : { getParameter() { return ''; } };
      return { canvas: {}, fillRect() {}, clearRect() {}, createLinearGradient() { return { addColorStop() {} }; } };
    },
  };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); el.children = []; } });
  return el;
}

// opts: { search, store, reducedMotion, noWebgl, cores, memory }
// store: undefined | object seed | 'throw' | 'corrupt'
function load(opts) {
  opts = opts || {};
  const docEl = makeEl(opts.noWebgl);
  const doc = {
    documentElement: docEl,
    createElement: () => makeEl(opts.noWebgl),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => makeEl(opts.noWebgl),
    addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} }, appendChild() {} }, hidden: false,
  };
  let ls;
  if (opts.store === 'throw') ls = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  else { const map = new Map(); if (opts.store === 'corrupt') map.set('dashboard-quality-v1', '{not json'); else if (opts.store && typeof opts.store === 'object') map.set('dashboard-quality-v1', JSON.stringify(opts.store)); ls = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) }; }
  const nav = { userAgent: 'test' };
  if (opts.cores !== undefined) nav.hardwareConcurrency = opts.cores;
  if (opts.memory !== undefined) nav.deviceMemory = opts.memory;
  const win = {
    location: { protocol: 'http:', hostname: 'localhost', search: opts.search || '' },
    history: { replaceState() {} }, addEventListener() {}, localStorage: ls, devicePixelRatio: 1,
    matchMedia: (q) => ({ matches: /reduced-motion/.test(q) ? !!opts.reducedMotion : false, addEventListener() {} }),
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  };
  const ctx = {
    window: win, document: doc, navigator: nav, location: win.location, history: win.history, localStorage: ls,
    URLSearchParams, URL, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    console, Math, Date, JSON, Number, String, Array, Object, Boolean, Map, Set, isNaN, parseInt, parseFloat,
    performance: { now: () => 0 }, fetch: async () => { throw new Error('x'); }, Chart: undefined, THREE: undefined,
    requestAnimationFrame: win.requestAnimationFrame,
  };
  win.window = win; ctx.globalThis = ctx; vm.createContext(ctx);
  const EPI = ';globalThis.__Q={qualityConfigFor,getRequestedQualityMode,resolveInitialQuality,detectQualityCapabilities,readQualityPreference,QUALITY_MODES,performanceProfile:performanceProfile,QUALITY:QUALITY,dataQuality:document.documentElement.getAttribute("data-quality"),shouldProbe:performanceProfile.shouldProbe,storedAfterRaw:rawStoredQualityPreference()};';
  vm.runInContext(DEFS + EPI, ctx, { filename: 'q.js' });
  return ctx.__Q;
}

// ── Config shape ──
test('14 qualityConfigFor: full/reduced/static particle counts, PR, chart anim, gates', () => {
  const Q = load();
  const f = Q.qualityConfigFor('full'), r = Q.qualityConfigFor('reduced'), s = Q.qualityConfigFor('static');
  assert.strictEqual(f.particleCols * f.particleRows, 28600);
  assert.strictEqual(r.particleCols * r.particleRows, 10296);
  assert.strictEqual(f.chartAnimMs, 600); assert.strictEqual(r.chartAnimMs, 250); assert.strictEqual(s.chartAnimMs, 0);
  assert.strictEqual(f.waveWebGL, true); assert.strictEqual(s.waveWebGL, false); assert.strictEqual(s.occWebGL, false);
  assert.strictEqual(f.medallionMode, 'webgl'); assert.strictEqual(r.medallionMode, 'dom'); assert.strictEqual(s.medallionMode, 'dom');
  assert.strictEqual(f.panelMotion, true); assert.strictEqual(r.panelMotion, false); assert.strictEqual(s.panelMotion, false);
  assert.ok(f.wavePR >= r.wavePR && r.wavePR >= s.wavePR); // fill cost non-increasing
});

// ── Resolution ──
test('1 default (no params) → requested auto, resolved reduced (conservative start)', () => {
  const Q = load();
  assert.strictEqual(Q.getRequestedQualityMode(), 'auto');
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(Q.QUALITY.mode, 'reduced');
  assert.strictEqual(Q.dataQuality, 'reduced');
});
test('2-4 explicit ?quality resolves exactly', () => {
  assert.strictEqual(load({ search: '?quality=full' }).performanceProfile.resolvedMode, 'full');
  assert.strictEqual(load({ search: '?quality=reduced' }).performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(load({ search: '?quality=static' }).performanceProfile.resolvedMode, 'static');
});
test('5 invalid override falls back to auto', () => {
  const Q = load({ search: '?quality=turbo' });
  assert.strictEqual(Q.getRequestedQualityMode(), 'auto');
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
});
test('6 project + quality params coexist; project preserved', () => {
  const Q = load({ search: '?project=business-address&quality=static' });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(new URLSearchParams('?project=business-address&quality=static').get('project'), 'business-address');
});
test('7 manual URL override takes precedence over stored preference', () => {
  const Q = load({ search: '?quality=static', store: { v: 1, mode: 'full', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(Q.performanceProfile.requested, 'static');
});
test('8 stale non-manual preference falls back to the kiosk default (reduced, no probe)', () => {
  const Q = load({ store: { v: 1, mode: 'full', source: 'startup-benchmark', at: Date.now() - 30 * 24 * 3600 * 1000 } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced'); // Phase 10.1: kiosk default
  assert.strictEqual(Q.shouldProbe, false);                          // no auto-upgrade probe
});

/* ── Phase 8.5 persistence-fix: source-aware resolution (regression fix) ── */
// (2/3) Stored MANUAL is durable → respected, benchmark SKIPPED.
test('persist-fix: stored manual static → respected, no benchmark', () => {
  const Q = load({ store: { v: 1, mode: 'static', source: 'manual', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(Q.performanceProfile.reason, 'manual-preference');
  assert.strictEqual(Q.shouldProbe, false); // manual → benchmark intentionally skipped
});
test('persist-fix: stored manual full → respected, no benchmark', () => {
  const Q = load({ store: { v: 1, mode: 'full', source: 'manual', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'full');
  assert.strictEqual(Q.performanceProfile.reason, 'manual-preference');
  assert.strictEqual(Q.shouldProbe, false);
});
// Phase 10.1 (§6): a stored non-manual STATIC (protective downgrade) is preserved; the auto
// upgrade probe never runs on a kiosk.
test('persist-fix: stored runtime-monitor static → kept static, no probe', () => {
  const Q = load({ store: { v: 1, mode: 'static', source: 'runtime-monitor', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(Q.performanceProfile.reason, 'stored-static-initial');
  assert.strictEqual(Q.shouldProbe, false);
});
// A stored non-manual REDUCED collapses to the kiosk default (reduced), no probe.
test('persist-fix: stored runtime-monitor reduced → kiosk default reduced, no probe', () => {
  const Q = load({ store: { v: 1, mode: 'reduced', source: 'runtime-monitor', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(Q.shouldProbe, false);
});
test('persist-fix: stored probe-poor static → kept static, no probe', () => {
  const Q = load({ store: { v: 1, mode: 'static', source: 'probe-poor', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(Q.shouldProbe, false);
});
// KEY Phase 10.1 change: a stored startup-benchmark 'full' is NOT auto-resurrected on a kiosk.
test('persist-fix: stored startup-benchmark full → kiosk default reduced (never auto-full)', () => {
  const Q = load({ store: { v: 1, mode: 'full', source: 'startup-benchmark', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(Q.performanceProfile.reason, 'kiosk-default');
  assert.strictEqual(Q.shouldProbe, false);
});
// Legacy entry (no source): static preserved, no probe.
test('persist-fix: legacy stored static (no source) → kept static, no probe', () => {
  const Q = load({ store: { v: 1, mode: 'static', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(Q.shouldProbe, false);
});
// Auto never runs the upgrade probe (kiosk default); static is preserved, manual respected.
test('persist-fix: auto never probes; static preserved, manual respected', () => {
  for (const src of ['runtime-monitor', 'probe-poor', 'context-loss', 'startup-benchmark', undefined]) {
    const Q = load({ store: { v: 1, mode: 'static', source: src, at: Date.now() } });
    assert.strictEqual(Q.shouldProbe, false, 'source ' + src + ' must not probe (kiosk default)');
    assert.strictEqual(Q.performanceProfile.resolvedMode, 'static', 'stored static preserved');
  }
  const M = load({ store: { v: 1, mode: 'full', source: 'manual', at: Date.now() } });
  assert.strictEqual(M.shouldProbe, false);
  assert.strictEqual(M.performanceProfile.reason, 'manual-preference'); // manual full still honored
});
// A manual URL override is persisted durably as source 'manual'.
test('persist-fix: ?quality=static persists as source manual', () => {
  const Q = load({ search: '?quality=static' });
  const stored = JSON.parse(Q.storedAfterRaw);
  assert.strictEqual(stored.mode, 'static');
  assert.strictEqual(stored.source, 'manual');
});
// Explicit ?quality=auto RESETS a stored preference and returns to the kiosk default.
test('persist-fix: ?quality=auto clears stored preference → kiosk default (reduced, no probe)', () => {
  const Q = load({ search: '?quality=auto', store: { v: 1, mode: 'static', source: 'runtime-monitor', at: Date.now() } });
  assert.strictEqual(Q.storedAfterRaw, null); // stored preference cleared
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(Q.shouldProbe, false);
});
test('9 corrupt localStorage is ignored safely', () => {
  const Q = load({ store: 'corrupt' });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(Q.readQualityPreference(), null);
});
test('10 localStorage failure does not crash', () => {
  const Q = load({ store: 'throw' });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced'); // resolved without throwing
});
test('11 prefers-reduced-motion → reduced (even over a stored full pref)', () => {
  const Q = load({ reducedMotion: true, store: { v: 1, mode: 'full', at: Date.now() } });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
  assert.strictEqual(Q.performanceProfile.reason, 'prefers-reduced-motion');
});
test('12 missing capability APIs → conservative reduced', () => {
  const Q = load({ cores: undefined, memory: undefined });
  assert.strictEqual(Q.performanceProfile.capabilities.cores, null);
  assert.strictEqual(Q.performanceProfile.capabilities.memory, null);
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'reduced');
});
test('13 no WebGL → static', () => {
  const Q = load({ noWebgl: true });
  assert.strictEqual(Q.performanceProfile.capabilities.webgl, false);
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
  assert.strictEqual(Q.performanceProfile.reason, 'no-webgl');
});
test('a requested full with no WebGL degrades to static', () => {
  const Q = load({ search: '?quality=full', noWebgl: true });
  assert.strictEqual(Q.performanceProfile.resolvedMode, 'static');
});
