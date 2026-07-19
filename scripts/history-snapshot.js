'use strict';
require('../server/config/load-env').loadEnv();
/**
 * Phase 9.1A — manual historical snapshot CLI (§17). Does NOT start Express, polling, the
 * scheduler, or a Monday sync. Opens the DB, runs the capture orchestrator, prints a
 * concise (or JSON) report, closes the DB, and exits with a meaningful code.
 *
 *   node scripts/history-snapshot.js --dry-run
 *   node scripts/history-snapshot.js --project town-center --dry-run
 *   node scripts/history-snapshot.js --project business-address
 *   node scripts/history-snapshot.js            (write all eligible projects)
 *   node scripts/history-snapshot.js --list     (recent snapshots/runs; read-only)
 *   flags: --json (machine output), --debug (verbose snapshot payload in dry-run)
 *
 * Exit codes: 0 = completed (incl. duplicate skips / dry-run); 1 = validation failure,
 * unexpected failure, or invalid argument.
 */

const { initializeDatabase, closeDatabase } = require('../server/db/connection');
const { runMigrations } = require('../server/db/migrations');
const { captureHistoricalSnapshots } = require('../server/history/capture-orchestrator');
const { runSnapshotAttempt } = require('../server/history/automation/snapshot-runner');
const { loadAutomationConfig } = require('../server/history/automation/automation-config');
const repo = require('../server/history/history-repository');
const { SUPPORTED_PROJECT_KEYS, MODES, TRIGGER_TYPES, ERROR_CODES } = require('../server/history/constants');

function parseArgs(argv) {
  const a = { mode: MODES.WRITE, projects: [], json: false, debug: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.mode = MODES.DRY_RUN;
    else if (t === '--json') a.json = true;
    else if (t === '--debug') a.debug = true;
    else if (t === '--list') a.list = true;
    else if (t === '--project') { a.projects.push(argv[++i]); }
    else if (t.startsWith('--project=')) a.projects.push(t.slice('--project='.length));
    else return { error: 'unknown argument: ' + t };
  }
  for (const p of a.projects) {
    if (SUPPORTED_PROJECT_KEYS.indexOf(p) < 0) return { error: 'unsupported project: ' + p + ' (supported: ' + SUPPORTED_PROJECT_KEYS.join(', ') + ')' };
  }
  return a;
}

const cliLogger = {
  info() {}, warn() {},
  error(evt, ctx) { if (evt) console.error('  ! ' + evt + (ctx ? ' ' + JSON.stringify(ctx) : '')); },
};

function printSummary(summary) {
  console.log('Historical snapshot — ' + summary.mode.toUpperCase());
  console.log('='.repeat(54));
  console.log('run id        : ' + summary.runId);
  console.log('captured at   : ' + summary.capturedAtUtc);
  console.log('business date : ' + summary.businessDate + ' (' + summary.timezone + ')');
  console.log('source        : ' + summary.sourceType + '  dataVersion=' + (summary.sourceDataVersion ? String(summary.sourceDataVersion).slice(0, 16) + '…' : 'none'));
  console.log('sync at       : ' + (summary.sourceSyncedAtUtc || 'n/a'));
  console.log('run status    : ' + summary.status + '  (created ' + summary.created + ', skipped ' + summary.skipped + ')');
  for (const r of summary.results) {
    console.log('\n  ▸ ' + r.projectKey + ' → ' + r.status);
    if (r.eligibility && !r.eligibility.eligible) console.log('      ineligible: ' + r.eligibility.reasons.join('; '));
    if (r.snapshot) {
      const p = r.snapshot.project;
      console.log('      occupancy ' + p.occupancyPercent + '%  leased ' + p.leasedArea + ' / GLA ' + p.totalGla + ' m²');
      console.log('      tenants raw ' + p.tenantCountRaw + ' / aggregated ' + p.tenantCountAggregated + '  buildings ' + r.snapshot.buildings.length);
      console.log('      velocity 90d: ' + p.leasingVelocityArea90d + ' m² / ' + p.leasingVelocityLeaseCount90d + ' leases');
    }
    if (r.validation) {
      console.log('      validation: ' + (r.validation.valid ? 'PASS' : 'FAIL (' + r.validation.errors.length + ' errors)') + ', ' + r.validation.warnings.length + ' warning(s)');
      for (const e of r.validation.errors) console.log('        ✗ ' + e.code + ' @ ' + e.path);
    }
    if (r.snapshotId) console.log('      snapshot id: ' + r.snapshotId);
    if (r.existingSnapshotId) console.log('      existing snapshot: ' + r.existingSnapshotId + ' (not overwritten)');
    if (r.errorMessage) console.log('      error: ' + r.errorMessage);
    if (r.writePerformed === false) console.log('      writePerformed: false');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) { console.error('✗ ' + args.error); return 1; }

  const db = initializeDatabase();
  runMigrations(db); // ensure historical schema exists (safe/idempotent)

  if (args.list) {
    const out = { snapshots: repo.listRecentSnapshots(db, 20), runs: repo.listRecentRuns(db, 20) };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log('Recent snapshots (' + out.snapshots.length + '):');
      out.snapshots.forEach((s) => console.log('  ' + s.business_date + '  ' + s.project_key + '  occ ' + s.occupancy_percent + '%  ' + s.snapshot_id));
      console.log('\nRecent runs (' + out.runs.length + '):');
      out.runs.forEach((r) => console.log('  ' + (r.started_at_utc || '') + '  ' + r.mode + '  ' + r.status + '  created=' + r.snapshot_count_created + ' skipped=' + r.snapshot_count_skipped));
    }
    return 0;
  }

  let summary;
  if (args.mode === MODES.WRITE) {
    // Writes go through the shared execution coordinator (same lock as the scheduler /
    // recovery / post-sync), so a manual run can never overlap an automatic one.
    const attempt = await runSnapshotAttempt({ db, config: loadAutomationConfig(), trigger: TRIGGER_TYPES.MANUAL_CLI, projectKeys: args.projects, logger: cliLogger });
    if (attempt.status === 'skipped') {
      console.log('Skipped: ' + attempt.decisionCode + ' — another snapshot execution holds the lock. Try again shortly.');
      return 0;
    }
    summary = attempt.summary;
  } else {
    // Dry-run is read-only → no lock needed; call the orchestrator directly.
    summary = captureHistoricalSnapshots({ db, projectKeys: args.projects, mode: args.mode, triggerType: TRIGGER_TYPES.MANUAL, logger: cliLogger });
  }

  if (args.json) {
    // Drop bulky per-project snapshot payloads unless --debug (avoid dumping everything).
    const out = args.debug ? summary : { ...summary, results: summary.results.map((r) => ({ ...r, snapshot: undefined })) };
    console.log(JSON.stringify(out, null, 2));
  } else {
    printSummary(summary);
  }

  // Exit code: validation failure or unexpected failure → 1; everything else (incl. duplicate/ineligible) → 0.
  const bad = summary.results.some((r) => r.errorCode === ERROR_CODES.SNAPSHOT_VALIDATION_FAILED || r.errorCode === ERROR_CODES.SNAPSHOT_PERSISTENCE_FAILED);
  return bad ? 1 : 0;
}

main()
  .then((code) => { try { closeDatabase(); } catch (_) {} process.exit(code); })
  .catch((e) => { console.error('✗ history-snapshot failed: ' + (e && e.message ? e.message : e)); try { closeDatabase(); } catch (_) {} process.exit(1); });
