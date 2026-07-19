'use strict';
/**
 * Phase 9.1A — centralized Riyadh (Asia/Riyadh) business-date utility.
 *
 * The business date MUST be the civil date in Asia/Riyadh — never a slice of a UTC ISO
 * string and never the server's local date. Riyadh is UTC+03:00 with NO daylight saving,
 * so the civil date is derived with the built-in Intl timezone formatter (no dependency).
 *
 * All functions accept an explicit `Date` (or ms) so tests are deterministic and never
 * depend on the real wall clock.
 */

const { TIMEZONE } = require('./constants');

// Format a Date as the civil YYYY-MM-DD in Asia/Riyadh using Intl (locale-independent).
function toRiyadhBusinessDate(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new TypeError('toRiyadhBusinessDate: invalid date');
  // en-CA yields ISO-like YYYY-MM-DD; parts avoid locale ordering surprises.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}

/**
 * Capture context for a snapshot. Returns the UTC instant, the Riyadh business date, and
 * the timezone id — the canonical trio stored on every snapshot.
 * @param {Date|number} [now] capture instant (defaults to real now; pass a fixed Date in tests)
 */
function captureContext(now) {
  const d = (now === undefined) ? new Date() : (now instanceof Date ? now : new Date(now));
  if (Number.isNaN(d.getTime())) throw new TypeError('captureContext: invalid date');
  return {
    capturedAtUtc: d.toISOString(),
    businessDate: toRiyadhBusinessDate(d),
    timezone: TIMEZONE,
  };
}

// Strict YYYY-MM-DD shape check (used by validation/constraints).
function isValidBusinessDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, day] = s.split('-').map(Number);
  if (m < 1 || m > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

// ── Scheduling helpers (Phase 9.1B) — all timezone-aware via Intl (no hardcoded +3) ──

// Riyadh UTC offset in minutes for a given instant (IANA-correct; falls back to +180).
function riyadhOffsetMinutes(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'shortOffset' }).formatToParts(d);
    const tzn = (p.find((x) => x.type === 'timeZoneName') || {}).value || '';
    const m = tzn.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (m) return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
  } catch (e) {}
  return 180; // Riyadh is UTC+3, no DST
}

// Current Riyadh wall-clock parts { year, month, day, hour, minute, date:'YYYY-MM-DD', minutesOfDay }.
function riyadhNowParts(now) {
  const d = (now === undefined) ? new Date() : (now instanceof Date ? now : new Date(now));
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t) => Number((p.find((x) => x.type === t) || {}).value);
  const hour = g('hour') % 24; // Intl may render 24 at midnight in some environments
  return { year: g('year'), month: g('month'), day: g('day'), hour, minute: g('minute'),
    date: toRiyadhBusinessDate(d), minutesOfDay: hour * 60 + g('minute') };
}

// Parse "HH:mm" (24h) → { hour, minute } or null.
function parseHHmm(s) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s || '').trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

// Has the configured daily time already passed today (Riyadh)?
function hasScheduledTimePassed(now, hhmm) {
  const t = parseHHmm(hhmm); if (!t) return false;
  return riyadhNowParts(now).minutesOfDay >= (t.hour * 60 + t.minute);
}

// Next UTC instant (Date) at which the Riyadh wall time hhmm next occurs (today if still
// ahead, else tomorrow). Converts the Riyadh wall time to a UTC instant via the zone offset.
function nextScheduledInstant(now, hhmm) {
  const t = parseHHmm(hhmm); if (!t) throw new TypeError('nextScheduledInstant: invalid HH:mm');
  const np = riyadhNowParts(now);
  let { year, month, day } = np;
  const passed = np.minutesOfDay >= (t.hour * 60 + t.minute);
  let asUtc = Date.UTC(year, month - 1, day, t.hour, t.minute, 0);
  let instant = asUtc - riyadhOffsetMinutes(new Date(asUtc)) * 60000;
  if (passed || instant <= (now instanceof Date ? now.getTime() : Date.now())) {
    asUtc += 24 * 60 * 60 * 1000; // tomorrow same Riyadh wall time
    instant = asUtc - riyadhOffsetMinutes(new Date(asUtc)) * 60000;
  }
  return new Date(instant);
}

module.exports = {
  toRiyadhBusinessDate, captureContext, isValidBusinessDate, TIMEZONE,
  riyadhOffsetMinutes, riyadhNowParts, parseHHmm, hasScheduledTimePassed, nextScheduledInstant,
};
