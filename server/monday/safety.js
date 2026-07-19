'use strict';
/**
 * BlackSand dashboard — last-known-good safety guards (Phase 6 hardening).
 *
 * Conservative protections that reject a synchronisation (preserving existing SQLite
 * data) when an incoming dataset looks empty or collapsed. Pure functions — the caller
 * supplies the previous authoritative count. Config comes from the board's `safety`
 * block and/or global env defaults.
 *
 * Rules (per board):
 *   - allowEmpty (default false): a board that previously had records but now returns
 *     zero accepted rows is rejected unless allowEmpty is true.
 *   - minAcceptedRecords (default 0): fewer accepted rows than this → reject.
 *   - maxRecordDropPercent (default 50): a drop from the previous authoritative count
 *     larger than this % → reject (unless this is the first cutover, prevSource='seed'/
 *     none, where a legitimate difference is expected — the drop rule is skipped and
 *     only allowEmpty/minAcceptedRecords apply).
 */

const DEFAULTS = { allowEmpty: false, minAcceptedRecords: 0, maxRecordDropPercent: 50 };

function boardSafety(boardConfig, envDefaults = {}) {
  const s = (boardConfig && boardConfig.safety) || {};
  return {
    allowEmpty: s.allowEmpty != null ? Boolean(s.allowEmpty) : (envDefaults.allowEmpty != null ? envDefaults.allowEmpty : DEFAULTS.allowEmpty),
    minAcceptedRecords: s.minAcceptedRecords != null ? Number(s.minAcceptedRecords) : (envDefaults.minAcceptedRecords != null ? envDefaults.minAcceptedRecords : DEFAULTS.minAcceptedRecords),
    maxRecordDropPercent: s.maxRecordDropPercent != null ? Number(s.maxRecordDropPercent) : (envDefaults.maxRecordDropPercent != null ? envDefaults.maxRecordDropPercent : DEFAULTS.maxRecordDropPercent),
  };
}

/**
 * Evaluate safety for one board/project.
 * @param {object} p { acceptedCount, previousCount, previousSource, boardConfig, envDefaults, override }
 * @returns { ok, reason } — reason is a safe, actionable string when !ok.
 */
function evaluateSafety(p) {
  const cfg = boardSafety(p.boardConfig, p.envDefaults);
  const accepted = Number(p.acceptedCount) || 0;
  const prev = Number(p.previousCount) || 0;
  const firstCutover = !p.previousSource || p.previousSource === 'seed' || prev === 0;

  if (p.override === true) return { ok: true, reason: 'safety overridden explicitly' };

  if (accepted === 0) {
    if (!cfg.allowEmpty) return { ok: false, reason: `empty dataset rejected (allowEmpty=false); ${prev} record(s) previously present — data preserved` };
    return { ok: true, reason: 'empty dataset explicitly allowed (allowEmpty=true)' }; // intentional → skip collapse rule
  }
  if (accepted < cfg.minAcceptedRecords) {
    return { ok: false, reason: `accepted ${accepted} < minAcceptedRecords ${cfg.minAcceptedRecords} — data preserved` };
  }
  if (!firstCutover && prev > 0) {
    const dropPct = ((prev - accepted) / prev) * 100;
    if (dropPct > cfg.maxRecordDropPercent) {
      return { ok: false, reason: `record-count collapse: ${prev} → ${accepted} (−${dropPct.toFixed(0)}%) exceeds maxRecordDropPercent ${cfg.maxRecordDropPercent} — data preserved (use an explicit override for an intentional bulk removal)` };
    }
  }
  return { ok: true, reason: firstCutover ? 'first cutover — drop rule skipped' : 'within safety thresholds' };
}

module.exports = { DEFAULTS, boardSafety, evaluateSafety };
