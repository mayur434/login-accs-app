/**
 * Performance logger — DISABLED.
 * All functions are no-ops to eliminate DB write overhead.
 * Re-enable by restoring the original implementation if needed.
 */

const crypto = require('node:crypto')

function generateTraceId () {
  return crypto.randomUUID()
}

function actionStart () {}
function actionEnd () {}
function dbStart () { return '' }
function dbEnd () {}

module.exports = {
  LOGGER_COLLECTION: 'query_performance_logger',
  generateTraceId,
  actionStart,
  actionEnd,
  dbStart,
  dbEnd
}
