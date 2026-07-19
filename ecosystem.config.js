// Phase 9.4A — PM2 process management for the BlackSand dashboard server.
//
// Start:            pm2 start ecosystem.config.js --env production
// Save + reboot:    pm2 save && pm2 startup   (run the printed command once, as admin)
// Logs / status:    pm2 logs blacksand-dashboard   |   pm2 status
// Reload/restart:   pm2 reload blacksand-dashboard  (graceful)  |  pm2 restart blacksand-dashboard
//
// IMPORTANT: instances MUST stay 1. SQLite (better-sqlite3) is a single-writer embedded
// database — exactly one Node process may own it (CLAUDE §23.1). Never use cluster mode or
// instances > 1, or the historical scheduler + writes would race across processes.
module.exports = {
  apps: [
    {
      name: 'blacksand-dashboard',
      script: 'server/server.js',
      cwd: __dirname,

      instances: 1,               // SINGLE writer — do not increase
      exec_mode: 'fork',          // never 'cluster' (would fork multiple DB owners)

      autorestart: true,          // restart on crash
      max_restarts: 10,
      exp_backoff_restart_delay: 2000,   // back off if it keeps crashing
      max_memory_restart: '512M', // restart if memory grows beyond this

      // Give the app time to run its graceful shutdown (stop scheduler → wait for any active
      // snapshot → close SQLite). Our shutdown budget is ~2.5–3s; allow a comfortable margin.
      kill_timeout: 8000,
      listen_timeout: 10000,

      // Operational logs (in addition to the app's own logs/dashboard.log). Rotated by
      // pm2-logrotate if installed. logs/ is gitignored.
      time: true,                 // prefix PM2 log lines with a timestamp
      merge_logs: true,
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        // PORT / HOST / SQLITE_DB_PATH / MONDAY_* / HISTORY_* come from the server's .env
        // (loaded by server/config/load-env). Do NOT put secrets here — this file is committed.
      },
    },
  ],
};
