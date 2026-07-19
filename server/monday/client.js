'use strict';
/**
 * BlackSand dashboard — reusable Monday GraphQL client (Phase 6, OFFLINE).
 *
 * Implements the full request lifecycle — auth header, timeout, retries with
 * exponential backoff + jitter, rate-limit/complexity handling, network-failure
 * classification, and meaningful typed errors — WITHOUT performing any real request.
 *
 * The transport is INJECTED. The default transport is `disabledTransport`, which
 * throws NetworkDisabledError, so a plain `new MondayClient(config)` can never touch
 * the network in Phase 6. Tests inject an in-memory fake transport to exercise the
 * retry/backoff/rate-limit/pagination logic entirely offline. Phase 7 will inject a
 * real fetch-based transport — no other client change required.
 *
 * A transport is `async ({ url, headers, body, timeoutMs, signal }) => { status,
 * headers, json }`. The client never logs the token (logger redacts).
 */

const { NetworkDisabledError, AuthenticationError, RateLimitError, TimeoutError, NetworkError, SchemaMismatchError } = require('./errors');
const { firstPageRequest, nextPageRequest, boardMetaRequest } = require('./graphql');

// Phase 6 default: refuse to make any network call.
async function disabledTransport() {
  throw new NetworkDisabledError();
}

// Deterministic-ish backoff: base * 2^attempt, capped, plus optional jitter (jitter is
// injectable so tests are deterministic).
function backoffDelay(attempt, baseMs, capMs, jitter) {
  const raw = Math.min(capMs, baseMs * Math.pow(2, attempt));
  const j = typeof jitter === 'function' ? jitter() : 0; // jitter in [0,1)
  return Math.round(raw * (1 + 0.25 * j));
}

class MondayClient {
  /**
   * @param {object} config   from loadConfig()
   * @param {object} deps     { transport, logger, sleep, jitter }
   */
  constructor(config, deps = {}) {
    this.config = config;
    this.transport = deps.transport || disabledTransport;
    this.logger = deps.logger || { debug() {}, info() {}, warn() {}, error() {} };
    this.sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.jitter = deps.jitter || Math.random;
    this._requestCount = 0;
  }

  /** True only if a real (non-disabled) transport was injected. */
  isNetworkEnabled() {
    return this.transport !== disabledTransport;
  }

  // Build the authenticated request envelope. The token is read lazily and never
  // stored on the client or logged.
  _envelope(query, variables) {
    const token = this.config.getApiKey ? this.config.getApiKey() : '';
    return {
      url: this.config.apiUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'API-Version': this.config.apiVersion,
      },
      body: JSON.stringify({ query, variables }),
      timeoutMs: this.config.requestTimeoutMs,
    };
  }

  // Classify a transport result/throw into typed, retryable-aware errors.
  _classify(result, err) {
    if (err) {
      if (err.name === 'AbortError' || /timeout/i.test(err.message || '')) return new TimeoutError('Monday request timed out');
      if (err.code === 'NETWORK_DISABLED') return err; // pass through the Phase-6 guard
      return new NetworkError('Monday request failed at the transport layer', { cause: err.message });
    }
    const status = result.status;
    if (status === 401 || status === 403) return new AuthenticationError('Monday rejected the API token');
    if (status === 429) return new RateLimitError('Monday rate/complexity limit reached', { retryAfter: result.headers && result.headers['retry-after'] });
    if (status >= 500) return new NetworkError(`Monday server error (HTTP ${status})`, { status });
    if (status >= 400) return new NetworkError(`Monday request error (HTTP ${status})`, { status });
    // GraphQL-level errors surface in the JSON body even on HTTP 200.
    if (result.json && Array.isArray(result.json.errors) && result.json.errors.length) {
      const first = result.json.errors[0] || {};
      if (/complexity|rate limit/i.test(first.message || '')) return new RateLimitError('Monday complexity budget exceeded', { message: first.message });
      if (/auth|token|unauthorized/i.test(first.message || '')) return new AuthenticationError('Monday authentication error', { message: first.message });
      return new SchemaMismatchError('Monday returned GraphQL errors', { messages: result.json.errors.map((e) => e.message) });
    }
    return null; // success
  }

  /**
   * Execute a single GraphQL request with retry/backoff. Returns the parsed `data`.
   * Non-retryable errors (auth, schema) throw immediately; retryable ones (timeout,
   * rate-limit, 5xx, network) retry up to config.retryCount with capped backoff.
   */
  async request(query, variables) {
    const envelope = this._envelope(query, variables);
    const maxAttempts = this.config.retryCount + 1;
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = backoffDelay(attempt - 1, this.config.retryBaseMs, this.config.pollIntervalMs, this.jitter);
        this.logger.debug(`retrying Monday request (attempt ${attempt + 1}/${maxAttempts}) after ${delay}ms`);
        await this.sleep(delay);
      }
      let result = null, thrown = null;
      try {
        this._requestCount++;
        result = await this.transport(envelope);
      } catch (e) {
        thrown = e;
      }
      const typed = this._classify(result, thrown);
      if (!typed) return result.json && result.json.data ? result.json.data : (result.json || {});
      lastError = typed;
      if (!typed.retryable) throw typed;      // auth / schema → fail fast
      this.logger.warn(`Monday request attempt ${attempt + 1} failed: ${typed.code}`);
    }
    throw lastError; // exhausted retries
  }

  /**
   * Fetch ALL items of a board via cursor pagination, respecting maxPages/batchSize.
   * Returns { boardName, items }. Uses graphql.js request builders; values go through
   * variables only. (Executes only if a real transport is injected.)
   */
  async fetchBoardItems(boardId, columnIds) {
    const limit = this.config.batchSize;
    const first = firstPageRequest({ boardId, columnIds, limit });
    const data = await this.request(first.query, first.variables);
    const board = data.boards && data.boards[0];
    if (!board) throw new SchemaMismatchError('Monday response missing board', { boardId });
    let page = board.items_page || { items: [], cursor: null };
    const seen = new Set();
    const items = [];
    const addUnique = (arr) => { for (const it of arr || []) { const id = String(it.id); if (!seen.has(id)) { seen.add(id); items.push(it); } } };
    addUnique(page.items);
    let pages = 1;
    let complete = !page.cursor; // no cursor after page 1 → already complete
    let lastCursor = null;
    while (page.cursor && pages < this.config.maxPages) {
      if (page.cursor === lastCursor) throw new SchemaMismatchError('Monday returned a repeated pagination cursor', { boardId });
      lastCursor = page.cursor;
      const next = nextPageRequest({ cursor: page.cursor, columnIds, limit });
      const nd = await this.request(next.query, next.variables);
      page = nd.next_items_page || { items: [], cursor: null };
      addUnique(page.items);
      pages++;
      if (!page.cursor) { complete = true; break; }
    }
    // If a cursor remains, we stopped at maxPages → the fetch is INCOMPLETE. The sync
    // engine must NOT deactivate/replace records from an incomplete fetch.
    if (page.cursor) { complete = false; this.logger.warn(`board ${String(boardId).slice(0, 4)}… hit maxPages=${this.config.maxPages}; fetch INCOMPLETE`); }
    return { boardName: board.name, items, pages, complete };
  }

  /** Fetch board metadata (columns) for validating a mapping against the live board. */
  async fetchBoardMeta(boardId) {
    const req = boardMetaRequest({ boardId });
    const data = await this.request(req.query, req.variables);
    const board = data.boards && data.boards[0];
    if (!board) throw new SchemaMismatchError('Monday response missing board metadata', { boardId });
    return board;
  }
}

module.exports = { MondayClient, disabledTransport, backoffDelay };
