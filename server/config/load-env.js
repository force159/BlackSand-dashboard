'use strict';
/**
 * BlackSand dashboard — minimal .env loader (Phase 7). CommonJS, zero dependency.
 *
 * Loads KEY=VALUE lines from a local .env into process.env IF the file exists. It does
 * NOT override variables already present in the environment, so externally injected
 * production/CI variables always take precedence. `.env.example` is never loaded as
 * live config. Missing .env is fine (safe offline mode). Never logs values.
 *
 * Call `loadEnv()` as the FIRST line of any entry point that reads process.env
 * (server + Monday CLIs), before other modules are required.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function parseLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  const eq = t.indexOf('=');
  if (eq < 0) return null;
  const key = t.slice(0, eq).trim();
  if (!key) return null;
  let val = t.slice(eq + 1).trim();
  // Strip a single layer of surrounding quotes.
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return { key, val };
}

/**
 * @param {string} [file='.env'] path (relative → project root; absolute honoured)
 * @returns {{ loaded: boolean, added: number, file: string }}
 */
function loadEnv(file) {
  const rel = file || '.env';
  const abs = path.isAbsolute(rel) ? rel : path.resolve(PROJECT_ROOT, rel);
  if (!fs.existsSync(abs)) return { loaded: false, added: 0, file: rel };
  let added = 0;
  for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const kv = parseLine(line);
    if (!kv) continue;
    if (!(kv.key in process.env)) { process.env[kv.key] = kv.val; added++; } // external env wins
  }
  return { loaded: true, added, file: rel };
}

module.exports = { loadEnv, PROJECT_ROOT };
