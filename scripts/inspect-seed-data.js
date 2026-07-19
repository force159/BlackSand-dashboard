'use strict';
/**
 * BlackSand dashboard — seed inspection CLI (`npm run db:seed:inspect`).
 *
 * Loads, normalizes and validates the seed data and prints a summary. It does NOT
 * open or mutate SQLite — pure read-only analysis of the seed module.
 */

const { prepareSeed } = require('../server/seed/seed-database');

function derivedPct(leaseSum, total) {
  return total > 0 ? (leaseSum / total) * 100 : 0;
}

function main() {
  console.log('BlackSand dashboard — seed data inspection (no database mutation)');
  console.log('================================================================');

  try {
    const { normalized, validation, dataVersion } = prepareSeed(null, {});
    const s = validation.stats;

    console.log('\nCounts:');
    console.log(`  projects:            ${s.projects}`);
    console.log(`  categories:          ${s.categories}`);
    console.log(`  lease rows:          ${s.leases}`);
    console.log(`  buildings:           ${s.buildings}`);
    console.log(`  building departments:${s.departments}`);
    console.log(`  warnings:            ${validation.warnings.length}`);
    console.log(`  errors:              ${validation.errors.length}`);
    console.log(`  mock-dated leases:   ${s.mockDateLeases}`);
    console.log(`  duplicate-name rows: ${s.duplicateTenantNameRows}`);
    console.log(`  missing logos:       ${s.missingLogos}`);

    console.log('\nProject summaries:');
    for (const p of normalized.projects) {
      console.log(`\n  ▸ ${p.name} (${p.slug}) — ${p.address}`);
      for (const c of p.categories) {
        const leaseSum = p.leases.filter((l) => l.categoryCode === c.code).reduce((a, l) => a + l.area, 0);
        const rows = p.leases.filter((l) => l.categoryCode === c.code).length;
        const explicit = c.explicitLeasedPct != null ? `${(c.explicitLeasedPct * 100).toFixed(1)}% explicit` : 'no explicit %';
        const derived = `${derivedPct(leaseSum, c.totalArea).toFixed(1)}% derived-from-leases`;
        console.log(`      [${c.code}] "${c.label}" total ${c.totalArea} m² · source=${c.occupancySource} · ${explicit} · leaseSum ${leaseSum.toFixed(2)} m² (${rows} rows) · ${derived}`);
      }
      console.log(`      buildings: ${p.buildings.length}, departments: ${p.buildings.reduce((a, b) => a + b.departments.length, 0)}`);
    }

    if (validation.warnings.length) {
      console.log('\nExplicit-vs-derived / prototype warnings:');
      validation.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
    }

    console.log(`\ncanonical dataVersion: ${dataVersion}`);

    if (validation.errors.length) {
      console.error('\nERRORS present — seeding would be blocked:');
      validation.errors.forEach((e) => console.error(`  ✗ ${e}`));
      throw new Error('seed data has blocking errors');
    }

    console.log('\nResult: OK — seed data is valid (no database was opened or modified).');
    return 0;
  } catch (err) {
    console.error(`\nResult: FAILED — ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  }
}

process.exit(main());
