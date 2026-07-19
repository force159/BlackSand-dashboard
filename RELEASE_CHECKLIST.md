# Release Checklist — v1.0.0 (Phase 9.4B Final QA)

Certification that the BlackSand dashboard is ready for production. Evidence was gathered
on 2026-07-19 (Node v24.18.0, npm 11.16.0, Windows) against a **disposable copy** of the
live database — the real database was never modified. No new features were added; no
production defects required fixing.

Legend: **PASS** verified this phase · **N/A** not applicable.

## Release gates
| Gate | Status | Evidence |
|---|---|---|
| Tests passed | **PASS** | `npm test` → **282/282**, 0 failures (seed 28, api 11, frontend 71, production 14, monday 49, history 109). |
| Lint clean | **PASS** | `npm run lint` → 127 files parse. |
| Consolidated verify | **PASS** | `npm run verify` → all stages green. |
| Configuration verified | **PASS** | Valid prod config boots; invalid (`LOG_LEVEL`, `TIMEZONE`) + unwritable DB **fail closed** with clear messages. |
| Backup verified | **PASS** | `npm run backup` → integrity-checked copy; `npm run restore --confirm` validates + safety-copies before restore. |
| Scheduler verified | **PASS** | `/api/history/status` → automation enabled, running, next run scheduled; resumes after restart. |
| Health endpoint verified | **PASS** | `/health` → `status:ok`, version, environment, uptime, `database:ready`, `scheduler:running`. |
| PM2 verified | **PASS (config)** | `ecosystem.config.js`: 1 instance, fork, autorestart, 512M, kill_timeout. Reboot persistence via `pm2 save`+`pm2 startup` (documented). |
| Monday sync verified | **PASS (read-only)** | Live `monday:mapping:check` + `validate-live` OK; live dry-run: TC 129/72 active, BA 40/20 active, 0 warnings, candidate `dataVersion` matches stored — **zero writes**. |
| Documentation complete | **PASS** | README (incl. env-vars table + production), DEPLOYMENT_CHECKLIST, CHANGELOG, .env.example, CLAUDE.md §§1–42. |
| Git repository clean | **PASS** | `git status` clean before tagging; release artifacts committed. |

## Part 1 — Regression (all PASS)
Monday sync (offline + live read-only), snapshot creation/storage, historical comparisons,
executive summaries, building analytics, tenant analytics, dashboard UI, historical
filters, API endpoints, scheduler execution, and DB migrations (fresh → v6, idempotent
re-run, v4→v6 upgrade preserves data) — all covered by the 282-test suite + verify.

## Part 2 — End-to-end (PASS)
Sync (live dry-run) → snapshot → stored (immutable) → dashboard loads (2 projects, live
source) → historical comparison → executive summary (5 insights, correct scoping) → charts
→ **restart** → **persistence** (identical `dataVersion 86441bbea5`) → **scheduler resumes**.

## Part 3 — Production environment (PASS)
Fresh install auto-seeds (117 records); existing DB upgrades safely (v4→v6, data
preserved); missing env vars fall back to documented defaults; invalid config aborts;
DB-unavailable aborts; Monday-API-unavailable handled (offline dry-run fixture + 401 fast-
fail test); network interruption → frontend degraded/retry (covered by client tests);
server reboot / process restart → data persists + scheduler resumes.

## Part 4 — Performance (recorded)
| Metric | Result |
|---|---|
| Startup → `/health` ready | ~1.3 s |
| `GET /` | ~4.8 ms |
| `GET /api/dashboard` | ~3.7 ms |
| `GET /api/history/executive-summary` | ~5.7 ms |
| `GET /api/history/trend` / `status` | ~2.3 / 2.5 ms |
| `GET /api/history/snapshots/:date/buildings` | ~3.7 ms |
| Snapshot execution | ~a few ms/project (idempotent duplicate-skip near-instant) |
| Monday live dry-run (both boards, full pipeline) | a few seconds (network-bound), 0 writes |
| Memory (idle) | ~59 MB RSS / ~61 MB private · CPU ~0.31 s |

## Part 5 — Reliability (PASS)
3 repeated snapshot runs → all `duplicate_skipped`, no new rows; `integrity_check = ok`;
`foreign_key_check` = 0 violations. Graceful shutdown is code-implemented (stop scheduler →
await active capture → close SQLite) and covered by the scheduler `awaitIdle`/CP7 tests;
triggered by SIGINT/SIGTERM (PM2/Linux) — a Windows hard `taskkill /F` bypasses it (OS
limitation, not a defect).

## Part 6 — Security (PASS)
No tracked secrets (`.env`, real mapping, `*.db*`, `node_modules/`, `logs/` gitignored; no
token strings in tracked files). Private paths (`/server/…`, `/.env`, `/data/…`) → 404;
unknown `/api` → JSON 404; bad input → 400 with generic messages (no stack/path/SQL). Safe
headers present; `x-powered-by` removed. No server debug/admin routes. Secrets redacted
from logs. Production config fails closed.

## Part 9 — Bug review
| Severity | Count | Notes |
|---|---|---|
| Critical | 0 | — |
| Major | 0 | — |
| Minor | 0 | — |
| Cosmetic | 1 | `.env` uses the deprecated `MONDAY_API_TOKEN` alias → a one-time value-free warning. Rename to `MONDAY_API_KEY` to silence. Not a code defect. |

No Critical or Major defects → **release is not blocked**.

## Sign-off
All acceptance criteria met: regression passes, no Critical/Major defects, historical
dashboard + scheduler + Monday sync work, production deployment succeeds, documentation
complete, repository clean. **v1.0.0 is ready.** The release tag (`v1.0.0`) is prepared but
**not created/pushed** — awaiting explicit user approval.
