'use strict';
/**
 * Phase 9.4A — PRODUCTION profile. Strict defaults for a server deployment. These are
 * applied by config/index.js only when NODE_ENV === 'production'. They do not override an
 * explicitly-set environment variable (env always wins); they fill sensible production
 * defaults and mark the profile strict so validation problems are fatal.
 */
module.exports = {
  name: 'production',
  strict: true,                 // validation problems abort startup
  defaults: {
    host: '0.0.0.0',            // reachable on the LAN for office TVs
    port: 3000,
    logLevel: 'info',           // quiet-but-useful; DEBUG is opt-in
    snapshotSchedule: '02:00',  // Riyadh daily snapshot time (HISTORY_SNAPSHOT_TIME)
    timezone: 'Asia/Riyadh',
  },
};
