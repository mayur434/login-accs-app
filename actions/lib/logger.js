/**
 * Structured logger with UUID correlation for actions and database calls.
 *
 * Provides:
 *   - actionStart / actionEnd   — log action entry and exit with a unique traceId
 *   - dbStart / dbEnd           — log database query entry and exit with query details
 *
 * Every start/end pair shares the same UUID so they can be correlated.
 */

const crypto = require('crypto')

function generateTraceId () {
  return crypto.randomUUID()
}

function iso () {
  return new Date().toISOString()
}

// ── Action-level logging ────────────────────────────────────────────────

/**
 * Log the start of an action.
 * @param {object} logger  – Core.Logger instance
 * @param {string} actionName
 * @param {object} [meta]  – extra metadata (e.g. operation, method)
 * @returns {string} traceId (pass to actionEnd)
 */
function actionStart (logger, actionName, meta = {}) {
  const traceId = generateTraceId()
  logger.info(JSON.stringify({
    traceId,
    phase: 'ACTION_START',
    action: actionName,
    timestamp: iso(),
    ...meta
  }))
  return traceId
}

/**
 * Log the end of an action.
 * @param {object} logger
 * @param {string} traceId – same id returned by actionStart
 * @param {string} actionName
 * @param {object} [meta]  – extra metadata (e.g. statusCode, error)
 */
function actionEnd (logger, traceId, actionName, meta = {}) {
  logger.info(JSON.stringify({
    traceId,
    phase: 'ACTION_END',
    action: actionName,
    timestamp: iso(),
    ...meta
  }))
}

// ── Database-level logging ──────────────────────────────────────────────

/**
 * Log the start of a database operation.
 * @param {object} logger
 * @param {string} parentTraceId – action-level traceId for correlation
 * @param {string} operation     – e.g. 'findOne', 'insertOne', 'updateOne', 'deleteOne'
 * @param {string} collection    – collection / table name
 * @param {object} [details]     – query filter, update fields, options, etc.
 * @returns {string} dbTraceId (pass to dbEnd)
 */
function dbStart (logger, parentTraceId, operation, collection, details = {}) {
  const dbTraceId = generateTraceId()
  logger.info(JSON.stringify({
    traceId: dbTraceId,
    parentTraceId,
    phase: 'DB_START',
    operation,
    collection,
    timestamp: iso(),
    ...sanitizeDetails(details)
  }))
  return dbTraceId
}

/**
 * Log the end of a database operation.
 * @param {object} logger
 * @param {string} dbTraceId – same id returned by dbStart
 * @param {string} parentTraceId
 * @param {string} operation
 * @param {string} collection
 * @param {object} [meta] – e.g. { success: true } or { error: 'msg' }
 */
function dbEnd (logger, dbTraceId, parentTraceId, operation, collection, meta = {}) {
  logger.info(JSON.stringify({
    traceId: dbTraceId,
    parentTraceId,
    phase: 'DB_END',
    operation,
    collection,
    timestamp: iso(),
    ...meta
  }))
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Remove sensitive field values from logged details (passwords, tokens, etc.)
 */
function sanitizeDetails (details) {
  if (!details || typeof details !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(details)) {
    if (/password|secret|token|api.key/i.test(key)) {
      out[key] = '<redacted>'
    } else {
      out[key] = value
    }
  }
  return { details: out }
}

module.exports = {
  generateTraceId,
  actionStart,
  actionEnd,
  dbStart,
  dbEnd
}
