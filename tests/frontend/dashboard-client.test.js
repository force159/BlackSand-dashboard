'use strict';
/**
 * Phase 4 frontend tests. Loads the REAL inline dashboard client from
 * `Project Dashboard.html` into a Node vm sandbox (stubbed DOM + fetch), slicing the
 * source just before the INIT execution so no auto-bootstrap runs. Heavy render
 * functions are replaced with spies so we can assert render/poll behaviour precisely.
 *
 * No browser automation dependency — this tests the actual shipped client logic.
 */

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'Project Dashboard.html'), 'utf8');

// Extract the single classic <script> (no type=module, no src).
const scriptMatch = HTML.match(/<script(?![^>]*type=["']module["'])(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/i);
if (!scriptMatch) throw new Error('could not find classic inline script');
const FULL = scriptMatch[1];

// Cut just before the first INIT execution line (`fitDashboard();`) so definitions +
// module-load setup run, but no bootstrap/render executes.
const initIdx = FULL.indexOf('\n    fitDashboard();');
if (initIdx < 0) throw new Error('could not find INIT boundary');
const DEFS = FULL.slice(0, initIdx);

const EPILOGUE = `
;(function () {
  const __calls = { renderProject: 0, renderTabs: 0, renderPerformanceSummary: 0, updateURLForProject: 0, onUserActivity: 0, initThreeVisuals: 0 };
  renderProject = function () { __calls.renderProject++; };
  renderTabs = function () { __calls.renderTabs++; };
  renderPerformanceSummary = function () { __calls.renderPerformanceSummary++; };
  updateURLForProject = function () { __calls.updateURLForProject++; };
  onUserActivity = function () { __calls.onUserActivity++; };
  globalThis.__T = {
    calls: __calls,
    validateDashboardResponse, adaptApiProjectToFrontendProject, isDemoMode,
    fetchDashboardData, applyDashboardPayload, pollOnce, startDashboardPolling, stopDashboardPolling,
    setConnectionState, setLastChecked, dashboardState,
    getProjects: function () { return projects; },
    getCurrentIndex: function () { return currentIndex; },
    POLL_MS: DASHBOARD_POLL_INTERVAL_MS,
    cleanup: function () {
      stopDashboardPolling();
      if (dashboardState.retryTimer) { clearTimeout(dashboardState.retryTimer); dashboardState.retryTimer = null; }
    },
  };
})();
`;

function makeEl() {
  const el = {
    textContent: '', title: '', value: '', innerHTML: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    getContext() { return { canvas: {}, fillRect() {}, clearRect() {}, createLinearGradient() { return { addColorStop() {} }; } }; },
    setProperty() {},
  };
  el.style = { setProperty() {} };
  return el;
}

function buildContext({ protocol = 'http:', search = '', fetchImpl } = {}) {
  const listeners = {};
  const doc = {
    getElementById() { return makeEl(); },
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
    body: { classList: { add() {}, remove() {}, toggle() {} } },
    hidden: false,
    documentElement: { style: {} },
    // no `fonts` → the fonts.ready branch is skipped in INIT (we don't run INIT anyway)
  };
  const win = {
    location: { protocol, search, href: protocol + '//localhost/' + search },
    history: { replaceState() {} },
    addEventListener() {},
    matchMedia() { return { matches: false, addEventListener() {}, addListener() {} }; },
    devicePixelRatio: 1, innerWidth: 1920, innerHeight: 1080,
    requestAnimationFrame(cb) { return setTimeout(cb, 0); },
    cancelAnimationFrame(id) { clearTimeout(id); },
  };
  const ctx = {
    window: win, document: doc, navigator: { userAgent: 'node-test' },
    location: win.location, history: win.history,
    URLSearchParams, URL, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, Math, Date, JSON, Number, String, Array, Object, Boolean, isNaN, parseInt, parseFloat,
    fetch: fetchImpl || (async () => { throw new Error('no fetch'); }),
    Chart: undefined, THREE: undefined,
    requestAnimationFrame: win.requestAnimationFrame,
  };
  win.window = win;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(DEFS + EPILOGUE, ctx, { filename: 'dashboard-client.js' });
  ctx.__listeners = listeners;
  __contexts.push(ctx.__T);
  return { T: ctx.__T, ctx };
}

// Clear any timers (poll intervals / retry timeouts) left by a test so the process
// exits promptly and tests don't leak the self-rescheduling retry chain.
const __contexts = [];
afterEach(() => { __contexts.forEach((t) => { try { t.cleanup(); } catch (_) {} }); __contexts.length = 0; });

// A valid payload builder.
function payload(version, projectsOverride) {
  return {
    data: { projects: projectsOverride || [
      { slug: 'business-address', project: 'Business Address', address: 'Addr A', retail: { label: 'Retail', gla: 1892, tenants: [] }, office: { label: 'Offices', gla: 11267, tenants: [] }, buildings: [], metrics: { totalGLA: 13159 } },
      { slug: 'town-center', project: 'Town Center', address: 'Addr B', retail: { label: 'Commercial', gla: 14850, leasedPct: 0.4, tenants: [] }, office: { label: 'Offices', gla: 9132, leasedPct: 0.69, tenants: [] }, buildings: [], metrics: { totalGLA: 23982 } },
    ] },
    meta: { apiVersion: 1, source: 'sqlite', checkedAt: '2026-07-15T10:02:00.000Z', dataVersion: version, lastSuccessfulSync: '2026-07-15T09:00:00.000Z', lastDataChange: '2026-07-15T08:00:00.000Z' },
  };
}

test('mode detection: file:// → demo, http:// → live, ?mode=demo → demo', () => {
  assert.strictEqual(buildContext({ protocol: 'file:' }).T.isDemoMode(), true);
  assert.strictEqual(buildContext({ protocol: 'http:' }).T.isDemoMode(), false);
  assert.strictEqual(buildContext({ protocol: 'http:', search: '?mode=demo' }).T.isDemoMode(), true);
});

test('validateDashboardResponse accepts valid, rejects malformed/empty', () => {
  const { T } = buildContext();
  assert.strictEqual(T.validateDashboardResponse(payload('v1')), true);
  assert.strictEqual(T.validateDashboardResponse({}), false);
  assert.strictEqual(T.validateDashboardResponse({ data: { projects: [] }, meta: { dataVersion: 'v', checkedAt: '2026-07-15T10:00:00Z' } }), false);
  assert.strictEqual(T.validateDashboardResponse({ data: { projects: [{}] }, meta: { dataVersion: 'v', checkedAt: 'bad' } }), false);
});

test('adapter preserves the frontend shape incl. explicit leasedPct', () => {
  const { T } = buildContext();
  const p = T.adaptApiProjectToFrontendProject(payload('v1').data.projects[1]);
  assert.strictEqual(p.slug, 'town-center');
  assert.strictEqual(p.office.leasedPct, 0.69);
  assert.ok(Array.isArray(p.buildings));
});

test('production poll interval defaults to exactly five minutes', () => {
  assert.strictEqual(buildContext().T.POLL_MS, 5 * 60 * 1000);
});

test('initial load renders, selects requested slug, sets Last Checked', async () => {
  const { T } = buildContext({ search: '?project=town-center', fetchImpl: async () => ({ ok: true, json: async () => payload('v1') }) });
  await T.pollOnce(true);
  assert.strictEqual(T.calls.renderProject, 1);
  assert.strictEqual(T.getCurrentIndex(), 1, 'town-center selected');
  assert.strictEqual(T.dashboardState.mode, 'live');
  assert.strictEqual(T.dashboardState.lastCheckedAt, '2026-07-15T10:02:00.000Z');
});

test('invalid requested slug falls back to first project', async () => {
  const { T } = buildContext({ search: '?project=nope', fetchImpl: async () => ({ ok: true, json: async () => payload('v1') }) });
  await T.pollOnce(true);
  assert.strictEqual(T.getCurrentIndex(), 0);
});

test('unchanged dataVersion poll does NOT re-render but DOES update Last Checked', async () => {
  let v = 'v1';
  const times = ['2026-07-15T10:02:00.000Z', '2026-07-15T10:07:00.000Z'];
  let i = 0;
  const { T } = buildContext({ fetchImpl: async () => ({ ok: true, json: async () => { const pl = payload(v); pl.meta.checkedAt = times[i++]; return pl; } }) });
  await T.pollOnce(true);
  assert.strictEqual(T.calls.renderProject, 1);
  await T.pollOnce(false); // same version
  assert.strictEqual(T.calls.renderProject, 1, 'no re-render on unchanged version');
  assert.strictEqual(T.dashboardState.lastCheckedAt, '2026-07-15T10:07:00.000Z', 'Last Checked advanced');
});

test('changed dataVersion poll re-renders and preserves selected slug', async () => {
  let v = 'v1';
  const { T } = buildContext({ search: '?project=town-center', fetchImpl: async () => ({ ok: true, json: async () => payload(v) }) });
  await T.pollOnce(true);
  assert.strictEqual(T.getCurrentIndex(), 1);
  v = 'v2';
  await T.pollOnce(false);
  assert.strictEqual(T.calls.renderProject, 2, 're-rendered on version change');
  assert.strictEqual(T.getCurrentIndex(), 1, 'town-center still selected');
});

test('failed poll after success → degraded, data + Last Checked preserved', async () => {
  let mode = 'ok';
  const { T } = buildContext({ fetchImpl: async () => { if (mode === 'ok') return { ok: true, json: async () => payload('v1') }; throw new Error('network'); } });
  await T.pollOnce(true);
  const checkedBefore = T.dashboardState.lastCheckedAt;
  mode = 'fail';
  await assert.rejects(() => T.pollOnce(false));
  assert.strictEqual(T.dashboardState.mode, 'degraded');
  assert.strictEqual(T.dashboardState.lastCheckedAt, checkedBefore, 'Last Checked unchanged on failure');
  assert.strictEqual(T.calls.renderProject, 1, 'no re-render on failure');
});

test('initial failure → error state, no data shown', async () => {
  const { T } = buildContext({ fetchImpl: async () => { throw new Error('down'); } });
  await assert.rejects(() => T.pollOnce(true));
  assert.strictEqual(T.dashboardState.mode, 'error');
  assert.strictEqual(T.calls.renderProject, 0, 'never rendered embedded-as-live');
});

test('overlapping poll is skipped (request lock)', async () => {
  let active = 0, maxActive = 0;
  const { T } = buildContext({ fetchImpl: async () => { active++; maxActive = Math.max(maxActive, active); await new Promise((r) => setTimeout(r, 20)); active--; return { ok: true, json: async () => payload('v1') }; } });
  await Promise.all([T.pollOnce(true), T.pollOnce(false)]);
  assert.strictEqual(maxActive, 1, 'no overlapping requests');
});

test('malformed JSON payload is rejected and does not replace data', async () => {
  let mode = 'ok';
  const { T } = buildContext({ fetchImpl: async () => mode === 'ok' ? { ok: true, json: async () => payload('v1') } : { ok: true, json: async () => ({ garbage: true }) } });
  await T.pollOnce(true);
  mode = 'bad';
  await assert.rejects(() => T.pollOnce(false));
  assert.strictEqual(T.dashboardState.mode, 'degraded');
  assert.strictEqual(T.calls.renderProject, 1);
});

test('empty projects payload is treated as invalid (no blanking)', async () => {
  let mode = 'ok';
  const { T } = buildContext({ fetchImpl: async () => mode === 'ok' ? { ok: true, json: async () => payload('v1') } : { ok: true, json: async () => ({ data: { projects: [] }, meta: { dataVersion: 'v2', checkedAt: '2026-07-15T10:10:00Z' } }) } });
  await T.pollOnce(true);
  mode = 'empty';
  await assert.rejects(() => T.pollOnce(false));
  assert.strictEqual(T.getProjects().length, 2, 'existing data preserved');
});

test('polling: only one interval timer exists', () => {
  const { T } = buildContext();
  T.startDashboardPolling();
  const first = T.dashboardState.pollTimer;
  T.startDashboardPolling();
  assert.notStrictEqual(T.dashboardState.pollTimer, null);
  T.stopDashboardPolling();
  assert.strictEqual(T.dashboardState.pollTimer, null);
});
