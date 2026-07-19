'use strict';
/**
 * BlackSand dashboard — read-only sync status route (Phase 3).
 *
 * GET /api/sync/status → seed/sync provenance telemetry (last successful sync, last
 * attempted, last data change, dataVersion, counts). Read-only; no write routes.
 * There is no Monday sync yet, so syncInProgress is always false.
 */

const express = require('express');
const { getDatabase } = require('../db/connection');
const { buildSyncStatus } = require('../services/dashboard-service');

const router = express.Router();

router.get('/sync/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDatabase();
    const result = buildSyncStatus(db);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error(`GET /api/sync/status failed: ${err.message}`);
    return res.status(500).json({ error: 'internal-error', message: 'Sync status is temporarily unavailable.' });
  }
});

module.exports = router;
