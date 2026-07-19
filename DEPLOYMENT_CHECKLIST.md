# Production Deployment Checklist — BlackSand Dashboard (Phase 9.4A)

A step-by-step runbook for deploying the dashboard on the company server under PM2.
Nothing here changes business logic — it is operational setup only. Work top to bottom;
do not skip the verification steps.

> **Golden rules**
> - Exactly **one** Node process owns the SQLite database. PM2 runs **1 instance, fork mode**.
> - **Never commit** `.env`, the database (`*.db*`), `node_modules/`, or `logs/`.
> - The Monday **token** lives only in `.env` (env-only, never logged). Board IDs live in
>   `config/monday-mapping.json` (gitignored).
> - Take a backup **before** any update or restore.

---

## 1. Install Node.js
- Install **Node.js 20 LTS or newer** (Node 24 recommended) on the server (includes `npm`).
- Verify: `node -v` and `npm -v`.
- `better-sqlite3` is a native module; a clean `npm install` compiles it for this machine.
  Do not copy `node_modules/` from another OS.

## 2. Clone the repository
- `git clone <repo-url> dashboard && cd dashboard` (or copy the project folder to the server).
- Confirm the tree is clean: `git status`.

## 3. Install dependencies
- `npm install` (installs `express` + `better-sqlite3`, compiles the native module).
- Optional but recommended: `npm install -g pm2`.

## 4. Configure `.env`
- `cp .env.example .env` (Windows: `copy .env.example .env`), then edit `.env`:
  - `NODE_ENV=production`  ← makes configuration validation strict.
  - `PORT=3000`, `HOST=0.0.0.0`.
  - `LOG_LEVEL=info`.
  - `SQLITE_DB_PATH=data/dashboard.db` (or an absolute path on a backed-up volume).
  - `HISTORY_SNAPSHOT_TIME=02:00`, `HISTORY_TIMEZONE=Asia/Riyadh`.
  - Monday (only if you will run a sync): `MONDAY_API_KEY=<token>`; keep
    `MONDAY_SYNC_ENABLED` unset/false for a read-only kiosk host (the server never
    auto-syncs — a sync is a separate, gated CLI action).
- Put the real Monday board/column IDs in `config/monday-mapping.json`
  (`cp config/monday-mapping.example.json config/monday-mapping.json`).
- **Verify `.env` is NOT tracked:** `git status --ignored | grep .env` should show it ignored.

## 5. Run migrations (and seed if empty)
- `npm run db:migrate` → creates/upgrades `data/dashboard.db` to the current schema (v6).
- `npm run db:check` → confirms schema + pragmas (FK on, WAL) with no changes.
- First run only: a plain `npm start` **auto-seeds** an empty DB with bootstrap data, or run
  `npm run db:seed` explicitly. (If Monday data is intended, run the gated `monday:sync` per
  the README once the mapping + token are set.)

## 6. Start under PM2
- `pm2 start ecosystem.config.js --env production`
- `pm2 save` (persist the process list).
- `pm2 startup` → run the printed command once (as administrator) so PM2 relaunches on reboot.
- `pm2 status` should show `blacksand-dashboard` **online**, `1` instance, mode `fork`.

## 7. Verify `/health`
- `curl http://localhost:3000/health` → `status:"ok"`, `environment:"production"`,
  a numeric `uptime`, `database:"ready"`, `scheduler:"running"` (or `disabled` if automation
  is off), and the app `version`.

## 8. Verify Monday sync (only if you use it)
- Read-only checks first: `npm run monday:mapping:check` then `npm run monday:mapping:validate-live`.
- Live read-only preview: `MONDAY_DRYRUN_LIVE=true npm run monday:dry-run` (zero writes).
- Gated write (manual): `MONDAY_SYNC_ENABLED=true MONDAY_DRY_RUN=false npm run monday:sync -- --confirm`.
- Confirm: `curl http://localhost:3000/api/sync/status` shows each project's `currentSource`.

## 9. Verify the scheduler
- `curl http://localhost:3000/api/history/status` → `automationEnabled`, `dailySnapshotTime`,
  `nextScheduledRunAt`, and the latest snapshot date.
- The daily snapshot runs at `HISTORY_SNAPSHOT_TIME` Asia/Riyadh; startup recovery captures
  **today** if the time has passed and today is not yet captured (prior days are never fabricated).

## 10. Verify snapshots
- Manual capture (safe, idempotent): `npm run history:snapshot` (or `:dry-run` to preview).
- `curl http://localhost:3000/api/history/dates` → the captured snapshot dates.

## 11. Verify the dashboard
- Open `http://<server-ip>:3000/?project=business-address` and `…?project=town-center`.
- Confirm live data renders (occupancy, KPIs, tenants, buildings) and the **History** button
  opens the Historical Analytics workspace with real data.
- For a TV/kiosk, use Edge kiosk mode (see README) pointed at the server's LAN IP.

---

## Post-deployment operations

- **Logs:** `pm2 logs blacksand-dashboard` (console) and `logs/dashboard.log` (JSON lines).
- **Backup (schedule this):** `npm run backup` → `data/backups/dashboard-<UTC>.db`
  (add `BACKUP_KEEP=N` to prune). Copy `data/backups/` to off-server storage regularly.
- **Restore:** stop the server (`pm2 stop blacksand-dashboard`), `npm run restore <file> --confirm`
  (it validates the backup and safety-copies the current DB first), then `pm2 start …`.
- **Update:** `git pull` → `npm install` (if deps changed) → `npm run db:migrate` →
  `npm run verify` → `pm2 reload blacksand-dashboard` (graceful) → refresh the kiosks.
- **Health monitoring:** poll `GET /health` (liveness) and/or `GET /ready` (DB ready).

## Rollback
- `pm2 stop blacksand-dashboard`
- Restore the last good DB backup (step above) if data is the problem.
- `git checkout <previous-good-commit>` for code, `npm install`, `npm run verify`, restart.

## Pre-flight (run on the server before going live)
```bash
npm run lint       # all source parses
npm run verify     # non-destructive checks + full offline test suite
npm run db:check   # schema + pragmas
curl localhost:3000/health   # after pm2 start
```
