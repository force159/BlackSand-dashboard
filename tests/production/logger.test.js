'use strict';
/**
 * Phase 9.4A — centralized logger. Verifies level gating, entry shape (timestamp/level/
 * source/message), secret redaction, and safe file output. Offline.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../../server/logger');

// Capture stdout+stderr writes during fn().
function capture(fn) {
  const out = []; const err = [];
  const so = process.stdout.write.bind(process.stdout); const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  try { fn(); } finally { process.stdout.write = so; process.stderr.write = se; }
  return { out: out.join(''), err: err.join('') };
}

test('level gating: info hides debug; error/warn go to stderr, info to stdout', () => {
  logger.configure({ level: 'info', toFile: false });
  const log = logger.createLogger('t');
  const cap = capture(() => { log.debug('dbg'); log.info('inf'); log.warn('wrn'); log.error('errr'); });
  assert.ok(!cap.out.includes('dbg') && !cap.err.includes('dbg'), 'debug suppressed at level=info');
  assert.ok(cap.out.includes('inf'));
  assert.ok(cap.err.includes('wrn') && cap.err.includes('errr'));
});

test('debug level shows everything', () => {
  logger.configure({ level: 'debug', toFile: false });
  const cap = capture(() => logger.createLogger('t').debug('shown'));
  assert.ok(cap.out.includes('shown'));
});

test('entry shape: ISO timestamp, LEVEL, [source], message', () => {
  logger.configure({ level: 'info', toFile: false });
  const cap = capture(() => logger.createLogger('boot').info('hello world'));
  assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(cap.out), 'ISO timestamp');
  assert.ok(/INFO/.test(cap.out) && /\[boot\]/.test(cap.out) && /hello world/.test(cap.out));
});

test('secret redaction: token/apiKey/password keys are hidden', () => {
  logger.configure({ level: 'info', toFile: false });
  const cap = capture(() => logger.createLogger('t').info('ctx', { apiKey: 'AABBCC', nested: { token: 'zzz', ok: 1 }, password: 'p' }));
  assert.ok(!cap.out.includes('AABBCC') && !cap.out.includes('zzz') && !cap.out.includes('"p"'));
  assert.ok(cap.out.includes('[redacted]'));
  assert.ok(cap.out.includes('"ok":1'), 'non-secret context preserved');
});

test('redact() is pure and deep', () => {
  const r = logger.redact({ Authorization: 'x', a: { secretThing: 'y', b: 2 } }, 0);
  assert.strictEqual(r.Authorization, '[redacted]');
  assert.strictEqual(r.a.secretThing, '[redacted]');
  assert.strictEqual(r.a.b, 2);
});

test('file output: one JSON line per entry, never throws', () => {
  const dir = path.join(os.tmpdir(), `bs-log-${process.pid}-${Date.now()}`);
  logger.configure({ level: 'info', dir, file: 'test.log', toFile: true });
  capture(() => logger.createLogger('f').info('to-file', { n: 5 }));
  const line = fs.readFileSync(path.join(dir, 'test.log'), 'utf8').trim();
  const parsed = JSON.parse(line);
  assert.strictEqual(parsed.level, 'info');
  assert.strictEqual(parsed.source, 'f');
  assert.strictEqual(parsed.message, 'to-file');
  assert.strictEqual(parsed.context.n, 5);
  assert.ok(parsed.timestamp);
  logger.configure({ toFile: false }); // reset for other tests
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});
