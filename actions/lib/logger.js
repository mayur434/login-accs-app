/**
 * Structured logger that persists action and DB call traces
 * into the `query_performance_logger` table/collection.
 *
 * Every start/end pair shares the same UUID so they can be correlated.
 *
 * All writes use the raw dbClient (unwrapped) to avoid recursive logging.
 * Writes are fire-and-forget so they never block or break the main flow.
 */

const crypto = require('node:crypto')

const LOGGER_COLLECTION = 'query_performance_logger'

function generateTraceId () {
  return crypto.randomUUID()
}

function now () {
  return new Date()
}

/**
 * Insert a log row into query_performance_logger.
 * Fire-and-forget — errors are silently swallowed so logging never breaks the action.
 */
async function _persist (rawDbClient, row) {
  if (!rawDbClient) return
  try {
    const collection = await rawDbClient.collection(LOGGER_COLLECTION)
    await collection.insertOne(row)
  } catch (_) { /* never let logging break the action */ }
}

// ── Action-level logging ────────────────────────────────────────────────

/**
 * Log the start of an action → inserts ACTION_START row.
 * @param {object} rawDbClient – unwrapped dbClient (no logging wrapper)
 * @param {string} traceId     – pre-generated traceId
 * @param {string} actionName
 * @param {object} [meta]  – extra metadata (e.g. operation, method)
 */
function actionStart (rawDbClient, traceId, actionName, meta = {}) {
  _persist(rawDbClient, {
    trace_id: traceId,
    parent_trace_id: null,
    phase: 'ACTION_START',
    action_name: actionName,
    operation: meta.operation || meta.method || null,
    collection_name: null,
    status_code: null,
    success: null,
    error_message: null,
    details: sanitizeDetails(meta),
    timestamp: now()
  })
}

/**
 * Log the end of an action → inserts ACTION_END row.
 * @param {object} rawDbClient
 * @param {string} traceId – same id used in actionStart
 * @param {string} actionName
 * @param {object} [meta]  – extra metadata (e.g. statusCode, error)
 */
function actionEnd (rawDbClient, traceId, actionName, meta = {}) {
  _persist(rawDbClient, {
    trace_id: traceId,
    parent_trace_id: null,
    phase: 'ACTION_END',
    action_name: actionName,
    operation: meta.operation || meta.method || null,
    collection_name: null,
    status_code: meta.statusCode || null,
    success: !meta.error,
    error_message: meta.error || null,
    details: sanitizeDetails(meta),
    timestamp: now()
  })
}

// ── Database-level logging ──────────────────────────────────────────────

/**
 * Log the start of a database operation → inserts DB_START row.
 * @param {object} rawDbClient
 * @param {string} parentTraceId – action-level traceId for correlation
 * @param {string} operation     – e.g. 'findOne', 'insertOne', 'updateOne', 'deleteOne'
 * @param {string} collection    – collection / table name
 * @param {object} [details]     – query filter, update fields, options, etc.
 * @returns {string} dbTraceId (pass to dbEnd)
 */
function dbStart (rawDbClient, parentTraceId, operation, collection, details = {}) {
  const dbTraceId = generateTraceId()

  _persist(rawDbClient, {
    trace_id: dbTraceId,
    parent_trace_id: parentTraceId,
    phase: 'DB_START',
    action_name: null,
    operation,
    collection_name: collection,
    status_code: null,
    success: null,
    error_message: null,
    details: sanitizeDetails(details),
    timestamp: now()
  })

  return dbTraceId
}

/**
 * Log the end of a database operation → inserts DB_END row.
 * @param {object} rawDbClient
 * @param {string} dbTraceId – same id returned by dbStart
 * @param {string} parentTraceId
 * @param {string} operation
 * @param {string} collection
 * @param {object} [meta] – e.g. { success: true } or { error: 'msg' }
 */
function dbEnd (rawDbClient, dbTraceId, parentTraceId, operation, collection, meta = {}) {
  _persist(rawDbClient, {
    trace_id: dbTraceId,
    parent_trace_id: parentTraceId,
    phase: 'DB_END',
    action_name: null,
    operation,
    collection_name: collection,
    status_code: null,
    success: meta.success ?? null,
    error_message: meta.error || null,
    details: sanitizeDetails(meta),
    timestamp: now()
  })
}

// ── Internal helpers ────────────────────────────────────────────────────

/**
 * Remove sensitive field values from logged details (passwords, tokens, etc.)
 * Returns a plain object safe for JSON storage.
 */
function sanitizeDetails (details) {
  if (!details || typeof details !== 'object') return null
  const out = {}
  for (const [key, value] of Object.entries(details)) {
    if (/password|secret|token|api.key/i.test(key)) {
      out[key] = '<redacted>'
    } else if (value !== undefined && value !== null) {
      out[key] = value
    }
  }
  return Object.keys(out).length ? out : null
}

module.exports = {
  LOGGER_COLLECTION,
  generateTraceId,
  actionStart,
  actionEnd,
  dbStart,
  dbEnd
}
