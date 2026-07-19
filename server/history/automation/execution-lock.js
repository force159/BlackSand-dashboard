'use strict';
/**
 * Phase 9.1B — snapshot execution coordinator (§12). Defense in depth against overlapping
 * snapshot creation:
 *   Layer 1: in-process mutex (one execution at a time per Node process).
 *   Layer 2: DB-backed lock on `historical_execution_locks` (cross-process safety for the
 *            shared SQLite file) — atomic acquire via INSERT, stale takeover via guarded
 *            UPDATE (only when expired), owner-checked release.
 *   Layer 3: the Phase 9.1A UNIQUE(project_key, business_date) constraint (final guard).
 * A lock being unavailable is a STRUCTURED skip, never an unhandled error.
 */

const crypto = require('crypto');
const { LOCK_NAME } = require('../constants');

let inProcessBusy = false; // Layer 1

function newOwnerId() { return 'owner_' + process.pid + '_' + crypto.randomUUID(); }

// Atomically acquire the DB lock. Returns true on success, false if held by a live owner.
function acquireDbLock(db, { lockName = LOCK_NAME, ownerId, ttlSeconds, nowUtc }) {
  const now = nowUtc || new Date().toISOString();
  const expires = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
  const tx = db.transaction(() => {
    try {
      db.prepare('INSERT INTO historical_execution_locks (lock_name, owner_id, acquired_at_utc, expires_at_utc, metadata_json) VALUES (?,?,?,?,?)')
        .run(lockName, ownerId, now, expires, null);
      return { ok: true, takeover: false };
    } catch (e) {
      if (!/UNIQUE constraint failed/.test(String(e.message))) throw e;
      // Row exists → take over ONLY if the existing lock has expired (atomic guarded update).
      const prev = db.prepare('SELECT owner_id, expires_at_utc FROM historical_execution_locks WHERE lock_name=?').get(lockName);
      const changed = db.prepare('UPDATE historical_execution_locks SET owner_id=?, acquired_at_utc=?, expires_at_utc=?, metadata_json=? WHERE lock_name=? AND expires_at_utc < ?')
        .run(ownerId, now, expires, prev ? JSON.stringify({ tookOverFrom: prev.owner_id, staleExpiry: prev.expires_at_utc }) : null, lockName, now).changes;
      return { ok: changed === 1, takeover: changed === 1, previousOwner: prev ? prev.owner_id : null };
    }
  });
  return tx();
}

function releaseDbLock(db, lockName, ownerId) {
  return db.prepare('DELETE FROM historical_execution_locks WHERE lock_name=? AND owner_id=?').run(lockName, ownerId).changes === 1;
}

// CP3: owner-checked atomic lease renewal — extends expires_at ONLY for the current owner
// (no new column; reuses expires_at_utc). Returns true if renewed, false if ownership lost.
// (Captures are synchronous, so the lock is held sub-second and this is a safety net for
// any future async work — a heartbeat timer cannot preempt a synchronous capture.)
function renewDbLock(db, lockName, ownerId, ttlSeconds, nowUtc) {
  const now = nowUtc || new Date().toISOString();
  const expires = new Date(Date.parse(now) + ttlSeconds * 1000).toISOString();
  return db.prepare('UPDATE historical_execution_locks SET expires_at_utc=@e WHERE lock_name=@n AND owner_id=@o')
    .run({ e: expires, n: lockName, o: ownerId }).changes === 1;
}

/**
 * Run `fn()` under both the in-process mutex and the DB lock. Returns:
 *   { ran:true, result }  or  { ran:false, reason:'IN_PROGRESS'|'LOCK_UNAVAILABLE', ownerId }
 * Always releases what it acquired (finally). `fn` receives { ownerId }.
 */
function runExclusive(db, opts, fn) {
  const ownerId = (opts && opts.ownerId) || newOwnerId();
  const ttlSeconds = (opts && opts.ttlSeconds) || 300;
  const nowUtc = opts && opts.nowUtc;
  if (inProcessBusy) return { ran: false, reason: 'IN_PROGRESS', ownerId };
  inProcessBusy = true;
  let acquired = null;
  try {
    acquired = acquireDbLock(db, { ownerId, ttlSeconds, nowUtc });
    if (!acquired.ok) return { ran: false, reason: 'LOCK_UNAVAILABLE', ownerId, previousOwner: acquired.previousOwner };
    // The fn receives an owner-checked renew() (CP6/lock-renewal): callers renew the lease at
    // safe checkpoints; a failed renewal (ownership lost) returns false so the caller can fail
    // closed. (Captures are synchronous, so the lease is held sub-second; renewal extends it
    // across project boundaries and is a correctness safeguard, not a timer heartbeat.)
    const renew = () => { try { return renewDbLock(db, LOCK_NAME, ownerId, ttlSeconds); } catch (_) { return false; } };
    const result = fn({ ownerId, takeover: acquired.takeover, renew });
    return { ran: true, result, ownerId, takeover: acquired.takeover };
  } finally {
    if (acquired && acquired.ok) { try { releaseDbLock(db, LOCK_NAME, ownerId); } catch (_) {} }
    inProcessBusy = false;
  }
}

// Test/inspection helpers.
function _resetInProcess() { inProcessBusy = false; }
function currentLock(db) { return db.prepare('SELECT * FROM historical_execution_locks WHERE lock_name=?').get(LOCK_NAME) || null; }

module.exports = { newOwnerId, acquireDbLock, renewDbLock, releaseDbLock, runExclusive, currentLock, LOCK_NAME, _resetInProcess };
