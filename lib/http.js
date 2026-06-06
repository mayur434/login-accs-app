/**
 * Standardized HTTP response helpers for all actions.
 */

function success (body) {
  return { statusCode: 200, body }
}

function badRequest (message) {
  return { statusCode: 200, body: { success: false, statusCode: 400, error: message, message } }
}

function unauthorized (message) {
  return { statusCode: 200, body: { success: false, statusCode: 401, error: message, message } }
}

function forbidden (message) {
  return { statusCode: 200, body: { success: false, statusCode: 403, error: message, message } }
}

function notFound (message) {
  return { statusCode: 200, body: { success: false, statusCode: 404, error: message, message } }
}

function methodNotAllowed (message) {
  return { statusCode: 200, body: { success: false, statusCode: 405, error: message, message } }
}

function conflict (message) {
  return { statusCode: 200, body: { success: false, statusCode: 409, error: message, message } }
}

function serverError (message = 'server error') {
  return { statusCode: 200, body: { success: false, statusCode: 500, error: message, message } }
}

/**
 * Returns an error response. Always 200 to prevent Mesh from exposing internals.
 * Error is in both `error` and `message` so it's always visible in the response.
 */
function errorResponse (statusCode, message, logger) {
  if (logger && typeof logger.info === 'function') {
    logger.info(`${statusCode}: ${message}`)
  }
  return { statusCode: 200, body: { success: false, statusCode, error: message, message } }
}

module.exports = {
  success,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  serverError,
  errorResponse
}
