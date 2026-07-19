'use strict';
/**
 * BlackSand dashboard — read-only dashboard API routes (Phase 3).
 *
 * GET /api/dashboard              → all projects + meta (the frontend's live source).
 * GET /api/dashboard/projects/:slug → a single project (optional convenience).
 *
 * Thin: parses the request, calls the dashboard service, sets no-store, returns JSON.
 * Errors return a SAFE generic message — never a stack trace, DB path, or SQL detail.
 * Read-only: there are no write routes here.
 */

const express = require('express');
const { getDatabase } = require('../db/connection');
const { buildDashboardPayload } = require('../services/dashboard-service');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDatabase();
    const result = buildDashboardPayload(db);
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error(`GET /api/dashboard failed: ${err.message}`);
    return res.status(500).json({ error: 'internal-error', message: 'Dashboard data is temporarily unavailable.' });
  }
});

router.get('/dashboard/projects/:slug', (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDatabase();
    const result = buildDashboardPayload(db);
    if (!result.ok) return res.status(result.status).json(result.body);
    const slug = String(req.params.slug || '').toLowerCase();
    const project = result.body.data.projects.find((p) => p.slug === slug);
    if (!project) {
      return res.status(404).json({ error: 'not-found', message: 'Unknown project.' });
    }
    return res.status(200).json({ data: { project }, meta: result.body.meta });
  } catch (err) {
    console.error(`GET /api/dashboard/projects/:slug failed: ${err.message}`);
    return res.status(500).json({ error: 'internal-error', message: 'Dashboard data is temporarily unavailable.' });
  }
});

module.exports = router;
