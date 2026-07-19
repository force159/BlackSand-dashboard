'use strict';
/**
 * Monday integration — pure/offline unit tests (config, adapters, mapper, validator,
 * transformer, diff, logger). No network, no database. Fixtures are clearly test-only
 * input, not simulated live API responses.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const M = require('../../server/monday');
const { coerce } = M.adapters;
const { mapDataset, columnIdsForBoard } = M.mapper;

function mapping() {
  return {
    version: 1,
    boards: {
      BID: {
        projectSlug: 'business-address', projectName: 'Business Address', address: 'Addr', itemGrain: 'lease',
        statusOptional: true, // these fixtures do not map a status column
        categories: [{ code: 'retail', label: 'Retail', occupancySource: 'leases', totalArea: 1892 }, { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 11267 }],
        columns: { tenantName: { id: 'cn', type: 'text' }, category: { id: 'cc', type: 'status', map: { Retail: 'retail', Offices: 'office' } }, area: { id: 'ca', type: 'numbers' }, leaseDate: { id: 'cd', type: 'date' } },
      },
    },
  };
}
function rawBoard(items) { return { BID: { id: 'BID', name: 'B', items } }; }
function item(id, cols) { return { id, name: cols.name, column_values: cols.cv }; }

test('config: offline defaults → sync disabled, not configured, no token field leaked', () => {
  const cfg = M.config.loadConfig({ env: {} });
  assert.strictEqual(cfg.syncEnabled, false);
  assert.strictEqual(cfg.hasApiKey, false);
  assert.strictEqual(M.config.isConfigured(cfg), false);
  const desc = M.config.describeConfig(cfg);
  assert.ok(!('token' in desc) && !('apiKey' in desc));
  assert.strictEqual(typeof cfg.getApiKey, 'function'); // present but non-enumerable
  assert.ok(!Object.keys(cfg).includes('apiKey'));
});

test('config: token + mapped board → configured; sync still off by default', () => {
  const cfg = M.config.loadConfig({ env: { MONDAY_API_KEY: 'secret-token-value' }, mappingObject: mapping() });
  assert.strictEqual(M.config.isConfigured(cfg), true);
  assert.strictEqual(cfg.syncEnabled, false); // Phase 6 default
  assert.strictEqual(M.config.isSyncOperational(cfg), false);
});

test('config: invalid numeric env throws ConfigurationError', () => {
  assert.throws(() => M.config.loadConfig({ env: { MONDAY_RETRY_COUNT: 'abc' } }), /invalid numeric/);
});

test('adapters: coerce each column type', () => {
  assert.strictEqual(coerce({ type: 'text', text: '  Tita ' }, { type: 'text' }), 'Tita');
  assert.strictEqual(coerce({ type: 'numbers', text: '1,234.5' }, { type: 'numbers' }), 1234.5);
  assert.strictEqual(coerce({ type: 'numbers', text: 'nope' }, { type: 'numbers' }), null);
  assert.strictEqual(coerce({ type: 'status', text: 'Retail' }, { type: 'status', map: { Retail: 'retail' } }), 'retail');
  assert.strictEqual(coerce({ type: 'date', value: '{"date":"2026-05-20"}' }, { type: 'date' }), '2026-05-20');
  assert.strictEqual(coerce({ type: 'checkbox', value: '{"checked":"true"}' }, { type: 'checkbox' }), true);
  assert.strictEqual(coerce({ type: 'mirror', text: 'shown' }, { type: 'mirror' }), 'shown');
  assert.deepStrictEqual(coerce({ type: 'files', value: '{"files":[{"name":"a.png"}]}' }, { type: 'files' }), ['a.png']);
  // Unknown type falls back to text (never throws).
  assert.strictEqual(coerce({ type: 'some_future_type', text: 'x' }, { type: 'some_future_type' }), 'x');
});

test('mapper: raw items → canonical leases (item.name fallback, status map, date parse)', () => {
  const raw = rawBoard([
    item('1001', { cv: [{ id: 'cn', type: 'text', text: 'Tita' }, { id: 'cc', type: 'status', text: 'Retail' }, { id: 'ca', type: 'numbers', text: '317.71' }, { id: 'cd', type: 'date', value: '{"date":"2026-05-20"}' }] }),
    item('1002', { name: 'FallbackName', cv: [{ id: 'cn', type: 'text', text: '' }, { id: 'cc', type: 'status', text: 'Offices' }, { id: 'ca', type: 'numbers', text: '10' }] }),
  ]);
  raw.BID.items[1].name = 'Malath'; // item.name used when tenantName column is blank
  const ds = mapDataset(raw, mapping());
  assert.strictEqual(ds.leases.length, 2);
  assert.strictEqual(ds.leases[0].externalId, '1001');
  assert.strictEqual(ds.leases[0].categoryCode, 'retail');
  assert.strictEqual(ds.leases[0].area, 317.71);
  assert.strictEqual(ds.leases[0].leaseDate, '2026-05-20');
  assert.strictEqual(ds.leases[1].tenantName, 'Malath'); // fallback to item.name
});

test('mapper: category from GROUP (categorySource:"group" + groupMap); Vacant → is_active 0', () => {
  const gm = {
    version: 1,
    boards: {
      GB: {
        projectSlug: 'town-center', projectName: 'Town Center', itemGrain: 'lease', buildingSource: 'manual',
        categorySource: 'group', groupMap: { topics: 'retail', group_title: 'office' },
        statusMap: { Leased: 'active', Vacant: 'terminated' },
        categories: [{ code: 'retail', label: 'Commercial', occupancySource: 'leases', totalArea: 14850 }, { code: 'office', label: 'Offices', occupancySource: 'leases', totalArea: 9132 }],
        columns: { tenantName: { id: 'text_t', type: 'text' }, area: { id: 'num_a', type: 'numbers' }, status: { id: 'status', type: 'status' } },
      },
    },
  };
  const raw = { GB: { id: 'GB', name: 'TC', items: [
    { id: 'i1', name: '(A-GF-SM)', group: { id: 'topics', title: 'Retail' }, column_values: [{ id: 'text_t', text: 'Al Tamimi' }, { id: 'num_a', type: 'numbers', text: '3100' }, { id: 'status', type: 'status', text: 'Leased' }] },
    { id: 'i2', name: '(B-1-O1)', group: { id: 'group_title', title: 'Offices' }, column_values: [{ id: 'text_t', text: '' }, { id: 'num_a', type: 'numbers', text: '200' }, { id: 'status', type: 'status', text: 'Vacant' }] },
  ] } };
  const ds = mapDataset(raw, gm);
  assert.strictEqual(ds.leases[0].categoryCode, 'retail'); // group topics → retail
  assert.strictEqual(ds.leases[0].status, 'active');
  assert.strictEqual(ds.leases[1].categoryCode, 'office'); // group group_title → office
  assert.strictEqual(ds.leases[1].status, 'terminated');   // Vacant → terminated
  // validator: clean (vacant lease name falls back to unit code; only active needs a tenant)
  assert.strictEqual(M.validateCanonicalDataset(ds).ok, true);
  const model = M.transformCanonicalToRepositoryModel(ds);
  const leases = model.projects[0].leases;
  assert.strictEqual(leases.find((l) => l.externalId === 'i1').isActive, 1); // Leased → active
  assert.strictEqual(leases.find((l) => l.externalId === 'i2').isActive, 0); // Vacant → excluded
});

test('mapper: columnIdsForBoard collects mapped column ids', () => {
  const ids = columnIdsForBoard(mapping().boards.BID);
  assert.deepStrictEqual(ids.sort(), ['ca', 'cc', 'cd', 'cn']);
});

test('validator: clean dataset passes; duplicate externalId + bad area + unknown category fail', () => {
  const good = mapDataset(rawBoard([item('1', { cv: [{ id: 'cn', text: 'A' }, { id: 'cc', type: 'status', text: 'Retail' }, { id: 'ca', type: 'numbers', text: '5' }] })]), mapping());
  assert.strictEqual(M.validateCanonicalDataset(good).ok, true);

  const dup = mapDataset(rawBoard([
    item('9', { cv: [{ id: 'cn', text: 'A' }, { id: 'cc', type: 'status', text: 'Retail' }, { id: 'ca', type: 'numbers', text: '5' }] }),
    item('9', { cv: [{ id: 'cn', text: 'B' }, { id: 'cc', type: 'status', text: 'Retail' }, { id: 'ca', type: 'numbers', text: '5' }] }),
  ]), mapping());
  assert.ok(M.validateCanonicalDataset(dup).errors.some((e) => /duplicate lease externalId/.test(e)));

  const badArea = mapDataset(rawBoard([item('1', { cv: [{ id: 'cn', text: 'A' }, { id: 'cc', type: 'status', text: 'Retail' }, { id: 'ca', type: 'numbers', text: '-5' }] })]), mapping());
  assert.ok(M.validateCanonicalDataset(badArea).errors.some((e) => /negative/.test(e)));

  const unknownCat = mapDataset(rawBoard([item('1', { cv: [{ id: 'cn', text: 'A' }, { id: 'cc', type: 'status', text: 'Nonexistent' }, { id: 'ca', type: 'numbers', text: '5' }] })]), mapping());
  assert.ok(M.validateCanonicalDataset(unknownCat).errors.some((e) => /unknown category/.test(e)));
});

test('transformer: canonical → nested repository model with sorted projects', () => {
  const ds = mapDataset(rawBoard([item('1', { cv: [{ id: 'cn', text: 'A' }, { id: 'cc', type: 'status', text: 'Retail' }, { id: 'ca', type: 'numbers', text: '5' }] })]), mapping());
  const model = M.transformCanonicalToRepositoryModel(ds);
  assert.strictEqual(model.source, 'monday');
  assert.strictEqual(model.projects.length, 1);
  assert.strictEqual(model.projects[0].slug, 'business-address');
  assert.strictEqual(model.projects[0].leases.length, 1);
  assert.strictEqual(model.projects[0].categories.length, 2);
});

test('diff-engine: insert/update/delete/unchanged by externalId + hash', () => {
  const cur = [{ externalId: '1', categoryCode: 'retail', tenantName: 'A', tenantType: null, area: 5, leaseDate: null, status: null, logoPath: null }];
  const inc = [
    { externalId: '1', categoryCode: 'retail', tenantName: 'A', tenantType: null, area: 5, leaseDate: null, status: null, logoPath: null }, // unchanged
    { externalId: '2', categoryCode: 'office', tenantName: 'B', tenantType: null, area: 9, leaseDate: null, status: null, logoPath: null }, // insert
  ];
  const d = M.diff.diffLeases(cur, inc);
  const s = M.diff.summarize(d);
  assert.deepStrictEqual({ i: s.inserted, u: s.updated, del: s.deleted, un: s.unchanged }, { i: 1, u: 0, del: 0, un: 1 });

  const changed = M.diff.diffLeases(cur, [{ ...cur[0], area: 99 }]);
  assert.strictEqual(M.diff.summarize(changed).updated, 1);
  const removed = M.diff.diffLeases(cur, []);
  assert.strictEqual(M.diff.summarize(removed).deleted, 1);
});

test('logger: redacts secret-like keys and long tokens', () => {
  const log = M.createLogger({});
  const safe = log.redact({ Authorization: 'abcdefghijklmnopqrstuvwxyz012345', token: 'x', board: 'Business Address' });
  assert.strictEqual(safe.Authorization, '***redacted***');
  assert.strictEqual(safe.token, '***redacted***');
  assert.strictEqual(safe.board, 'Business Address');
});
