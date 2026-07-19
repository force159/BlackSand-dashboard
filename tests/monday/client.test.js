'use strict';
/**
 * Monday client tests — retry/backoff/rate-limit/auth/timeout/pagination, all via an
 * INJECTED in-memory transport (no network). Also proves the DEFAULT client cannot
 * touch the network (Phase 6 guard).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { MondayClient } = require('../../server/monday/client');
const { loadConfig } = require('../../server/monday/config');

const cfg = loadConfig({ env: { MONDAY_API_KEY: 'test-token', MONDAY_RETRY_COUNT: '3', MONDAY_RETRY_BASE_MS: '1', MONDAY_BATCH_SIZE: '2', MONDAY_MAX_PAGES: '10' }, mappingObject: { version: 1, boards: {} } });
const noSleep = () => Promise.resolve();
const noJitter = () => 0;

test('default client has network DISABLED and refuses requests', async () => {
  const client = new MondayClient(cfg);
  assert.strictEqual(client.isNetworkEnabled(), false);
  await assert.rejects(() => client.request('query{x}', {}), (e) => e.code === 'NETWORK_DISABLED');
});

test('retries a 429 then succeeds', async () => {
  let calls = 0;
  const transport = async () => { calls++; if (calls < 3) return { status: 429, headers: {}, json: {} }; return { status: 200, headers: {}, json: { data: { ok: true } } }; };
  const client = new MondayClient(cfg, { transport, sleep: noSleep, jitter: noJitter });
  const data = await client.request('q', {});
  assert.deepStrictEqual(data, { ok: true });
  assert.strictEqual(calls, 3);
});

test('fails fast on 401 auth error (no retry)', async () => {
  let calls = 0;
  const transport = async () => { calls++; return { status: 401, headers: {}, json: {} }; };
  const client = new MondayClient(cfg, { transport, sleep: noSleep, jitter: noJitter });
  await assert.rejects(() => client.request('q', {}), (e) => e.code === 'AUTHENTICATION_ERROR');
  assert.strictEqual(calls, 1); // not retried
});

test('classifies a transport timeout', async () => {
  const transport = async () => { const e = new Error('socket timeout'); throw e; };
  const client = new MondayClient(cfg, { transport, sleep: noSleep, jitter: noJitter });
  await assert.rejects(() => client.request('q', {}), (e) => e.code === 'TIMEOUT_ERROR');
});

test('GraphQL-level complexity error → RateLimitError (retryable, exhausts)', async () => {
  const transport = async () => ({ status: 200, headers: {}, json: { errors: [{ message: 'Complexity budget exhausted' }] } });
  const client = new MondayClient(cfg, { transport, sleep: noSleep, jitter: noJitter });
  await assert.rejects(() => client.request('q', {}), (e) => e.code === 'RATE_LIMIT_ERROR');
});

test('fetchBoardItems paginates via cursor', async () => {
  const pages = [
    { status: 200, headers: {}, json: { data: { boards: [{ id: 'B', name: 'Board', items_page: { cursor: 'c1', items: [{ id: '1', name: 'a', column_values: [] }, { id: '2', name: 'b', column_values: [] }] } }] } } },
    { status: 200, headers: {}, json: { data: { next_items_page: { cursor: null, items: [{ id: '3', name: 'c', column_values: [] }] } } } },
  ];
  let i = 0;
  const transport = async () => pages[i++];
  const client = new MondayClient(cfg, { transport, sleep: noSleep, jitter: noJitter });
  const res = await client.fetchBoardItems('B', ['x']);
  assert.strictEqual(res.items.length, 3);
  assert.strictEqual(res.pages, 2);
});
