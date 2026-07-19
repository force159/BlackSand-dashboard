'use strict';
/**
 * BlackSand dashboard — OPTIONAL local Express host.
 *
 * This does NOT replace the standalone dashboard. `Project Dashboard.html` still opens
 * directly (double-click / file://) exactly as before — that standalone file is the
 * reference implementation. This server only *optionally* serves that same file over
 * HTTP (e.g. so office TVs on the LAN can load it) and adds a /health endpoint plus a
 * place for future backend work (Monday.com). It makes ZERO changes to the frontend.
 *
 * Security: only the dashboard and the assets it actually references are exposed
 * (page-3.svg + /logos) plus the read-only JSON API (/api/dashboard, /api/sync/status).
 * server/, archive/, package.json, CLAUDE.md, .env and .git are NOT served (there is
 * deliberately no root-level static mount).
 *
 * The Express `app` is exported and the server only auto-starts when this file is run
 * directly (`node server/server.js`). That lets api:check and tests drive the same app
 * in-process without binding the default port or touching the shutdown handlers.
 */

// Load .env FIRST (if present) so every module below sees the configuration. This is
// a no-op when .env is absent (safe offline mode) and never overrides externally
// injected environment variables (production/CI precedence). No dependency added.
require('./config/load-env').loadEnv();

const path = require('path');
const os = require('os');
const express = require('express');

// SQLite foundation (Phase 1) + read-only API (Phase 3). The DB is initialised +
// migrated BEFORE the server accepts requests; /ready reports its status. No Monday
// code — the API reads seeded SQLite data only.
const { getDatabaseConfig } = require('./config/database-config');
const { initializeDatabase, closeDatabase } = require('./db/connection');
const { runMigrations } = require('./db/migrations');
const { getDatabaseHealth } = require('./db/database-health');
const { SCHEMA_VERSION } = require('./db/schema');
const projectsRepo = require('./db/repositories/projects-repository');
const { seedDatabase } = require('./seed/seed-database');
const dashboardRoutes = require('./routes/dashboard-routes');
const syncRoutes = require('./routes/sync-routes');
// Phase 9.1B — read-only historical API + automation scheduler.
const historyRoutes = require('./history/history-routes');
const { createSnapshotScheduler } = require('./history/automation/snapshot-scheduler');
const { loadAutomationConfig, describeConfig } = require('./history/automation/automation-config');

// Phase 9.4A — production configuration validation + centralized logging + process safety.
// These are ADDITIVE and only take effect when the server is actually started (startServer);
// importing `app` for in-process tests does not validate/exit, configure file logging, or
// install process handlers.
const productionConfig = require('../config');
const { createLogger, configure: configureLogging } = require('./logger');
const log = createLogger('server');
let APP_VERSION = '0.0.0';
try { APP_VERSION = require('../package.json').version || APP_VERSION; } catch (_) {}

// Shared, read-only server state for the /health endpoint (populated by startServer).
const serverState = { startedAt: Date.now(), scheduler: null, config: null };

// History/scheduler/Monday activity flows through the central logger (source "history").
const historyLogger = createLogger('history');

// Process-level safety net (Part 7). Installed only by startServer(). An unhandled rejection
// is logged but does NOT kill the kiosk host (availability); an uncaught exception is logged
// and the process exits non-zero so PM2 restarts it cleanly (after closing SQLite).
let processHandlersInstalled = false;
function installProcessErrorHandlers() {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { reason: (reason && reason.message) ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException — exiting for a clean restart', { message: err && err.message });
    try { closeDatabase(); } catch (_) { /* ignore */ }
    process.exit(1);
  });
}

const app = express();

// ── Safe headers (Part 13) ───────────────────────────────────────────────────
// Conservative, non-breaking hardening. Deliberately NO Content-Security-Policy: the
// dashboard is a single inline-script document that also loads Chart.js/Three.js/fonts
// from CDNs, and a CSP would break it. These headers add defence without changing behaviour.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-DNS-Prefetch-Control', 'off');
  next();
});

// This file lives in server/ ; the dashboard + assets live one level up (project root).
const ROOT = path.join(__dirname, '..');
const DASHBOARD = path.join(ROOT, 'Project Dashboard.html');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;

// ── Dashboard ──────────────────────────────────────────────────────────────
// The query string (e.g. ?project=town-center) is read entirely client-side by the
// dashboard's own JS, so the same HTML is served for every project. HTML is served
// no-cache so a refreshed kiosk always picks up an updated dashboard.
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(DASHBOARD);
});

// ── Health check (liveness) ──────────────────────────────────────────────────
// "Is the Node process alive?" — deliberately does NOT depend on the database or
// on Monday.com, so it stays green even when data is being (re)configured.
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Liveness stays green regardless of DB/scheduler, but we surface their status + build
  // info for operators (Part 6). Each probe is wrapped so /health itself can never throw.
  let database = 'unknown';
  try { database = getDatabaseHealth(require('./db/connection').getDatabase()).ok ? 'ready' : 'unavailable'; }
  catch (_) { database = 'unavailable'; }
  let scheduler = 'not-running';
  try {
    if (serverState.scheduler) { const s = serverState.scheduler.getStatus(); scheduler = s.schedulerRunning ? 'running' : (s.automationEnabled ? 'idle' : 'disabled'); }
  } catch (_) { scheduler = 'unknown'; }
  res.json({
    status: 'ok',
    service: 'blacksand-dashboard',
    version: APP_VERSION,
    environment: (serverState.config && serverState.config.nodeEnv) || process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime()),
    database,
    scheduler,
    timestamp: new Date().toISOString(),
  });
});

// ── Readiness ─────────────────────────────────────────────────────────────────
// "Is the database open with a current, valid schema?" Returns 503 when not ready.
// The response is intentionally minimal — NO database path, table names, pragma
// details, environment values, or stack traces are exposed.
app.get('/ready', (req, res) => {
  res.set('Cache-Control', 'no-store');
  let health;
  try {
    health = getDatabaseHealth(require('./db/connection').getDatabase());
  } catch (_) {
    health = { ok: false, migrationVersion: 0 };
  }
  // Monday integration status — BOOLEANS ONLY (never a token, board id, or path).
  let monday;
  try {
    let db = null;
    try { db = require('./db/connection').getDatabase(); } catch (_) { /* not initialized */ }
    monday = require('./monday').getMondayHealth(db);
  } catch (_) {
    monday = { syncEnabled: false, configValid: false, environmentLoaded: false, repositoryAvailable: false, sqliteWritable: false, mondayConfigured: false, dryRun: true };
  }
  if (health.ok) {
    return res.json({
      status: 'ready',
      service: 'blacksand-dashboard',
      database: 'ready',
      schemaVersion: health.migrationVersion,
      monday, // booleans only: syncEnabled, configValid, environmentLoaded, repositoryAvailable, sqliteWritable, mondayConfigured, dryRun
      timestamp: new Date().toISOString(),
    });
  }
  return res.status(503).json({
    status: 'not-ready',
    service: 'blacksand-dashboard',
    database: 'unavailable',
    monday,
    timestamp: new Date().toISOString(),
  });
});

// ── Read-only dashboard API (Phase 3) ────────────────────────────────────────
// SQLite-backed JSON. Same-origin, no CORS, no auth, no write routes. Mounted before
// the catch-all so unknown /api/* paths still 404 cleanly.
app.use('/api', dashboardRoutes);
app.use('/api', syncRoutes);
// Read-only historical endpoints (Phase 9.1B). GET-only; no write routes.
app.use('/api', historyRoutes.router);

// ── Only the assets the dashboard actually needs (modest 1h caching) ─────────
app.get('/page-3.svg', (req, res) => {
  // no-cache so an updated brand logo is picked up on the next kiosk refresh (matches how
  // the HTML is served). It's a tiny file; revalidation cost is negligible.
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'page-3.svg'));
});
app.use('/logos', express.static(path.join(ROOT, 'logos'), {
  dotfiles: 'ignore', index: false, maxAge: '1h',
}));

// Favicon: browsers auto-request /favicon.ico; answer 204 so it isn't a console 404.
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Unknown /api/* paths return a JSON 404 (API consumers get JSON, never HTML/text).
// No stack, path, or SQL is exposed.
app.use('/api', (req, res) => res.status(404).json({ error: 'not-found', message: 'Unknown API route.' }));

// ── 404 for everything else — private paths (server/, archive/, package.json,
//    CLAUDE.md, .env, .git, …) have no route, so they return a clean 404. ─────
app.use((req, res) => res.status(404).type('text/plain').send('404 Not Found'));

// ── Startup (only when run directly) ─────────────────────────────────────────
// Open + migrate SQLite BEFORE the server starts listening. If this fails we log a
// clear (secret-free, stack-free) message and exit non-zero — we never begin serving
// on an invalid database. Registers a single graceful-shutdown handler.
function startServer() {
  // Phase 9.4A — validate configuration BEFORE anything else. In production an invalid
  // config prints a clear, secret-free error and exits non-zero (never serves misconfigured).
  const appCfg = productionConfig.loadConfig();               // also bridges alias env vars
  configureLogging({ level: appCfg.logLevel, dir: path.join(ROOT, 'logs'), toFile: true });
  productionConfig.validateConfigOrExit(appCfg, { logger: log });
  serverState.config = appCfg;
  serverState.startedAt = Date.now();
  installProcessErrorHandlers();
  log.info('startup: configuration valid', { version: APP_VERSION, detail: productionConfig.describe(appCfg) });

  try {
    const cfg = getDatabaseConfig();
    const db = initializeDatabase();
    // Database safety (Part 8): the file must be writable (init created it). FK + WAL are
    // already hard-verified in db/connection on open; abort with a clear message otherwise.
    try { require('fs').accessSync(cfg.dbPath, require('fs').constants.W_OK); }
    catch (e) { throw new Error(`database file is not writable (${e.code || e.message})`); }
    const migration = runMigrations(db, () => {}); // concise; details via `npm run db:migrate`
    const health = getDatabaseHealth(db);
    if (!health.ok || health.migrationVersion !== SCHEMA_VERSION) {
      throw new Error('schema is not valid/current after migration');
    }
    console.log(
      `Database ready: ${cfg.displayPath} (schema v${health.migrationVersion}, ` +
      `journal ${health.journalMode}, ${migration.applied.length} migration(s) applied this start)`
    );
    log.info('database ready', { db: cfg.displayPath, schemaVersion: health.migrationVersion, journal: health.journalMode, migrationsApplied: migration.applied.length });

    // Auto-seed the bootstrap data when the database is EMPTY, so a plain `npm start`
    // serves the live SQLite-backed API immediately (otherwise /api/dashboard returns
    // 503 and the dashboard shows "Data unavailable"). Idempotent and source='seed';
    // it only runs when there are zero projects, and never overwrites existing data
    // (a future Monday sync replaces it). A seed failure is logged but non-fatal —
    // the server still starts and the API reports 503 until data exists.
    try {
      if (projectsRepo.countProjects(db) === 0) {
        console.log('Database is empty — seeding bootstrap data (source=\'seed\')…');
        const r = seedDatabase(db, { log: () => {} });
        if (r.ok) console.log(`  ✓ seeded ${r.recordCount} records (dataVersion ${String(r.dataVersion).slice(0, 12)}…)`);
        else console.error(`  ✗ auto-seed did not complete (${r.phase}); API will report no-data until seeded`);
      }
    } catch (seedErr) {
      console.error(`  ✗ auto-seed failed: ${seedErr.message} — start the server anyway`);
    }
  } catch (err) {
    console.error(`FATAL: database initialization failed — ${err.message}`);
    process.exit(1);
  }

  // Historical automation (Phase 9.1B) — created ONLY here (never at module import), so
  // in-process route tests never start timers. Invalid config disables automation but
  // never blocks serving. The read APIs work regardless.
  let scheduler = null;
  try {
    const autoCfg = loadAutomationConfig();
    scheduler = createSnapshotScheduler({ getDb: () => require('./db/connection').getDatabase(), config: autoCfg, logger: historyLogger });
    historyRoutes.setScheduler(scheduler);
    serverState.scheduler = scheduler;
    console.log(`Historical automation: ${describeConfig(autoCfg)}`);
    log.info('historical automation configured', { detail: describeConfig(autoCfg) });
  } catch (e) {
    console.error(`Historical automation config invalid — automation disabled: ${e.message}`);
  }

  const server = app.listen(PORT, HOST, () => {
    // Collect external IPv4 addresses, classifying private-LAN (RFC1918) vs other
    // (VPN / virtual adapters / public) so the banner can highlight the address a TV
    // on the same office network should actually use. VPN/virtual addresses are kept
    // but clearly labelled "other" rather than removed.
    const isPrivateLan = (ip) =>
      /^192\.168\./.test(ip) ||
      /^10\./.test(ip) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
    const addrs = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) addrs.push({ ip: ni.address, iface: name, lan: isPrivateLan(ni.address) });
      }
    }
    addrs.sort((a, b) => (b.lan - a.lan)); // private-LAN addresses first
    const primary = (addrs.find((a) => a.lan) || addrs[0]); // recommended TV address

    const rule = '─'.repeat(64);
    const lines = [];
    lines.push('');
    lines.push(rule);
    lines.push('  BlackSand executive dashboard — Express host is running');
    lines.push(rule);
    lines.push(`  Local:             http://localhost:${PORT}`);
    if (addrs.length) {
      addrs.forEach((a) => {
        const label = a.lan ? 'LAN (private):' : 'Other (VPN/virtual):';
        lines.push(`  ${label.padEnd(18)} http://${a.ip}:${PORT}   [${a.iface}]`);
      });
    } else {
      lines.push('  LAN:               (no external IPv4 interface detected)');
    }
    lines.push(`  Business Address:  http://localhost:${PORT}/?project=business-address`);
    lines.push(`  Town Center:       http://localhost:${PORT}/?project=town-center`);
    lines.push(`  Dashboard API:     http://localhost:${PORT}/api/dashboard`);
    lines.push(`  Health:            http://localhost:${PORT}/health`);
    lines.push(`  Ready:             http://localhost:${PORT}/ready`);
    if (primary) {
      lines.push(rule);
      lines.push(`  For a TV / kiosk on the LAN, use the ${primary.lan ? 'private-LAN' : 'detected'} address:`);
      lines.push(`    http://${primary.ip}:${PORT}/?project=business-address`);
      lines.push(`    http://${primary.ip}:${PORT}/?project=town-center`);
      if (!primary.lan) lines.push('  (no private 192.168.x / 10.x / 172.16-31.x address found — verify this is reachable from the TV)');
    }
    lines.push(rule);
    lines.push('  Standalone still works too: just open "Project Dashboard.html" directly.');
    lines.push(rule);
    lines.push('  Press Ctrl+C to stop.');
    lines.push('');
    console.log(lines.join('\n'));
    log.info('listening', { host: HOST, port: PORT });
  });

  // Start the daily scheduler + fire a conservative (today-only) startup recovery. The
  // shared execution lock serializes recovery vs the first scheduled run, so there is no
  // race. A recovery/scheduler failure is logged and never crashes the server.
  if (scheduler) {
    scheduler.start();
    Promise.resolve().then(() => scheduler.runStartupRecovery()).catch((e) => console.error('[history] startup recovery error: ' + (e && e.message)));
  }

  // ── Graceful shutdown (Ctrl+C / kill) — close HTTP server + DB, then exit ──
  // Single handler for both signals (no duplicate handlers). Closing SQLite lets
  // WAL checkpoint cleanly.
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return; // ignore repeated signals
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down…`);
    log.info('shutdown: signal received', { signal });
    // Stop scheduling new work, then wait (bounded) for any active capture before closing
    // the DB, so a snapshot transaction is never cut off mid-commit (CP7).
    const stopped = scheduler ? Promise.resolve(scheduler.stopAndWait(2500)).catch(() => {}) : Promise.resolve();
    stopped.then(() => server.close(() => {
      try { closeDatabase(); console.log('  SQLite closed.'); } catch (_) { /* ignore */ }
      console.log('  HTTP server closed. Bye.');
      process.exit(0);
    }));
    // Safety net if a connection hangs — still close the DB before exiting.
    setTimeout(() => {
      try { closeDatabase(); } catch (_) { /* ignore */ }
      process.exit(0);
    }, 3000).unref();
  }
  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

  return server;
}

// Auto-start only when executed directly (`node server/server.js` / `npm start`).
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
