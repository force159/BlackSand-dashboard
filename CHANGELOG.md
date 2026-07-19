# Changelog

All notable changes to the BlackSand Executive Leasing Dashboard. This project follows
[Semantic Versioning](https://semver.org/). Dates are UTC.

## [1.0.0] — 2026-07-19

First production release. A single-screen executive leasing dashboard with a local
Express host, an embedded SQLite store, a live (gated) Monday.com data source, an
immutable historical snapshot engine with read-only analytics, a historical dashboard UI,
and production operations (config validation, logging, PM2, backup/restore).

### Highlights (Phases 1–9.4)
- **Frontend (standalone + served):** self-contained `Project Dashboard.html` — occupancy
  centrepiece, KPIs, leasing velocity, per-building occupancy, tenant directory, top
  tenants; rem-based 1920×1080 scaling; adaptive quality (full/reduced/static) for weak
  TVs; live data via `/api/dashboard` with 5-minute polling and demo mode for `file://`.
- **Backend:** SQLite foundation (WAL, FK on, migrations to schema v6), a repeatable dev
  seed, and a read-only JSON API (`/api/dashboard`, `/api/sync/status`).
- **Monday.com:** full offline-tested integration; live, read-only-against-Monday sync
  that writes SQLite atomically with source cutover (seed rows preserved). The server
  never auto-syncs — a sync is a gated, CLI-only, `--confirm` action.
- **History (9.1–9.2):** immutable per-Riyadh-day snapshots, an automatic daily scheduler
  with startup recovery + post-sync capture, and read-only comparison / trend / tenant /
  executive-insight analytics APIs.
- **Historical dashboard (9.3):** a read-only Historical Analytics workspace (Executive
  Overview, Portfolio Trends, Building Analytics, Tenant Analytics, Snapshot Comparison,
  Data Quality) that renders backend values/insights verbatim — no business logic in the
  browser.
- **Production readiness (9.4A):** environment-driven configuration with startup
  validation (fail-closed in production), a centralized secret-redacting logger, safe
  headers, an enriched `/health`, process-level error handling, graceful shutdown, a PM2
  `ecosystem.config.js` (single-writer), and `backup`/`restore`/`lint` scripts.

### Certification (9.4B)
- **282** automated tests pass (`npm test`); `npm run verify` green; `npm run lint` clean.
- End-to-end verified: startup ~1.3 s, all API endpoints < 6 ms, ~59 MB RSS at idle;
  restart preserves data (identical `dataVersion`) and the scheduler resumes; repeated
  snapshots are idempotent with `integrity_check = ok` and 0 FK violations.
- Production scenarios verified: fresh install auto-seeds; invalid config and unwritable
  DB **fail closed**; live Monday mapping + dry-run succeed read-only (zero writes).
- Security verified: no tracked secrets; private paths 404; generic error bodies (no
  stack/path/SQL); safe headers; secrets redacted from logs; no debug routes.
- No Critical or Major defects. See `RELEASE_CHECKLIST.md` and `CLAUDE.md` §42.

### Invariants preserved
Tenant count = lease rows; per-project authoritative source (seed vs monday) never mixed;
Town Center / Business Address / C06–C07 building rules unchanged; historical data
immutable; one Node process owns SQLite.

### Known limitations (documented, not defects)
Rent and lease-expiry analytics are unavailable (not in the source) and shown with the
reason; tenant movement is low-confidence (normalized-name identity); external CDN assets
(fonts, Chart.js, Three.js) require internet; on-hardware TV validation and a full ESLint
setup are future items.

[1.0.0]: https://github.com/force159/BlackSand-dashboard/releases/tag/v1.0.0
