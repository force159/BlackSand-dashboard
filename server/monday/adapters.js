'use strict';
/**
 * BlackSand dashboard — Monday column-type adapters (Phase 6).
 *
 * Each adapter coerces ONE raw Monday `column_value` ({ id, type, text, value }) into
 * a canonical primitive (string | number | boolean | null | array). New column types
 * are added here without touching the mapper. Adapters are pure and defensive: a
 * missing/blank value yields null (never throws) — validation decides if that is fatal.
 *
 * The Monday `value` field is a JSON string for most types; `text` is the display
 * string. We parse `value` when structure is needed, else fall back to `text`.
 */

function parseValue(raw) {
  if (!raw || raw.value == null || raw.value === '') return null;
  if (typeof raw.value === 'object') return raw.value;
  try { return JSON.parse(raw.value); } catch (e) { return null; }
}
const textOf = (raw) => (raw && raw.text != null && raw.text !== '' ? String(raw.text).trim() : null);

// Optional label→code translation table from the column spec (status/dropdown).
function mapLabel(label, spec) {
  if (label == null) return null;
  if (spec && spec.map && Object.prototype.hasOwnProperty.call(spec.map, label)) return spec.map[label];
  return label;
}

const ADAPTERS = {
  text: (raw) => textOf(raw),
  long_text: (raw) => {
    const v = parseValue(raw);
    return (v && typeof v.text === 'string') ? v.text.trim() : textOf(raw);
  },
  name: (raw) => textOf(raw),
  numbers: (raw) => {
    const t = textOf(raw);
    if (t == null) return null;
    const n = Number(String(t).replace(/[, ]+/g, ''));
    return Number.isFinite(n) ? n : null;
  },
  status: (raw, spec) => mapLabel(textOf(raw), spec),
  dropdown: (raw, spec) => mapLabel(textOf(raw), spec),
  color: (raw, spec) => mapLabel(textOf(raw), spec),
  date: (raw) => {
    const v = parseValue(raw);
    if (v && v.date) return String(v.date).slice(0, 10);
    const t = textOf(raw);
    return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
  },
  timeline: (raw) => {
    const v = parseValue(raw);
    return v && v.from ? String(v.from).slice(0, 10) : null; // start of the timeline
  },
  people: (raw) => {
    const t = textOf(raw);
    if (t) return t;
    const v = parseValue(raw);
    return v && Array.isArray(v.personsAndTeams) ? v.personsAndTeams.map((p) => p.id).join(',') : null;
  },
  checkbox: (raw) => {
    const v = parseValue(raw);
    return v && v.checked === 'true' ? true : (v && v.checked === true ? true : false);
  },
  // Computed/read-only columns: use the display text Monday renders.
  mirror: (raw) => textOf(raw),
  formula: (raw) => textOf(raw),
  // Connections: return linked item ids (array) or the display text.
  relation: (raw) => {
    const v = parseValue(raw);
    if (v && Array.isArray(v.linkedPulseIds)) return v.linkedPulseIds.map((x) => String(x.linkedPulseId));
    return textOf(raw);
  },
  board_relation: (raw) => ADAPTERS.relation(raw),
  files: (raw) => {
    const v = parseValue(raw);
    if (v && Array.isArray(v.files) && v.files.length) return v.files.map((f) => f.name || f.assetId).filter(Boolean);
    return null;
  },
  location: (raw) => {
    const v = parseValue(raw);
    return v && v.address ? String(v.address).trim() : textOf(raw);
  },
};

/**
 * Coerce a raw column value using the type from the column spec (falling back to the
 * raw column's own `type`, then to `text`). Unknown types default to display text so
 * a new/custom Monday type never crashes the sync — it just yields its text.
 */
function coerce(raw, spec) {
  const type = (spec && spec.type) || (raw && raw.type) || 'text';
  const adapter = ADAPTERS[type] || ADAPTERS.text;
  return adapter(raw, spec);
}

module.exports = { ADAPTERS, coerce, mapLabel, parseValue, textOf, SUPPORTED_TYPES: Object.keys(ADAPTERS) };
