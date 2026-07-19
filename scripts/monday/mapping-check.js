'use strict';
require('../../server/config/load-env').loadEnv();
/**
 * Monday mapping check (`npm run monday:mapping:check` / `:check:draft`).
 *
 * Production mode: requires a real config/monday-mapping.json; placeholder ids are
 * ERRORS. Draft mode (--allow-placeholders): validates the real mapping if present
 * else the committed .example template; placeholders are WARNINGS. Offline, no network,
 * no secrets. Exits 0 on ok, 1 on error.
 */

const fs = require('fs');
const path = require('path');
const { validateMapping } = require('../../server/monday/mapping-validator');

const ROOT = path.resolve(__dirname, '..', '..');
const REAL = path.join(ROOT, 'config', 'monday-mapping.json');
const EXAMPLE = path.join(ROOT, 'config', 'monday-mapping.example.json');
const draft = process.argv.includes('--allow-placeholders') || process.argv.includes('--draft');

function main() {
  console.log(`Monday mapping check (${draft ? 'DRAFT — placeholders allowed' : 'PRODUCTION'})`);
  console.log('='.repeat(52));
  let file = REAL;
  if (!fs.existsSync(REAL)) {
    if (!draft) { console.error('✗ No config/monday-mapping.json. Copy config/monday-mapping.example.json and fill real IDs, or use the draft check.'); return 1; }
    file = EXAMPLE;
    console.log('(no real mapping; validating the committed example template)');
  }
  let mapping;
  try { mapping = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`✗ ${path.relative(ROOT, file)} is not valid JSON: ${e.message}`); return 1; }

  const res = validateMapping(mapping, { allowPlaceholders: draft });
  console.log(`\nFile: ${path.relative(ROOT, file)}`);
  if (res.warnings.length) { console.log(`\nWarnings (${res.warnings.length}):`); res.warnings.forEach((w) => console.log('  ⚠ ' + w)); }
  if (res.errors.length) { console.log(`\nErrors (${res.errors.length}):`); res.errors.forEach((e) => console.log('  ✗ ' + e)); }
  console.log(`\nResult: ${res.ok ? 'OK' : 'FAILED'}`);
  return res.ok ? 0 : 1;
}

process.exit(main());
