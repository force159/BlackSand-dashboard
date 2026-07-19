'use strict';
/**
 * Phase 9.4A — centralized application logger. Zero-dependency, CommonJS.
 *
 * - Levels: ERROR < WARN < INFO < DEBUG. A configured level shows itself and everything
 *   more severe (level=info → error+warn+info; level=debug → all).
 * - Each entry: ISO timestamp, level, source, message, and optional structured context.
 * - Writes to the console (stdout for info/debug, stderr for warn/error) so PM2 captures
 *   it, AND — when a log directory is configured — appends a single JSON line per entry to
 *   logs/dashboard.log for durable, greppable operational history. File writes are wrapped
 *   so a logging failure NEVER crashes the app.
 * - Secrets are redacted from context by key (token/apiKey/authorization/password/secret),
 *   so a stray credential in a context object is never written. Never pass a raw token.
 *
 * Usage:  const { createLogger } = require('./logger'); const log = createLogger('server');
 *         log.info('started', { port: 3000 });
 * The method signature (message, context) is compatible with the (evt, ctx) shape the
 * scheduler / Monday layer already use, so the same logger can be handed to them.
 */

const fs = require('fs');
const path = require('path');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const SENSITIVE = /^(.*token.*|.*api[_-]?key.*|authorization|password|.*secret.*|cookie)$/i;

const settings = { level: 'info', dir: null, file: 'dashboard.log', toFile: false };

function configure(opts) {
  opts = opts || {};
  if (opts.level && LEVELS[String(opts.level).toLowerCase()] != null) settings.level = String(opts.level).toLowerCase();
  if (opts.dir) {
    try { fs.mkdirSync(opts.dir, { recursive: true }); settings.dir = opts.dir; settings.toFile = opts.toFile !== false; }
    catch (_) { settings.dir = null; settings.toFile = false; } // never fail startup because logs/ can't be made
  }
  if (opts.file) settings.file = opts.file;
  if (opts.toFile === false) settings.toFile = false;
  return getSettings();
}
function getSettings() { return { level: settings.level, dir: settings.dir, file: settings.file, toFile: settings.toFile }; }

function redact(v, depth) {
  if (v == null || depth > 4) return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v[k], depth + 1);
    return out;
  }
  return v;
}

function emit(level, source, message, context) {
  if (LEVELS[level] > LEVELS[settings.level]) return; // below the configured verbosity
  const ts = new Date().toISOString();
  const ctx = (context && typeof context === 'object') ? redact(context, 0) : (context != null ? { value: context } : null);
  const human = `${ts} ${level.toUpperCase().padEnd(5)} [${source}] ${message}` + (ctx ? ' ' + safeJson(ctx) : '');
  if (level === 'error' || level === 'warn') process.stderr.write(human + '\n');
  else process.stdout.write(human + '\n');
  if (settings.toFile && settings.dir) {
    try {
      const line = safeJson({ timestamp: ts, level, source, message, context: ctx || undefined }) + '\n';
      fs.appendFileSync(path.join(settings.dir, settings.file), line);
    } catch (_) { /* logging must never throw */ }
  }
}
function safeJson(o) { try { return JSON.stringify(o); } catch (_) { return '"[unserializable]"'; } }

function createLogger(source) {
  const src = source || 'app';
  return {
    error(message, context) { emit('error', src, message, context); },
    warn(message, context) { emit('warn', src, message, context); },
    info(message, context) { emit('info', src, message, context); },
    debug(message, context) { emit('debug', src, message, context); },
    child(sub) { return createLogger(src + ':' + sub); },
  };
}

module.exports = { createLogger, configure, getSettings, LEVELS, redact };
