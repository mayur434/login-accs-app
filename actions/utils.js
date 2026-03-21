/*
 * Common utilities for actions.
 *
 * Re-exports shared helpers from actions/lib/ so existing consumers
 * (tests, etc.) continue to work unchanged.
 */

const { errorResponse } = require('./lib/http')

// ── Logging ─────────────────────────────────────────────────────────────

function stringParameters (params) {
  let headers = params.__ow_headers || {}
  if (headers.authorization) {
    headers = { ...headers, authorization: '<hidden>' }
  }
  return JSON.stringify({ ...params, __ow_headers: headers })
}

// ── Validation ──────────────────────────────────────────────────────────

function getMissingKeys (obj, required) {
  return required.filter(r => {
    const splits = r.split('.')
    const last = splits[splits.length - 1]
    const traverse = splits.slice(0, -1).reduce((tObj, split) => { tObj = (tObj[split] || {}); return tObj }, obj)
    return traverse[last] === undefined || traverse[last] === ''
  })
}

function checkMissingRequestInputs (params, requiredParams = [], requiredHeaders = []) {
  let errorMessage = null

  requiredHeaders = requiredHeaders.map(h => h.toLowerCase())
  const missingHeaders = getMissingKeys(params.__ow_headers || {}, requiredHeaders)
  if (missingHeaders.length > 0) {
    errorMessage = `missing header(s) '${missingHeaders}'`
  }

  const missingParams = getMissingKeys(params, requiredParams)
  if (missingParams.length > 0) {
    if (errorMessage) {
      errorMessage += ' and '
    } else {
      errorMessage = ''
    }
    errorMessage += `missing parameter(s) '${missingParams}'`
  }

  return errorMessage
}

// ── Token helpers ───────────────────────────────────────────────────────

function getBearerToken (params) {
  if (params.__ow_headers &&
      params.__ow_headers.authorization &&
      params.__ow_headers.authorization.startsWith('Bearer ')) {
    return params.__ow_headers.authorization.substring('Bearer '.length)
  }
  return undefined
}

// ── Mobile normalization ────────────────────────────────────────────────

function normalizeMobile (mobile) {
  const digitsOnly = String(mobile || '').replace(/\D/g, '')

  let localMobile = digitsOnly
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    localMobile = digitsOnly.slice(2)
  }

  if (!/^([6-9]\d{9})$/.test(localMobile)) {
    throw new Error('invalid indian mobile number')
  }

  return `+91${localMobile}`
}

module.exports = {
  errorResponse,
  getBearerToken,
  normalizeMobile,
  stringParameters,
  checkMissingRequestInputs
}
