'use strict';
/**
 * BlackSand dashboard — Monday integration public surface (Phase 6).
 *
 * Single import point for the Monday layer. Also provides `getMondayHealth()`, which
 * returns BOOLEANS ONLY (never a token, board id, or path) for the health endpoints.
 */

const config = require('./config');
const errors = require('./errors');
const { createLogger } = require('./logger');
const { MondayClient, disabledTransport } = require('./client');
const { createFetchTransport } = require('./transport');
const status = require('./status');
const safety = require('./safety');
const graphql = require('./graphql');
const adapters = require('./adapters');
const mapper = require('./mapper');
const schema = require('./schema');
const { validateCanonicalDataset } = require('./validator');
const { transformCanonicalToRepositoryModel } = require('./transformer');
const diff = require('./diff-engine');
const persistence = require('./persistence');
const syncEngine = require('./sync-engine');

// Cache the loaded config (the mapping file is read once). Reloadable for tests.
let _cachedConfig = null;
function getConfig(reload) {
  if (!_cachedConfig || reload) {
    try { _cachedConfig = config.loadConfig(); }
    catch (e) { _cachedConfig = { __error: e.message, syncEnabled: false, hasApiKey: false, boardCount: 0, environment: 'unknown', mapping: null }; }
  }
  return _cachedConfig;
}

/**
 * Health snapshot — booleans only, safe to expose. `db` optional (writability check).
 */
function getMondayHealth(db) {
  const cfg = getConfig();
  const configValid = !cfg.__error;
  let repositoryAvailable = false;
  let sqliteWritable = false;
  try {
    // Repository layer is loadable and the projects table is queryable.
    require('../db/repositories/projects-repository');
    if (db) {
      db.prepare('SELECT 1 FROM projects LIMIT 1').get();
      repositoryAvailable = true;
      sqliteWritable = db.readonly === false; // better-sqlite3 exposes .readonly
    } else {
      repositoryAvailable = true;
    }
  } catch (e) { /* leave false */ }

  return {
    syncEnabled: Boolean(cfg.syncEnabled),
    configValid,
    environmentLoaded: Boolean(cfg.environment),
    repositoryAvailable,
    sqliteWritable,
    mondayConfigured: config.isConfigured(cfg),   // true/false only
    dryRun: Boolean(cfg.dryRun),
  };
}

module.exports = {
  config, errors, createLogger, MondayClient, disabledTransport, createFetchTransport, graphql, adapters,
  mapper, schema, status, safety, validateCanonicalDataset, transformCanonicalToRepositoryModel,
  diff, persistence, syncEngine,
  getConfig, getMondayHealth,
};
