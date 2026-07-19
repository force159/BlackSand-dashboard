'use strict';
/**
 * BlackSand dashboard — CURRENT-DASHBOARD BOOTSTRAP SEED DATA (Phase 2).
 *
 * ⚠️ THIS IS BOOTSTRAP / DEMO DATA, NOT VERIFIED PRODUCTION TRUTH. It is an explicit,
 * hand-reviewed transcription of the values currently embedded in the live
 * `Project Dashboard.html` `projects[]` array (source of truth for this phase). It
 * exists to prove the relational schema can represent the current dashboard before
 * the frontend reads from the API. Every record is written to SQLite with
 * `source = 'seed'`. Real Monday data (source = 'monday') will replace it later.
 *
 * This module contains DATA ONLY — no database calls, no HTTP, no Monday code, no
 * scraping of the HTML. It is meant to be read and checked by a human against the
 * frontend.
 *
 * Fidelity notes (prototype behaviour preserved verbatim — see CLAUDE.md §24):
 *   - Business Address carries REAL authored lease dates (occupancy derives from the
 *     SUM of tenant lease areas — no explicit percentage).
 *   - Town Center carries an EXPLICIT leased percentage per category (retail 0.40,
 *     office 0.69); its tenant list is a SEPARATE dataset that does NOT drive those
 *     headline percentages, and its buildings are a THIRD dataset. These three
 *     sources are intentionally NOT reconciled here.
 *   - Town Center tenants have NO authored lease dates. The live frontend fills them
 *     via a deterministic hash-of-name function whose ABSOLUTE date depends on the
 *     run day (`new Date()`), so it is not reproducible across days. To keep the seed
 *     DETERMINISTIC (Option C), the normalizer reproduces the same hash → `daysAgo`
 *     offset against the FIXED `mockDateAnchor` below. Such leases are flagged
 *     `mockDate: true` and are PROTOTYPE-DERIVED, never real lease dates.
 *   - Duplicate tenant names (Malath, LABOCCA, Luna Pilates Studio, Al Tharwah Co.,
 *     Mini's Toy Store, …) are SEPARATE leases and are kept as separate rows.
 *
 * Leases are listed in the SAME ORDER as the frontend arrays; that order is
 * significant — it defines each lease's deterministic `source_record_key`
 * (seed:lease:<slug>:<categoryCode>:<NNN>) and the mock-date index.
 */

module.exports = {
  source: 'seed',
  seedVersion: 1,

  // Fixed reference date used to reproduce the prototype's deterministic mock lease
  // dates (Town Center only). Equals the documented "current" date so the seeded
  // dates match what the live frontend renders as of that day. Prototype-derived.
  mockDateAnchor: '2026-07-15',

  projects: [
    // ─── BUSINESS ADDRESS ─────────────────────────────────────────────────────
    {
      slug: 'business-address',
      name: 'Business Address',
      address: '1200 Business Boulevard, Financial District',
      categories: [
        { code: 'retail', label: 'Retail',  totalArea: 1892,  occupancySource: 'leases', explicitLeasedPct: null, sortOrder: 0 },
        { code: 'office', label: 'Offices', totalArea: 11267, occupancySource: 'leases', explicitLeasedPct: null, sortOrder: 1 },
      ],
      // Retail (7) — real authored lease dates.
      leases: [
        { categoryCode: 'retail', tenantName: 'Tita',                tenantType: 'Restaurant', area: 317.71, leaseDate: '2026-05-20' },
        { categoryCode: 'retail', tenantName: 'Four Spa',            tenantType: 'Retail',     area: 150.33, leaseDate: '2026-06-14' },
        { categoryCode: 'retail', tenantName: 'Luna Pilates Studio', tenantType: 'Retail',     area: 142.66, leaseDate: '2026-02-11' },
        { categoryCode: 'retail', tenantName: 'Luna Pilates Studio', tenantType: 'Retail',     area: 56.45,  leaseDate: '2026-06-28' },
        { categoryCode: 'retail', tenantName: 'LABOCCA',             tenantType: 'Restaurant', area: 70.47,  leaseDate: '2025-11-03' },
        { categoryCode: 'retail', tenantName: 'Shiro Sushi',         tenantType: 'Restaurant', area: 183.50, leaseDate: '2026-04-22' },
        { categoryCode: 'retail', tenantName: 'LABOCCA',             tenantType: 'Restaurant', area: 70.31,  leaseDate: '2026-01-15' },
        // Offices (9) — real authored lease dates.
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 373.14, leaseDate: '2026-05-05' },
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 804.89, leaseDate: '2025-09-10' },
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 682.91, leaseDate: '2026-06-02' },
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 686.79, leaseDate: '2026-03-18' },
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 700.52, leaseDate: '2026-06-20' },
        { categoryCode: 'office', tenantName: 'Dalah Trane Co.', tenantType: 'Offices', area: 422.95, leaseDate: '2026-04-15' },
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 700.52, leaseDate: '2025-12-01' },
        { categoryCode: 'office', tenantName: 'Malath',          tenantType: 'Offices', area: 557.93, leaseDate: '2026-07-01' },
        { categoryCode: 'office', tenantName: 'Stream Offices',  tenantType: 'Offices', area: 361.54, leaseDate: '2026-02-28' },
      ],
      // Buildings + departments (from the Buildings workbook — a separate dataset).
      // Department codes mirror the frontend keys ('retail' / 'offices'). Departments
      // with total 0 are kept as data (the frontend hides total-0 departments at
      // render time; that filtering is presentation, not data). building total_area
      // is derived by the normalizer as the sum of its department totals.
      buildings: [
        { name: '1',    code: '1',    sortOrder: 0, departments: [ { code: 'retail', label: 'Retail', totalArea: 317.71, leasedArea: 317.71 }, { code: 'offices', label: 'Offices', totalArea: 4506.70, leasedArea: 4506.70 } ] },
        { name: '2',    code: '2',    sortOrder: 1, departments: [ { code: 'retail', label: 'Retail', totalArea: 293.63, leasedArea: 150.33 }, { code: 'offices', label: 'Offices', totalArea: 2161.72, leasedArea: 361.54 } ] },
        { name: '3',    code: '3',    sortOrder: 2, departments: [ { code: 'retail', label: 'Retail', totalArea: 373.02, leasedArea: 199.11 }, { code: 'offices', label: 'Offices', totalArea: 2522.76, leasedArea: 422.95 } ] },
        { name: '4',    code: '4',    sortOrder: 3, departments: [ { code: 'retail', label: 'Retail', totalArea: 259.76, leasedArea: 0 },      { code: 'offices', label: 'Offices', totalArea: 2076.19, leasedArea: 0 } ] },
        { name: '5',    code: '5',    sortOrder: 4, departments: [ { code: 'retail', label: 'Retail', totalArea: 506.93, leasedArea: 183.50 } ] },
        { name: 'C-06', code: 'C-06', sortOrder: 5, departments: [ { code: 'retail', label: 'Retail', totalArea: 70.47,  leasedArea: 70.47 } ] },
        { name: 'C-07', code: 'C-07', sortOrder: 6, departments: [ { code: 'retail', label: 'Retail', totalArea: 70.31,  leasedArea: 70.31 } ] },
      ],
    },

    // ─── TOWN CENTER ──────────────────────────────────────────────────────────
    {
      slug: 'town-center',
      name: 'Town Center',
      address: 'Town Center, Commercial District',
      categories: [
        // Explicit leased percentages drive Town Center headline KPIs (prototype).
        { code: 'retail', label: 'Commercial', totalArea: 14850, occupancySource: 'explicit_percentage', explicitLeasedPct: 0.40, sortOrder: 0 },
        { code: 'office', label: 'Offices',    totalArea: 9132,  occupancySource: 'explicit_percentage', explicitLeasedPct: 0.69, sortOrder: 1 },
      ],
      // Commercial/retail tenants (16) — NO authored dates → mock-dated (prototype).
      leases: [
        { categoryCode: 'retail', tenantName: 'Al Tamimi',           tenantType: 'Super Market', area: 3100,   mockDate: true, logoPath: 'logos/al-tamimi.png' },
        { categoryCode: 'retail', tenantName: 'Pizza Hut',           tenantType: 'F&B',          area: 158,    mockDate: true },
        { categoryCode: 'retail', tenantName: 'Shebbak Beirut',      tenantType: 'F&B',          area: 131.12, mockDate: true },
        { categoryCode: 'retail', tenantName: 'Vigin Telecom',       tenantType: 'Retail',       area: 99.21,  mockDate: true },
        { categoryCode: 'retail', tenantName: 'Happy Fitness',       tenantType: 'Retail',       area: 92.88,  mockDate: true },
        { categoryCode: 'retail', tenantName: 'Whoa Tea Café',       tenantType: 'F&B',          area: 99.21,  mockDate: true },
        { categoryCode: 'retail', tenantName: 'Kun 2 Fitness',       tenantType: 'GYM',          area: 295.57, mockDate: true },
        { categoryCode: 'retail', tenantName: 'FunQuest',            tenantType: 'FEC',          area: 330.13, mockDate: true },
        { categoryCode: 'retail', tenantName: 'Aster Pharmacy',      tenantType: 'Retail',       area: 297,    mockDate: true },
        { categoryCode: 'retail', tenantName: 'Lushlines Saloon',    tenantType: 'Retail',       area: 174.90, mockDate: true },
        { categoryCode: 'retail', tenantName: 'Shadow Beauty Salon', tenantType: 'Retail',       area: 153.31, mockDate: true },
        { categoryCode: 'retail', tenantName: "Mini's Toy Store",    tenantType: 'Retail',       area: 298.84, mockDate: true },
        { categoryCode: 'retail', tenantName: "Mini's Toy Store",    tenantType: 'Retail',       area: 161,    mockDate: true },
        { categoryCode: 'retail', tenantName: "Mini's Toy Store",    tenantType: 'Retail',       area: 177.32, mockDate: true },
        { categoryCode: 'retail', tenantName: "5 Sec's Saloon",      tenantType: 'Retail',       area: 134.69, mockDate: true },
        { categoryCode: 'retail', tenantName: 'Yellow Spa',          tenantType: 'Retail',       area: 236.63, mockDate: true },
        // Offices tenants (40) — NO authored dates → mock-dated (prototype).
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 134.33, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 123.55, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 97.39,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 118.05, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 127.19, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 154.87, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 155.21, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 117.45, mockDate: true },
        { categoryCode: 'office', tenantName: 'Jussyr Al Imdad',            tenantType: 'Offices', area: 118.80, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 193.87, mockDate: true, logoPath: 'logos/tharwah_logo.png' },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 186.11, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 136.42, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 171.27, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 175.05, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 217.32, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 193.84, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 186.11, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 136.42, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 171.30, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 217.36, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 226.65, mockDate: true },
        { categoryCode: 'office', tenantName: 'Sustainable Profit Co.',     tenantType: 'Offices', area: 94.86,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Sustainable Profit Co.',     tenantType: 'Offices', area: 82.78,  mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Constructions Co.', tenantType: 'Offices', area: 75.86,  mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Constructions Co.', tenantType: 'Offices', area: 98.86,  mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Pillars Co.',       tenantType: 'Offices', area: 105.13, mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Architects Co.',    tenantType: 'Offices', area: 100.99, mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Architects Co.',    tenantType: 'Offices', area: 99.23,  mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Pillars Co.',       tenantType: 'Offices', area: 95.82,  mockDate: true },
        { categoryCode: 'office', tenantName: 'The Four Constructions Co.', tenantType: 'Offices', area: 98.61,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 95.50,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 104.48, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 140.17, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 52.24,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 99.19,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 107.28, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 141.25, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 118.15, mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 91.14,  mockDate: true },
        { categoryCode: 'office', tenantName: 'Al Tharwah Co.',             tenantType: 'Offices', area: 111.86, mockDate: true },
      ],
      // Buildings + departments (7). Building 1 offices has total 0 (kept as data).
      buildings: [
        { name: '1', code: '1', sortOrder: 0, departments: [ { code: 'retail', label: 'Retail', totalArea: 8553.86, leasedArea: 3680.42 }, { code: 'offices', label: 'Offices', totalArea: 0,       leasedArea: 0 } ] },
        { name: '2', code: '2', sortOrder: 1, departments: [ { code: 'retail', label: 'Retail', totalArea: 1159.72, leasedArea: 625.70 },  { code: 'offices', label: 'Offices', totalArea: 399.90,  leasedArea: 0 } ] },
        { name: '3', code: '3', sortOrder: 2, departments: [ { code: 'retail', label: 'Retail', totalArea: 627.13,  leasedArea: 297.00 },  { code: 'offices', label: 'Offices', totalArea: 399.90,  leasedArea: 0 } ] },
        { name: '4', code: '4', sortOrder: 3, departments: [ { code: 'retail', label: 'Retail', totalArea: 1137.45, leasedArea: 328.21 },  { code: 'offices', label: 'Offices', totalArea: 1998.98, leasedArea: 0 } ] },
        { name: '5', code: '5', sortOrder: 4, departments: [ { code: 'retail', label: 'Retail', totalArea: 1139.87, leasedArea: 771.85 },  { code: 'offices', label: 'Offices', totalArea: 1998.98, leasedArea: 1998.98 } ] },
        { name: '6', code: '6', sortOrder: 5, departments: [ { code: 'retail', label: 'Retail', totalArea: 1089.05, leasedArea: 236.63 },  { code: 'offices', label: 'Offices', totalArea: 2141.30, leasedArea: 2141.30 } ] },
        { name: '7', code: '7', sortOrder: 6, departments: [ { code: 'retail', label: 'Retail', totalArea: 1142.52, leasedArea: 0 },       { code: 'offices', label: 'Offices', totalArea: 2192.94, leasedArea: 2192.94 } ] },
      ],
    },
  ],
};
