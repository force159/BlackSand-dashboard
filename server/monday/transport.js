'use strict';
/**
 * BlackSand dashboard — production Monday fetch transport (Phase 6, NOT auto-used).
 *
 * A transport is `async ({ url, headers, body, timeoutMs }) => { status, headers, json }`
 * that the MondayClient calls. This one performs a real HTTPS POST using Node's built-in
 * `fetch` + `AbortController` (Node 18+). It is NEVER wired in automatically: the client
 * still defaults to `disabledTransport`, and the server never injects this during normal
 * startup. It is used only by explicit read-only CLI tools (inspect/validate-live/dry-run
 * with live creds) and, in Phase 7, by the gated manual sync.
 *
 * Fail-closed: `createFetchTransport(config)` throws ConfigurationError if no token is
 * configured. The token is read from config (env) only, sent in the Authorization
 * header, and NEVER logged. Retry/backoff/rate-limit classification live in the client;
 * this transport just does one round-trip and returns a normalized result.
 */

const { ConfigurationError } = require('./errors');

function normalizeHeaders(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === 'function') { h.forEach((v, k) => { out[String(k).toLowerCase()] = v; }); return out; }
  for (const [k, v] of Object.entries(h)) out[String(k).toLowerCase()] = v;
  return out;
}

/**
 * Build a real fetch-based transport bound to the given config. Fail-closed on a
 * missing token. Does not run until the client actually calls it.
 * @param {object} config  loadConfig() result
 * @param {object} [deps]  { fetchImpl } — inject a fetch for tests (default global fetch)
 */
function createFetchTransport(config, deps = {}) {
  const token = config.getApiKey ? config.getApiKey() : '';
  if (!token) throw new ConfigurationError('Monday API token is not configured (set MONDAY_API_KEY in .env)');
  const fetchImpl = deps.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new ConfigurationError('global fetch is unavailable in this Node runtime; upgrade Node or inject fetchImpl');

  return async function fetchTransport(envelope) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envelope.timeoutMs || 30000);
    try {
      const res = await fetchImpl(envelope.url, {
        method: 'POST',
        headers: envelope.headers,   // includes Authorization (token) — never logged
        body: envelope.body,
        signal: controller.signal,
      });
      let json = null;
      try { json = await res.json(); } catch (_) { json = null; }
      return { status: res.status, headers: normalizeHeaders(res.headers), json };
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createFetchTransport, normalizeHeaders };
