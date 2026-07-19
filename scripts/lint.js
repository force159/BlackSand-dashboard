'use strict';
/**
 * Phase 9.4A — dependency-free lint (syntax gate). Parses every project .js file with the
 * V8 compiler (vm.Script) — no execution, no network, no new dependency. Catches syntax
 * errors before they reach production. A fuller ESLint setup is a documented future option;
 * this guarantees "every source file parses" as part of `npm run lint` / CI.
 *
 * Usage: node scripts/lint.js
 * Exit:  0 = all files parse; 1 = one or more parse errors (listed).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['server', 'scripts', 'config', 'tests'];
const SKIP = new Set(['node_modules', 'data', 'logs', 'coverage', 'tmp', '.git', 'archive']);

function walk(dir, acc) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.isFile() && e.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const files = [];
for (const d of DIRS) walk(path.join(ROOT, d), files);
// also lint root-level entry files
for (const f of ['ecosystem.config.js']) { const p = path.join(ROOT, f); if (fs.existsSync(p)) files.push(p); }

let failed = 0;
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  try { new vm.Script(code, { filename: f }); }
  catch (e) { failed++; console.error(`✗ ${path.relative(ROOT, f)} — ${e.message}`); }
}

if (failed) { console.error(`\nlint: ${failed} file(s) with syntax errors (of ${files.length} checked).`); process.exit(1); }
console.log(`lint: OK — ${files.length} JavaScript files parse cleanly.`);
