'use strict';
/**
 * Phase 9.1A/9.1B — snapshot source eligibility (§7 + 9.1B CP2 freshness).
 *
 * A snapshot may ONLY be created from authoritative LIVE data (current_data_source ===
 * 'monday' + a real dataVersion). CP2 adds TRIGGER-AWARE freshness so scheduled/recovery
 * runs cannot silently capture stale source data:
 *   - post_sync            → fresh by definition (it follows a confirmed committed sync).
 *   - scheduled_daily /
 *     startup_recovery /
 *     retry                → require a successful sync within `maxSourceAgeMinutes` of now.
 *   - manual_cli / manual /
 *     test / (unset)       → lenient: a stale source is a WARNING, not a block (operator intent).
 * Structured result; never throws. `decisionCode` is set on ineligibility.
 */

const FRESH_ENFORCED_TRIGGERS = new Set(['scheduled_daily', 'startup_recovery', 'retry']);
const DEFAULT_MAX_SOURCE_AGE_MIN = 1500; // ~25h — allows a same-/prior-day sync for a daily 02:00 capture

function evaluateSourceEligibility({ project, meta, currentDataSource, trigger, nowUtc, maxSourceAgeMinutes }) {
  const reasons = [];
  const warnings = [];
  let decisionCode = null;
  const sourceType = currentDataSource || 'unknown';
  const sourceDataVersion = meta ? (meta.dataVersion || null) : null;
  const sourceSyncedAtUtc = meta ? (meta.lastSuccessfulSync || null) : null;
  const fail = (code, msg) => { decisionCode = decisionCode || code; reasons.push(msg); };

  // ── authoritative-source structural checks (Phase 9.1A) ──
  if (!project) fail('SOURCE_DATA_UNAVAILABLE', 'project data unavailable');
  if (sourceType !== 'monday') fail('SOURCE_NOT_AUTHORITATIVE', 'source is not authoritative live data (source=' + sourceType + ')');
  if (!sourceDataVersion) fail('SOURCE_SYNC_MISSING', 'missing dataVersion (provenance required)');
  if (project) {
    if (!project.retail || !Array.isArray(project.retail.tenants)) fail('SOURCE_STRUCTURE_INVALID', 'project retail data structurally invalid');
    if (!project.office || !Array.isArray(project.office.tenants)) fail('SOURCE_STRUCTURE_INVALID', 'project office data structurally invalid');
    if (!project.metrics) fail('SOURCE_STRUCTURE_INVALID', 'project metrics unavailable');
  }

  // ── CP2 trigger-aware freshness ──
  const enforce = FRESH_ENFORCED_TRIGGERS.has(trigger);
  const maxAgeMin = (typeof maxSourceAgeMinutes === 'number' && maxSourceAgeMinutes > 0) ? maxSourceAgeMinutes : DEFAULT_MAX_SOURCE_AGE_MIN;
  if (trigger === 'post_sync') {
    // Just synced + committed → fresh. (No age check; the caller guarantees a successful sync.)
  } else if (enforce && reasons.length === 0) {
    if (!sourceSyncedAtUtc) fail('SOURCE_SYNC_MISSING', 'no successful sync recorded; cannot prove freshness');
    else {
      const ageMin = (Date.parse(nowUtc || new Date().toISOString()) - Date.parse(sourceSyncedAtUtc)) / 60000;
      if (!Number.isFinite(ageMin)) fail('SOURCE_EFFECTIVE_DATE_UNKNOWN', 'sync timestamp unparseable');
      else if (ageMin > maxAgeMin) fail('SOURCE_STALE', `last successful sync is ${Math.round(ageMin)} min old (> ${maxAgeMin} min)`);
    }
  } else {
    // Lenient triggers: surface staleness as a warning (operator may still capture).
    if (sourceSyncedAtUtc) {
      const ageMin = (Date.parse(nowUtc || new Date().toISOString()) - Date.parse(sourceSyncedAtUtc)) / 60000;
      if (Number.isFinite(ageMin) && ageMin > maxAgeMin) warnings.push(`source is ${Math.round(ageMin)} min old (stale by policy, but trigger is lenient)`);
    } else {
      warnings.push('no last-successful-sync timestamp recorded');
    }
  }

  return {
    eligible: reasons.length === 0,
    decisionCode: reasons.length === 0 ? 'SOURCE_FRESH' : decisionCode,
    sourceType, sourceDataVersion, sourceSyncedAtUtc,
    reasons, warnings,
  };
}

module.exports = { evaluateSourceEligibility, DEFAULT_MAX_SOURCE_AGE_MIN };
