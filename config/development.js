'use strict';
/**
 * Phase 9.4A — DEVELOPMENT profile. Lenient defaults for local work. Applied by
 * config/index.js when NODE_ENV !== 'production'. Validation problems are reported as
 * warnings (non-fatal) so a developer can iterate without a fully-provisioned environment.
 */
module.exports = {
  name: 'development',
  strict: false,               // validation problems are warnings, not fatal
  defaults: {
    host: '0.0.0.0',
    port: 3000,
    logLevel: 'debug',         // verbose locally
    snapshotSchedule: '02:00',
    timezone: 'Asia/Riyadh',
  },
};
