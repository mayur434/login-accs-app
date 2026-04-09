/**
 * Standardized HTTP response helpers for all actions.
 */

function success (body) {
  return { statusCode: 200, body }
}

function badRequest (message) {
  return { statusCode: 400, body: { error: message } }
}

function unauthorized (message) {
  return { statusCode: 401, body: { error: message } }
}

function forbidden (message) {
  return { statusCode: 403, body: { error: message } }
}

function notFound (message) {
  return { statusCode: 404, body: { error: message } }
}

function methodNotAllowed (message) {
  return { statusCode: 405, body: { error: message } }
}

function conflict (message) {
  return { statusCode: 409, body: { error: message } }
}

function serverError (message = 'server error') {
  return { statusCode: 500, body: { error: message } }
}

/**
 * Returns an error response in the legacy wrapper format.
 * Optionally logs the status + message via logger.info().
 */
function errorResponse (statusCode, message, logger) {
  if (logger && typeof logger.info === 'function') {
    logger.info(`${statusCode}: ${message}`)
  }
  return { statusCode, body: { error: message } }
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
