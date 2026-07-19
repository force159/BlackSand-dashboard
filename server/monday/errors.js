'use strict';
/**
 * BlackSand dashboard — Monday integration typed errors (Phase 6).
 *
 * Every Monday-layer failure is a typed error carrying an actionable `code`, a safe
 * human `message`, and an optional `details` bag (NEVER secrets — see logger.js for
 * redaction). Callers/tests switch on `err.code` or `instanceof`. No network here.
 */

class MondayError extends Error {
  constructor(message, { code = 'MONDAY_ERROR', details = null, retryable = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
  toJSON() {
    // Safe serialization for logs/health — never includes secrets or stack traces.
    return { name: this.name, code: this.code, message: this.message, retryable: this.retryable, details: this.details };
  }
}

// Configuration is missing/invalid (e.g. no token, no board IDs, bad mapping file).
class ConfigurationError extends MondayError {
  constructor(message, details) { super(message, { code: 'CONFIGURATION_ERROR', details, retryable: false }); }
}
// Monday rejected credentials (401/403). Not retryable until the token is fixed.
class AuthenticationError extends MondayError {
  constructor(message, details) { super(message, { code: 'AUTHENTICATION_ERROR', details, retryable: false }); }
}
// Request exceeded the configured timeout.
class TimeoutError extends MondayError {
  constructor(message, details) { super(message, { code: 'TIMEOUT_ERROR', details, retryable: true }); }
}
// Monday complexity/rate limit hit (429 / complexity budget). Retryable after backoff.
class RateLimitError extends MondayError {
  constructor(message, details) { super(message, { code: 'RATE_LIMIT_ERROR', details, retryable: true }); }
}
// Transport/connectivity failure (DNS, socket, offline).
class NetworkError extends MondayError {
  constructor(message, details) { super(message, { code: 'NETWORK_ERROR', details, retryable: true }); }
}
// The Monday API response did not match the expected GraphQL schema/shape.
class SchemaMismatchError extends MondayError {
  constructor(message, details) { super(message, { code: 'SCHEMA_MISMATCH_ERROR', details, retryable: false }); }
}
// A canonical record failed validation (bad area, missing name, dup id, …).
class ValidationError extends MondayError {
  constructor(message, details) { super(message, { code: 'VALIDATION_ERROR', details, retryable: false }); }
}
// Mapping a raw Monday item → canonical field failed (unknown column, bad coercion).
class TransformError extends MondayError {
  constructor(message, details) { super(message, { code: 'TRANSFORM_ERROR', details, retryable: false }); }
}
// A database write/transaction failed; the sync transaction rolls back.
class PersistenceError extends MondayError {
  constructor(message, details) { super(message, { code: 'PERSISTENCE_ERROR', details, retryable: false }); }
}
// Phase-6 guard: the network transport is intentionally disabled (no live Monday yet).
class NetworkDisabledError extends MondayError {
  constructor(message = 'Monday network access is disabled (Phase 6: offline foundation only).', details) {
    super(message, { code: 'NETWORK_DISABLED', details, retryable: false });
  }
}

module.exports = {
  MondayError,
  ConfigurationError,
  AuthenticationError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  SchemaMismatchError,
  ValidationError,
  TransformError,
  PersistenceError,
  NetworkDisabledError,
};
