'use strict';
/**
 * Monday health tests — getMondayHealth returns BOOLEANS ONLY and never leaks a token,
 * board id, or path.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const M = require('../../server/monday');

test('getMondayHealth returns booleans only, no secrets/paths', () => {
  const h = M.getMondayHealth(null);
  for (const k of ['syncEnabled', 'configValid', 'environmentLoaded', 'repositoryAvailable', 'mondayConfigured', 'dryRun']) {
    assert.strictEqual(typeof h[k], 'boolean', `${k} must be boolean`);
  }
  const raw = JSON.stringify(h);
  assert.ok(!/token|api[_-]?key|board|dashboard\.db|[A-Za-z]:\\\\|\/Users\//i.test(raw), 'health must not leak secrets/ids/paths');
});

test('default environment is not sync-configured (Phase 6, no token)', () => {
  const h = M.getMondayHealth(null);
  // In the repo default there is no MONDAY_API_KEY, so it must report not configured.
  assert.strictEqual(h.mondayConfigured, false);
  assert.strictEqual(h.syncEnabled, false);
});
