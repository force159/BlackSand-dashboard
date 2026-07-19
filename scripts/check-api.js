'use strict';
/**
 * BlackSand dashboard — API check CLI (`npm run api:check`).
 *
 * Boots the Express app IN-PROCESS on an ephemeral port (no default-port binding),
 * migrates the DB, then validates that /api/dashboard and /api/sync/status return the
 * contract the frontend depends on (shape, meta fields, no-store headers, 404 for
 * unknown /api paths). Read-only. Requires the DB to be seeded (run `npm run db:seed`).
 */

const { initializeDatabase, closeDatabase } = require('../server/db/connection');
const { runMigrations } = require('../server/db/migrations');
const { app } = require('../server/server');

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };
const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };

const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /\d{4}-\d{2}-\d{2}T/.test(s);
const isNonEmptyStr = (s) => typeof s === 'string' && s.length > 0;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

async function main() {
  console.log('BlackSand dashboard — API check');
  console.log('===============================');

  const db = initializeDatabase();
  runMigrations(db);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // ── /api/dashboard ──
    const res = await fetch(`${base}/api/dashboard`, { headers: { Accept: 'application/json' } });
    (res.headers.get('cache-control') || '').includes('no-store') ? ok('/api/dashboard sets Cache-Control: no-store') : bad('/api/dashboard missing no-store');
    (res.headers.get('content-type') || '').includes('application/json') ? ok('/api/dashboard is JSON') : bad('/api/dashboard not JSON');

    if (res.status === 503) {
      bad('/api/dashboard returned 503 (no data) — run `npm run db:seed` before api:check');
    } else if (res.status !== 200) {
      bad(`/api/dashboard unexpected status ${res.status}`);
    } else {
      ok('/api/dashboard returns 200');
      const body = await res.json();
      Array.isArray(body.data && body.data.projects) && body.data.projects.length > 0
        ? ok(`data.projects is a non-empty array (${body.data.projects.length})`)
        : bad('data.projects missing/empty');

      const m = body.meta || {};
      isNonEmptyStr(m.dataVersion) ? ok('meta.dataVersion is a non-empty string') : bad('meta.dataVersion invalid');
      isIso(m.checkedAt) ? ok('meta.checkedAt is a valid ISO timestamp') : bad('meta.checkedAt invalid');
      ('lastSuccessfulSync' in m) ? ok('meta.lastSuccessfulSync present') : bad('meta.lastSuccessfulSync missing');
      ('lastDataChange' in m) ? ok('meta.lastDataChange present') : bad('meta.lastDataChange missing');
      (m.source === 'sqlite') ? ok("meta.source is 'sqlite'") : bad(`meta.source is '${m.source}'`);

      let shapeOk = true;
      for (const p of body.data.projects) {
        for (const f of ['slug', 'project', 'address', 'retail', 'office', 'buildings']) {
          if (!(f in p)) { shapeOk = false; bad(`project "${p.slug || '?'}" missing field ${f}`); }
        }
        if (!Array.isArray(p.buildings)) { shapeOk = false; bad(`project "${p.slug}" buildings not an array`); }
        for (const cat of ['retail', 'office']) {
          if (!p[cat] || !Array.isArray(p[cat].tenants) || !finite(p[cat].gla)) {
            shapeOk = false; bad(`project "${p.slug}" ${cat} category invalid`);
          }
        }
        if (p.metrics && !finite(Number(p.metrics.totalGLA))) { shapeOk = false; bad(`project "${p.slug}" metrics.totalGLA not finite`); }
      }
      if (shapeOk) ok('every project matches the frontend-compatible shape');
    }

    // ── /api/sync/status ──
    const sres = await fetch(`${base}/api/sync/status`, { headers: { Accept: 'application/json' } });
    sres.status === 200 ? ok('/api/sync/status returns 200') : bad(`/api/sync/status status ${sres.status}`);
    (sres.headers.get('cache-control') || '').includes('no-store') ? ok('/api/sync/status sets no-store') : bad('/api/sync/status missing no-store');
    const sbody = await sres.json();
    (sbody.data && 'syncInProgress' in sbody.data) ? ok('sync status includes syncInProgress') : bad('sync status missing syncInProgress');
    (sbody.data && sbody.data.syncInProgress === false) ? ok('syncInProgress is false (no Monday sync yet)') : bad('syncInProgress should be false in Phase 3');

    // ── unknown /api path ──
    const nf = await fetch(`${base}/api/does-not-exist`);
    nf.status === 404 ? ok('unknown /api path returns 404') : bad(`unknown /api path returned ${nf.status}`);

    // ── no secrets / db path leaked ──
    const raw = JSON.stringify(await (await fetch(`${base}/api/dashboard`)).json());
    /dashboard\.db|SQLITE_DB_PATH|[A-Za-z]:\\\\|token/i.test(raw) ? bad('response appears to leak a path/secret') : ok('no db path/secret leaked in response');

    console.log(`\nResult: ${pass} passed, ${fail} failed`);
    return fail ? 1 : 0;
  } catch (err) {
    console.error(`\nResult: FAILED — ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  } finally {
    await new Promise((r) => server.close(r));
    try { closeDatabase(); } catch (_) {}
    // Close fetch's keep-alive pool so the event loop drains cleanly instead of
    // racing libuv teardown on a forced exit (avoids a Windows async-handle assert).
    try { await globalThis[Symbol.for('undici.globalDispatcher.1')]?.close(); } catch (_) {}
  }
}

// Set exitCode and let the loop drain naturally — do NOT force process.exit() while
// sockets/handles are still closing.
main().then((code) => { process.exitCode = code; });
