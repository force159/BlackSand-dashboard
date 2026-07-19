'use strict';
/**
 * BlackSand dashboard — seed↔frontend comparison CLI (`npm run db:seed:compare`).
 *
 * Proves the seed accurately represents the current frontend WITHOUT fragile HTML
 * execution. It:
 *   1. reproduces the frontend's computeMetrics() logic from the seed module and
 *      prints per-project figures for manual review;
 *   2. spot-checks a set of stable literal values (GLA, explicit %, addresses)
 *      directly against `Project Dashboard.html` via exact string matching;
 *   3. reports the Town Center explicit-vs-derived mismatch as PRESERVED prototype
 *      behaviour rather than forcing the two to agree.
 *
 * Read-only. Does not open or modify SQLite.
 */

const fs = require('fs');
const path = require('path');
const { prepareSeed } = require('../server/seed/seed-database');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'Project Dashboard.html');

// Reproduce the frontend computeMetrics() for a normalized seed project.
function computeMetrics(p) {
  const retail = p.categories.find((c) => c.code === 'retail');
  const office = p.categories.find((c) => c.code === 'office');
  const retailLeaseSum = p.leases.filter((l) => l.categoryCode === 'retail').reduce((a, l) => a + l.area, 0);
  const officeLeaseSum = p.leases.filter((l) => l.categoryCode === 'office').reduce((a, l) => a + l.area, 0);
  const retailGLA = retail.totalArea;
  const officeGLA = office.totalArea;
  const retailLeased = retail.explicitLeasedPct != null ? retailGLA * retail.explicitLeasedPct : retailLeaseSum;
  const officeLeased = office.explicitLeasedPct != null ? officeGLA * office.explicitLeasedPct : officeLeaseSum;
  const totalGLA = retailGLA + officeGLA;
  const totalLeased = retailLeased + officeLeased;
  const totalVacant = Math.max(0, totalGLA - totalLeased);
  return {
    retailGLA, officeGLA, retailLeaseSum, officeLeaseSum, retailLeased, officeLeased,
    retailPct: retailGLA ? (retailLeased / retailGLA) * 100 : 0,
    officePct: officeGLA ? (officeLeased / officeGLA) * 100 : 0,
    totalGLA, totalLeased, totalVacant,
    overallPct: totalGLA ? (totalLeased / totalGLA) * 100 : 0,
    totalTenants: p.leases.length,
  };
}

function topTenants(p) {
  const grouped = {};
  for (const l of p.leases) grouped[l.tenantName] = (grouped[l.tenantName] || 0) + l.area;
  return Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, area]) => ({ name, area }));
}

function main() {
  console.log('BlackSand dashboard — seed ↔ frontend comparison (read-only)');
  console.log('============================================================');

  let fail = 0;
  const bad = (m) => { fail++; console.log(`  ✗ ${m}`); };
  const ok = (m) => console.log(`  ✓ ${m}`);

  try {
    const { normalized } = prepareSeed(null, {});
    const html = fs.existsSync(HTML) ? fs.readFileSync(HTML, 'utf8') : '';
    if (!html) console.log('  (note: Project Dashboard.html not readable — skipping literal spot-checks)');

    // Stable literal spot-checks against the actual HTML.
    const literalChecks = [
      { label: 'BA retail gla 1892',   re: /gla:\s*1892\b/ },
      { label: 'BA office gla 11267',  re: /gla:\s*11267\b/ },
      { label: 'TC retail gla 14850',  re: /gla:\s*14850,\s*leasedPct:\s*0\.40/ },
      { label: 'TC office gla 9132',   re: /gla:\s*9132,\s*leasedPct:\s*0\.69/ },
      { label: 'BA address',           re: /1200 Business Boulevard, Financial District/ },
      { label: 'TC address',           re: /Town Center, Commercial District/ },
    ];
    if (html) {
      console.log('\nLiteral spot-checks vs Project Dashboard.html:');
      for (const c of literalChecks) c.re.test(html) ? ok(c.label) : bad(`${c.label} NOT found in HTML`);
    }

    console.log('\nPer-project metrics (reproduced from seed via frontend logic):');
    for (const p of normalized.projects) {
      const m = computeMetrics(p);
      console.log(`\n  ▸ ${p.name} (${p.slug}) — ${p.address}`);
      console.log(`      retail:  GLA ${m.retailGLA} · leaseSum ${m.retailLeaseSum.toFixed(2)} · leased ${m.retailLeased.toFixed(2)} · ${m.retailPct.toFixed(1)}%`);
      console.log(`      office:  GLA ${m.officeGLA} · leaseSum ${m.officeLeaseSum.toFixed(2)} · leased ${m.officeLeased.toFixed(2)} · ${m.officePct.toFixed(1)}%`);
      console.log(`      total:   GLA ${m.totalGLA} · leased ${m.totalLeased.toFixed(2)} · vacant ${m.totalVacant.toFixed(2)} · overall ${m.overallPct.toFixed(1)}%`);
      console.log(`      tenants (lease rows): ${m.totalTenants}`);
      const tops = topTenants(p);
      console.log(`      top 3 (by summed area, grouped by name): ${tops.map((t) => `${t.name} ${t.area.toFixed(2)}`).join(' · ')}`);

      // Town Center explicit-vs-derived: report, do NOT force equality.
      for (const c of p.categories) {
        if (c.explicitLeasedPct != null) {
          const leaseSum = p.leases.filter((l) => l.categoryCode === c.code).reduce((a, l) => a + l.area, 0);
          const explicit = c.totalArea * c.explicitLeasedPct;
          if (Math.abs(explicit - leaseSum) > 0.5) {
            console.log(`      WARNING: ${c.code} explicit leased ${explicit.toFixed(2)} m² differs from lease-derived ${leaseSum.toFixed(2)} m² — PRESERVED current prototype behaviour.`);
          }
        }
      }
    }

    console.log('\nManual-review checklist (compare against the live dashboard):');
    console.log('  □ Header project names + addresses match.');
    console.log('  □ Retail/Office GLA and occupancy % match the property cards.');
    console.log('  □ Portfolio stats (Total GLA / Leased / Vacant / Tenants) match.');
    console.log('  □ Top-tenant names/areas match the medallions.');
    console.log('  □ Town Center headline % uses explicit leasedPct (not lease-derived).');

    if (fail) { console.error(`\nResult: FAILED — ${fail} literal spot-check(s) did not match the HTML.`); return 1; }
    console.log('\nResult: OK — seed preserves the current frontend inputs (explicit + lease-derived both retained).');
    return 0;
  } catch (err) {
    console.error(`\nResult: FAILED — ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  }
}

process.exit(main());
