'use strict';
/**
 * BlackSand dashboard — project integrity check.
 *
 * Read-only static validation of the standalone dashboard and the optional Express
 * deployment layer. Uses only Node built-ins, so it runs with `npm run check` even
 * before `npm install`. Exits non-zero if any check fails.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const DASHBOARD = path.join(ROOT, 'Project Dashboard.html');

let pass = 0;
let fail = 0;
const ok = (msg) => { pass++; console.log(`  ✓ ${msg}`); };
const bad = (msg) => { fail++; console.log(`  ✗ ${msg}`); };
const section = (t) => console.log(`\n${t}`);

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Mirror of the dashboard's client-side slug logic (§22.1) so we validate the same rule.
function projectSlug(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

console.log('BlackSand dashboard — project check');
console.log('===================================');

// 1) Dashboard exists
section('Dashboard file');
if (exists('Project Dashboard.html')) ok('Project Dashboard.html present');
else { bad('Project Dashboard.html MISSING'); }

let html = '';
try { html = fs.readFileSync(DASHBOARD, 'utf8'); } catch (_) { /* handled above */ }

// 2) Required assets exist
section('Required assets');
['page-3.svg', 'logos/al-tamimi.png', 'logos/tharwah_logo.png'].forEach((a) => {
  exists(a) ? ok(`${a} present`) : bad(`${a} MISSING`);
});

if (html) {
  // 3) Duplicate element IDs
  section('Duplicate element IDs');
  const ids = (html.match(/\bid="([^"]+)"/g) || []).map((m) => m.slice(4, -1));
  const seen = {};
  const dups = [];
  ids.forEach((id) => { seen[id] = (seen[id] || 0) + 1; });
  Object.keys(seen).forEach((id) => { if (seen[id] > 1) dups.push(`${id} (×${seen[id]})`); });
  dups.length ? bad(`duplicate ids: ${dups.join(', ')}`) : ok(`no duplicate ids (${ids.length} ids)`);

  // 4) getElementById targets resolve in markup
  section('getElementById targets');
  const idSet = new Set(ids);
  const targets = [...new Set((html.match(/getElementById\('([^']+)'\)/g) || [])
    .map((m) => m.replace(/getElementById\('/, '').replace(/'\)/, '')))];
  const missing = targets.filter((t) => !idSet.has(t));
  missing.length
    ? bad(`getElementById targets not in markup: ${missing.join(', ')}`)
    : ok(`all ${targets.length} getElementById targets resolve`);

  // 5) Tenant logo paths point to real files
  section('Tenant logo paths');
  const logos = [...new Set((html.match(/logo:\s*'([^']+)'/g) || [])
    .map((m) => m.replace(/logo:\s*'/, '').replace(/'$/, '')))];
  if (!logos.length) ok('no tenant logo paths declared');
  logos.forEach((rel) => exists(rel) ? ok(`logo ${rel} exists`) : bad(`logo ${rel} MISSING`));
  // header logo
  /src="page-3\.svg"/.test(html) ? ok('header logo references page-3.svg') : bad('header logo (page-3.svg) reference not found');

  // 6) Project slug generation
  section('Project slug generation');
  const names = [...new Set((html.match(/project:\s*'([^']+)'/g) || [])
    .map((m) => m.replace(/project:\s*'/, '').replace(/'$/, '')))];
  if (!names.length) bad('no projects found in data');
  const slugs = names.map((n) => ({ name: n, slug: projectSlug(n) }));
  slugs.forEach(({ name, slug }) => {
    slug ? ok(`"${name}" → ${slug}`) : bad(`"${name}" → empty slug`);
  });
  const uniq = new Set(slugs.map((s) => s.slug));
  uniq.size === slugs.length ? ok('all project slugs are unique') : bad('project slugs collide');
} else {
  bad('could not read dashboard HTML — skipping HTML checks');
}

// 7) Express server exists
section('Express deployment layer');
exists('server/server.js') ? ok('server/server.js present') : bad('server/server.js MISSING');

// 8) package.json exists (+ start script)
if (exists('package.json')) {
  ok('package.json present');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    (pkg.scripts && pkg.scripts.start) ? ok(`npm start → ${pkg.scripts.start}`) : bad('package.json has no "start" script');
  } catch (e) { bad('package.json is not valid JSON'); }
} else {
  bad('package.json MISSING');
}

// 9) Server hardening + deployment files
section('Deployment layer');
['.gitignore', '.env.example', 'README.md'].forEach((f) => {
  exists(f) ? ok(`${f} present`) : bad(`${f} MISSING`);
});
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /app\.get\(\s*['"]\/health['"]/.test(srv) ? ok('server exposes GET /health') : bad('server missing GET /health');
  /0\.0\.0\.0/.test(srv) ? ok('server default HOST binds 0.0.0.0') : bad('server does not default-bind 0.0.0.0');
  // A root-level static mount would expose the whole project; only scoped statics are allowed.
  /app\.use\(\s*express\.static/.test(srv)
    ? bad('server has a ROOT express.static mount (would expose private files!)')
    : ok('no root static mount (private files not exposed)');
} catch (e) {
  bad('could not read server/server.js');
}
// .env must never be committed/exposed
exists('.env') && !exists('.gitignore')
  ? bad('.env exists but no .gitignore')
  : ok('.env not present, or protected by .gitignore');

// 10) SQLite foundation (Phase 1) — static checks only; does NOT create the DB.
section('SQLite foundation (Phase 1)');
// Dependency recorded
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  (pkg.dependencies && pkg.dependencies['better-sqlite3'])
    ? ok(`better-sqlite3 in dependencies (${pkg.dependencies['better-sqlite3']})`)
    : bad('better-sqlite3 not in dependencies');
  (pkg.scripts && pkg.scripts['db:migrate']) ? ok('npm run db:migrate present') : bad('missing "db:migrate" script');
  (pkg.scripts && pkg.scripts['db:check']) ? ok('npm run db:check present') : bad('missing "db:check" script');
  // Preserve existing working commands.
  ['start', 'dev', 'check'].forEach((s) =>
    (pkg.scripts && pkg.scripts[s]) ? ok(`npm run ${s} preserved`) : bad(`npm script "${s}" missing`));
} catch (_) { bad('could not read package.json for db checks'); }

// Database modules exist
[
  'server/config/database-config.js',
  'server/db/connection.js',
  'server/db/migrations.js',
  'server/db/schema.js',
  'server/db/database-health.js',
  'scripts/migrate.js',
  'scripts/check-database.js',
].forEach((f) => exists(f) ? ok(`${f} present`) : bad(`${f} MISSING`));

// data/.gitkeep tracked-able
exists('data/.gitkeep') ? ok('data/.gitkeep present') : bad('data/.gitkeep MISSING');

// .gitignore excludes generated DB + WAL/SHM
try {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const needed = ['data/*.db', 'data/*.db-wal', 'data/*.db-shm'];
  const missing = needed.filter((rule) => !gi.includes(rule));
  missing.length ? bad(`.gitignore missing rules: ${missing.join(', ')}`) : ok('.gitignore excludes *.db / *.db-wal / *.db-shm');
  gi.includes('data/backups/') ? ok('.gitignore excludes data/backups/') : bad('.gitignore missing data/backups/');
} catch (_) { bad('could not read .gitignore'); }

// .env.example documents SQLITE_DB_PATH
try {
  const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  /SQLITE_DB_PATH/.test(env) ? ok('.env.example documents SQLITE_DB_PATH') : bad('.env.example missing SQLITE_DB_PATH');
} catch (_) { bad('could not read .env.example'); }

// server exposes GET /ready and does NOT statically serve the database dir
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /app\.get\(\s*['"]\/ready['"]/.test(srv) ? ok('server exposes GET /ready') : bad('server missing GET /ready');
  // No route should serve the data/ directory (would expose the DB file).
  /express\.static\([^)]*['"][^'"]*data[^'"]*['"]/.test(srv) || /sendFile\([^)]*data[\\/]/.test(srv)
    ? bad('server appears to serve the data/ directory (would expose the DB!)')
    : ok('data/ directory is not statically served (DB not exposed over HTTP)');
  // /ready must not leak the DB path.
  /\/ready[\s\S]{0,600}(SQLITE_DB_PATH|dbPath|displayPath)/.test(srv)
    ? bad('/ready appears to reference a database path')
    : ok('/ready does not expose a database path');
} catch (_) { bad('could not read server/server.js for db checks'); }

// A local data/dashboard.db is EXPECTED after `npm run db:migrate` and is gitignored;
// its mere presence is fine. What must not happen is a DB file OUTSIDE data/ (which
// might not be ignored) — flag that only.
exists('dashboard.db')
  ? bad('a database file exists at the project ROOT (dashboard.db) — it belongs under data/ and may not be gitignored')
  : ok('no stray database file at the project root (DB belongs under gitignored data/)');

// 11) Seed layer (Phase 2) — static checks only; never creates/seeds the database.
section('Seed layer (Phase 2)');
[
  'server/seed/current-dashboard-data.js',
  'server/seed/normalize-seed-data.js',
  'server/seed/validate-seed-data.js',
  'server/seed/data-version.js',
  'server/seed/seed-database.js',
  'server/db/repositories/projects-repository.js',
  'server/db/repositories/categories-repository.js',
  'server/db/repositories/buildings-repository.js',
  'server/db/repositories/leases-repository.js',
  'server/db/repositories/building-departments-repository.js',
  'server/db/repositories/sync-runs-repository.js',
  'scripts/seed-database.js',
  'scripts/inspect-seed-data.js',
  'scripts/check-seeded-database.js',
  'scripts/compare-seed-to-frontend.js',
].forEach((f) => exists(f) ? ok(`${f} present`) : bad(`${f} MISSING`));

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ['db:seed', 'db:seed:inspect', 'db:seed:check', 'db:seed:compare'].forEach((s) =>
    (pkg.scripts && pkg.scripts[s]) ? ok(`npm run ${s} present`) : bad(`missing "${s}" script`));
} catch (_) { bad('could not read package.json for seed scripts'); }

// Seed data must declare source 'seed' and must NOT invent Monday/tenant IDs.
try {
  const seed = fs.readFileSync(path.join(ROOT, 'server', 'seed', 'current-dashboard-data.js'), 'utf8');
  /source:\s*'seed'/.test(seed) ? ok("seed data declares source: 'seed'") : bad("seed data does not declare source: 'seed'");
  /mondayId|monday_id|externalId:\s*['"][^'"]+['"]/.test(seed)
    ? bad('seed data appears to contain a fabricated Monday/external id')
    : ok('seed data invents no Monday/external ids');
} catch (_) { bad('could not read seed data module'); }

// No Monday client/API code should exist yet (Monday is deferred).
[
  'server/services/monday-client.js',
  'server/services/monday-mapper.js',
  'server/services/sync-service.js',
  'server/services/scheduler-service.js',
  'server/seed/monday-client.js',
].forEach((p) => {
  if (exists(p)) bad(`unexpected duplicate Monday path present (belongs in server/monday/): ${p}`);
});
// (config/monday-mapping.json is EXPECTED in Phase 7; its gitignore+untracked state is
//  validated in the Monday-hardening section.)
// Scan service/route source for Monday API usage.
let mondayRef = false;
['server/services', 'server/routes'].forEach((dir) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  fs.readdirSync(abs).filter((f) => f.endsWith('.js')).forEach((f) => {
    const src = fs.readFileSync(path.join(abs, f), 'utf8');
    if (/monday\.com|api\.monday|MONDAY_API_TOKEN|graphql/i.test(src)) { mondayRef = true; bad(`Monday API reference in ${dir}/${f}`); }
  });
});
if (!mondayRef) ok('no Monday integration code present (correct — Monday deferred)');

// Seed modules / scripts must not be statically served by Express.
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /express\.static\([^)]*(seed|scripts|db)[^)]*\)/.test(srv)
    ? bad('server appears to statically serve a backend directory (seed/scripts/db)')
    : ok('seed/scripts/db directories are not statically served');
} catch (_) { bad('could not read server/server.js for seed exposure check'); }

// .gitignore covers test DB files.
try {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  gi.includes('data/test-') ? ok('.gitignore excludes data/test-*') : bad('.gitignore missing data/test-*');
} catch (_) { bad('could not read .gitignore for test-db rule'); }

// 12) Read-only API (Phase 3).
section('Read-only API (Phase 3)');
[
  'server/services/dashboard-service.js',
  'server/routes/dashboard-routes.js',
  'server/routes/sync-routes.js',
  'scripts/check-api.js',
].forEach((f) => exists(f) ? ok(`${f} present`) : bad(`${f} MISSING`));
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ['api:check', 'test:api'].forEach((s) => (pkg.scripts && pkg.scripts[s]) ? ok(`npm run ${s} present`) : bad(`missing "${s}" script`));
} catch (_) { bad('could not read package.json for api scripts'); }
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /app\.use\(\s*['"]\/api['"]/.test(srv) ? ok('server mounts /api routes') : bad('server does not mount /api');
  /module\.exports\s*=\s*\{[^}]*app/.test(srv) ? ok('server exports app (in-process testable)') : bad('server does not export app');
  /require\.main === module/.test(srv) ? ok('server auto-starts only when run directly') : bad('server missing require.main guard');
} catch (_) { bad('could not read server/server.js for api checks'); }
// No write routes anywhere in routes/ (read-only API).
try {
  const routeFiles = ['dashboard-routes.js', 'sync-routes.js'];
  let writeFound = false;
  routeFiles.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', f), 'utf8');
    if (/router\.(post|put|patch|delete)\s*\(/i.test(src)) { writeFound = true; bad(`${f} contains a write route`); }
  });
  if (!writeFound) ok('API is read-only (no POST/PUT/PATCH/DELETE routes)');
} catch (_) { bad('could not scan route files for write methods'); }

// 13) Frontend live-data wiring (Phase 4) — static checks over the HTML.
section('Frontend live-data wiring (Phase 4)');
if (html) {
  const check = (re, good, bad_) => (re.test(html) ? ok(good) : bad(bad_));
  check(/fetch\(\s*DASHBOARD_API_URL|['"]\/api\/dashboard['"]/, 'frontend fetches /api/dashboard', 'no /api/dashboard fetch found');
  check(/cache:\s*['"]no-store['"]/, "frontend fetch uses cache: 'no-store'", "frontend fetch missing cache: 'no-store'");
  check(/function\s+isDemoMode|isDemoMode\s*\(/, 'live/demo mode detection exists', 'no mode detection found');
  check(/location\.protocol\s*===\s*['"]file:['"]/, 'demo mode keyed on file:// protocol', 'no file:// mode detection');
  check(/5\s*\*\s*60\s*\*\s*1000/, 'five-minute production poll interval present', 'no five-minute poll interval');
  check(/requestInProgress/, 'overlapping-request guard exists', 'no request lock found');
  check(/currentDataVersion|dataVersion/, 'dataVersion comparison exists', 'no dataVersion handling');
  check(/setLastChecked\(\s*payload\.meta\.checkedAt|meta\.checkedAt/, 'Last Checked uses API meta.checkedAt', 'Last Checked not sourced from API');
  check(/AbortController/, 'fetch uses an AbortController timeout', 'no fetch timeout');
  // The old simulated refresh timer must NOT be scheduled anymore.
  /setInterval\(\s*simulateRefresh/.test(html)
    ? bad('simulated refresh timer is still scheduled (must be disabled in Phase 4)')
    : ok('old simulated refresh timer is not scheduled');
  // Live mode must not fall back to embedded data silently: demo render is gated on demo mode.
  /DASHBOARD_MODE_INITIAL\s*===\s*['"]demo['"]/.test(html)
    ? ok('embedded data render is gated to demo mode (no silent live→demo fallback)')
    : bad('embedded render is not clearly gated to demo mode');
  // No secrets / server internals in the frontend.
  /MONDAY_API_TOKEN|monday\.com\/v2|SQLITE_DB_PATH|better-sqlite3/i.test(html)
    ? bad('frontend HTML references a secret or server internal')
    : ok('frontend exposes no secrets or database internals');
  // No hardcoded server origin / absolute API URL.
  /https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(html)
    ? bad('frontend contains a hardcoded server origin (must be same-origin relative)')
    : ok('frontend uses a same-origin relative API URL (no hardcoded host)');
  // No write API calls from the browser.
  /fetch\([^)]*method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i.test(html)
    ? bad('frontend performs a write API call')
    : ok('frontend performs no write API calls');
  // Charts must be created LAZILY (after fitDashboard + data), not at module load from
  // embedded projects[0] — regression guard for the oversized/embedded-chart bug.
  /function createLeasedAreaChart\(\)/.test(html) && /function createTypeBreakdownChart\(\)/.test(html)
    ? ok('charts are created lazily (createLeasedAreaChart/createTypeBreakdownChart)')
    : bad('charts are not created via lazy factory functions');
  /new Chart\([^)]*projects\[0\]/.test(html)
    ? bad('a chart is created at module load from embedded projects[0]')
    : ok('no chart is created at module load from embedded projects[0]');
  /function resizeDashboardCharts\(\)/.test(html) && /requestAnimationFrame\(resizeDashboardCharts\)/.test(html)
    ? ok('charts are resized after layout settles (resizeDashboardCharts)')
    : bad('no post-layout chart resize');
  // No canvas CSS overrides introduced for charts.
  /#leasedAreaChart\s*\{[^}]*width|#typeBreakdownChart\s*\{[^}]*width/.test(html)
    ? bad('a chart canvas has a CSS width override (may break responsive sizing)')
    : ok('no chart canvas CSS width overrides');
} else {
  bad('could not read dashboard HTML for Phase 4 checks');
}
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  (pkg.scripts && pkg.scripts['test:frontend']) ? ok('npm run test:frontend present') : bad('missing "test:frontend" script');
} catch (_) { bad('could not read package.json for test:frontend'); }

// 14) Phase 5 stabilization invariants.
section('Phase 5 stabilization');
exists('scripts/verify-phase-5.js') ? ok('scripts/verify-phase-5.js present') : bad('scripts/verify-phase-5.js MISSING');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  (pkg.scripts && pkg.scripts.verify) ? ok('npm run verify present') : bad('missing "verify" script');
} catch (_) { bad('could not read package.json for verify'); }
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /app\.use\(\s*['"]\/api['"][^)]*\bjson\(/.test(srv) || /\/api[\s\S]{0,120}res\.status\(404\)\.json/.test(srv)
    ? ok('unknown /api routes return a JSON 404') : bad('no JSON 404 for unknown /api routes');
  /\/favicon\.ico/.test(srv) ? ok('favicon route present (no console 404)') : bad('no favicon route');
  // LAN banner distinguishes private vs other addresses.
  /private|isPrivateLan|VPN\/virtual/.test(srv) ? ok('server banner labels private-LAN vs VPN/virtual addresses') : bad('server banner does not classify LAN addresses');
} catch (_) { bad('could not read server/server.js for Phase 5 checks'); }
if (html) {
  // ?pollMs fast-poll override must be gated to localhost (no public/LAN abuse).
  /isLocalHost|hostname\s*===\s*['"]localhost['"]/.test(html) && /pollMs/.test(html)
    ? ok('?pollMs fast-poll override is gated to localhost only')
    : bad('?pollMs override is not localhost-gated');
}

// 15) Monday integration foundation (Phase 6) — offline; no token/board IDs.
section('Monday integration foundation (Phase 6)');
[
  'server/monday/config.js', 'server/monday/errors.js', 'server/monday/logger.js',
  'server/monday/client.js', 'server/monday/graphql.js', 'server/monday/adapters.js',
  'server/monday/mapper.js', 'server/monday/schema.js', 'server/monday/validator.js',
  'server/monday/transformer.js', 'server/monday/diff-engine.js', 'server/monday/persistence.js',
  'server/monday/sync-engine.js', 'server/monday/index.js',
  'config/monday-mapping.example.json',
].forEach((f) => exists(f) ? ok(`${f} present`) : bad(`${f} MISSING`));
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  (pkg.scripts && pkg.scripts['test:monday']) ? ok('npm run test:monday present') : bad('missing "test:monday" script');
} catch (_) { bad('could not read package.json for test:monday'); }
// The real mapping (with IDs) must be gitignored; the example must NOT contain real IDs.
try {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  gi.includes('config/monday-mapping.json') ? ok('.gitignore excludes config/monday-mapping.json') : bad('.gitignore missing config/monday-mapping.json');
} catch (_) { bad('could not read .gitignore for mapping rule'); }
// The real mapping may exist locally (Phase 7); it MUST be gitignored and untracked.
if (!exists('config/monday-mapping.json')) {
  ok('config/monday-mapping.json absent (template-only) — fine');
} else {
  let ignored = false, tracked = true;
  try { cp.execSync('git check-ignore config/monday-mapping.json', { cwd: ROOT, stdio: 'pipe' }); ignored = true; } catch (_) { ignored = false; }
  try { cp.execSync('git ls-files --error-unmatch config/monday-mapping.json', { cwd: ROOT, stdio: 'pipe' }); tracked = true; } catch (_) { tracked = false; }
  (ignored && !tracked) ? ok('config/monday-mapping.json present locally, gitignored + untracked (correct)')
    : bad('config/monday-mapping.json is present but NOT gitignored/untracked — it must never be committed');
}
// Sync must be OFF by default and the client transport disabled (no network in Phase 6).
try {
  const cfgSrc = fs.readFileSync(path.join(ROOT, 'server', 'monday', 'config.js'), 'utf8');
  /MONDAY_SYNC_ENABLED[\s\S]{0,40}false/.test(cfgSrc) ? ok('sync disabled by default') : bad('sync not disabled by default');
  const cliSrc = fs.readFileSync(path.join(ROOT, 'server', 'monday', 'client.js'), 'utf8');
  /disabledTransport/.test(cliSrc) && /NetworkDisabledError/.test(cliSrc) ? ok('client defaults to a disabled (no-network) transport') : bad('client does not default to a disabled transport');
} catch (_) { bad('could not read Monday config/client for Phase 6 checks'); }
// No hardcoded token/board IDs in the Monday source; no real network URL usage yet.
try {
  const files = fs.readdirSync(path.join(ROOT, 'server', 'monday')).filter((f) => f.endsWith('.js'));
  let leak = false;
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'monday', f), 'utf8');
    // A real-looking Monday token is a long base64/JWT-ish literal; flag any hardcoded assignment.
    if (/MONDAY_API_KEY\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/.test(src)) { leak = true; bad(`hardcoded token literal in monday/${f}`); }
  });
  if (!leak) ok('no hardcoded Monday token/board IDs in server/monday');
} catch (_) { bad('could not scan server/monday for hardcoded secrets'); }
// /ready exposes a monday health block of booleans only.
try {
  const srv = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  /getMondayHealth/.test(srv) ? ok('/ready includes Monday health (booleans only)') : bad('/ready missing Monday health block');
} catch (_) { bad('could not read server.js for Monday health check'); }

// 16) Monday production hardening (Phase 6 hardening).
section('Monday production hardening');
[
  'server/monday/status.js', 'server/monday/safety.js', 'server/monday/transport.js', 'server/monday/mapping-validator.js',
  'scripts/monday/mapping-check.js', 'scripts/monday/inspect-board.js', 'scripts/monday/inspect-sample.js',
  'scripts/monday/dry-run.js', 'scripts/monday/validate-live.js', 'scripts/monday/sync.js', 'scripts/monday/ready.js',
  'config/monday-mapping.example.json',
].forEach((f) => exists(f) ? ok(`${f} present`) : bad(`${f} MISSING`));
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ['monday:mapping:check', 'monday:mapping:check:draft', 'monday:mapping:validate-live', 'monday:inspect-board', 'monday:inspect-sample', 'monday:dry-run', 'monday:sync', 'monday:ready', 'test:monday:integration'].forEach((s) =>
    (pkg.scripts && pkg.scripts[s]) ? ok(`npm run ${s} present`) : bad(`missing "${s}" script`));
} catch (_) { bad('could not read package.json for hardening scripts'); }
// Schema (source ownership migration 003 + unit-code migration 004).
try {
  const sch = fs.readFileSync(path.join(ROOT, 'server', 'db', 'schema.js'), 'utf8');
  const ver = (sch.match(/SCHEMA_VERSION\s*=\s*(\d+)/) || [])[1];
  (Number(ver) >= 4 && /current_data_source/.test(sch) && /unit_code/.test(sch))
    ? ok('schema v4 with current_data_source + unit_code') : bad('schema not at v4 / missing current_data_source or unit_code');
  const mig = fs.readFileSync(path.join(ROOT, 'server', 'db', 'migrations.js'), 'utf8');
  /003_source_ownership/.test(mig) ? ok('migration 003 present (not editing old migrations)') : bad('migration 003 missing');
  /004_add_lease_unit_code/.test(mig) ? ok('migration 004 present (unit_code, additive)') : bad('migration 004 missing');
} catch (_) { bad('could not read schema/migrations for schema check'); }
// Source-aware dashboard queries (no seed+monday double count).
try {
  const svc = fs.readFileSync(path.join(ROOT, 'server', 'services', 'dashboard-service.js'), 'utf8');
  /current_data_source/.test(svc) && /l\.source === authoritativeSource|source === authoritativeSource/.test(svc)
    ? ok('dashboard filters leases by authoritative source (no double-count)') : bad('dashboard not source-aware');
} catch (_) { bad('could not read dashboard-service for source filter'); }
// Persistence: status→is_active, GLA never defaulted to 0, cutover, honest comment.
try {
  const per = fs.readFileSync(path.join(ROOT, 'server', 'monday', 'persistence.js'), 'utf8');
  /setCurrentDataSource/.test(per) ? ok('persistence performs source cutover') : bad('persistence has no cutover');
  /l\.isActive/.test(per) ? ok('lease is_active driven by canonical status') : bad('lease is_active not status-driven');
  /total:\s*c\.totalArea\s*\?\?\s*0/.test(per) ? bad('persistence still defaults category total to 0') : ok('persistence does not default category GLA to 0');
  /NEVER touches source='seed'/.test(per) ? bad('misleading "never touches seed" comment still present') : ok('persistence comment is accurate (no misleading seed claim)');
} catch (_) { bad('could not read persistence for hardening checks'); }
// Client: partial fetch flagged; no auto network.
try {
  const cli = fs.readFileSync(path.join(ROOT, 'server', 'monday', 'client.js'), 'utf8');
  /complete/.test(cli) ? ok('client reports fetch completeness (no deactivate on partial)') : bad('client lacks completeFetch flag');
} catch (_) { bad('could not read client for completeness check'); }
// No hardcoded secrets/token in monday layer or scripts/monday.
try {
  let leak = false;
  for (const dir of ['server/monday', 'scripts/monday']) {
    fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.js')).forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
      if (/MONDAY_API_KEY\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/.test(src)) { leak = true; bad(`hardcoded token in ${dir}/${f}`); }
    });
  }
  if (!leak) ok('no hardcoded Monday token in server/monday or scripts/monday');
} catch (_) { bad('could not scan for hardcoded token'); }

// Summary
console.log('\n===================================');
console.log(`Result: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
