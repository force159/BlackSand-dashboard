'use strict';
/**
 * BlackSand dashboard — Phase 5 consolidated verification (`npm run verify`).
 *
 * Runs every non-destructive check + test suite in sequence and reports which stage
 * failed. Cross-platform (spawns `node` directly, not shell chaining). It NEVER seeds
 * or mutates business data, never deletes the database, and never requires Monday or
 * extra internet beyond the existing CDN visual testing. Individual command output is
 * shown (not hidden). Exits 0 on success, non-zero with the failing stage name.
 *
 * Prerequisite: a migrated + seeded database (a normal `npm start` auto-seeds an empty
 * DB; otherwise run `npm run db:migrate && npm run db:seed` first).
 */

const cp = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;

// [stage label, script relative to project root]. All are read-only / temp-DB only.
const STAGES = [
  ['db:check         (schema + pragmas)', 'scripts/check-database.js'],
  ['db:seed:check    (seeded DB matches seed module)', 'scripts/check-seeded-database.js'],
  ['db:seed:compare  (metrics reconcile vs frontend)', 'scripts/compare-seed-to-frontend.js'],
  ['api:check        (API contract + no secrets)', 'scripts/check-api.js'],
  ['check            (static project invariants)', 'scripts/check-project.js'],
  ['test:seed        (seed unit + DB tests)', ['--test', 'tests/seed/normalize.test.js', 'tests/seed/data-version.test.js', 'tests/seed/validate.test.js', 'tests/seed/seed-database.test.js']],
  ['test:api         (API route tests, temp DB)', ['--test', 'tests/api/dashboard-api.test.js', 'tests/api/dashboard-api-nodata.test.js']],
  ['test:frontend    (frontend client logic)', ['--test', 'tests/frontend/dashboard-client.test.js', 'tests/frontend/tenant-directory.test.js', 'tests/frontend/phase8-live-data.test.js', 'tests/frontend/quality-controller.test.js']],
  ['test:buildings   (unit→building allocation)', ['--test', 'tests/buildings/building-allocation.test.js', 'tests/buildings/building-integration.test.js']],
  ['test:history     (historical snapshot engine + automation + API)', ['--test', 'tests/history/riyadh-date.test.js', 'tests/history/migration.test.js', 'tests/history/history-engine.test.js', 'tests/history/cli.test.js', 'tests/history/automation.test.js', 'tests/history/history-api.test.js', 'tests/history/corrections.test.js', 'tests/history/analytics.test.js', 'tests/history/analytics-api.test.js', 'tests/history/tenant-analytics.test.js']],
  ['test:monday      (Monday integration foundation, offline)', ['--test', 'tests/monday/units.test.js', 'tests/monday/client.test.js', 'tests/monday/persistence.test.js', 'tests/monday/sync-engine.test.js', 'tests/monday/health.test.js', 'tests/monday/rules.test.js', 'tests/monday/category-source-group.test.js']],
  ['test:monday:integ (seed→Monday cutover, temp DB, offline)', ['--test', 'tests/monday/integration.test.js']],
  ['monday:mapping:check:draft (offline mapping validation)', ['scripts/monday/mapping-check.js', '--allow-placeholders']],
  ['monday:dry-run    (offline pipeline, zero writes)', ['scripts/monday/dry-run.js']],
];

function runStage(label, spec) {
  const args = Array.isArray(spec) ? spec : [spec];
  console.log('\n' + '━'.repeat(70));
  console.log('▶ ' + label);
  console.log('━'.repeat(70));
  const res = cp.spawnSync(NODE, args, { cwd: ROOT, stdio: 'inherit' });
  return res.status === 0;
}

console.log('BlackSand dashboard — Phase 5 verification');
console.log('==========================================');

for (const [label, spec] of STAGES) {
  if (!runStage(label, spec)) {
    console.error('\n✗ VERIFY FAILED at stage: ' + label.split('(')[0].trim());
    process.exit(1);
  }
}

console.log('\n' + '═'.repeat(70));
console.log('✓ VERIFY PASSED — all stages green. SQLite-backed dashboard is stable.');
console.log('═'.repeat(70));
process.exit(0);
