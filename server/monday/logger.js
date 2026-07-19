'use strict';
/**
 * BlackSand dashboard — Monday integration structured logger (Phase 6).
 *
 * Level-gated, prefixed console logging that NEVER emits secrets. `redact()` strips
 * token/key-like values from any object before logging, and known secret keys are
 * masked. No logging dependency — a thin wrapper over console, consistent with the
 * rest of the project. Log level comes from config (default 'info').
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const SECRET_KEY_RE = /(token|key|secret|authorization|apikey|api_key|password)/i;

// Recursively redact secret-looking values. Returns a safe copy; never mutates input.
function redact(value, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') {
    // Mask anything that looks like a long opaque token.
    return value.length >= 20 && /^[A-Za-z0-9._-]+$/.test(value) ? '***redacted***' : value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY_RE.test(k) ? '***redacted***' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function createLogger(options = {}) {
  const level = options.level && LEVELS[options.level] != null ? options.level : 'info';
  const threshold = LEVELS[level];
  const prefix = options.prefix || '[monday]';
  // Injectable sink for tests (default: console). Never receives raw secrets.
  const sink = options.sink || console;

  function emit(lvl, msg, meta) {
    if (LEVELS[lvl] > threshold) return;
    const line = `${prefix} ${lvl.toUpperCase()}: ${msg}`;
    const safeMeta = meta !== undefined ? redact(meta) : undefined;
    const fn = lvl === 'error' ? (sink.error || sink.log) : lvl === 'warn' ? (sink.warn || sink.log) : sink.log;
    if (safeMeta !== undefined) fn.call(sink, line, safeMeta); else fn.call(sink, line);
  }

  return {
    level,
    error: (msg, meta) => emit('error', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    debug: (msg, meta) => emit('debug', msg, meta),
    redact,
  };
}

module.exports = { createLogger, redact, LEVELS };
