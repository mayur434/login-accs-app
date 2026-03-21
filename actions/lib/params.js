/**
 * Shared request-parameter parsing helpers.
 */

/**
 * True when value is defined, non-null, and non-empty-string.
 */
function hasValue (v) {
  return v !== undefined && v !== null && String(v).trim() !== ''
}

/**
 * Normalize incoming action params – handles JSON body, __ow_body, and nested params object.
 */
function getRequestParams (params) {
  let req = params

  if (params.params && typeof params.params === 'object') {
    req = params.params
  } else if (params.body) {
    try {
      req = typeof params.body === 'string' ? JSON.parse(params.body) : params.body
    } catch {
      req = params
    }
  } else if (params.__ow_body) {
    try {
      req = typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body
    } catch {
      req = params
    }
  }

  return { ...params, ...req }
}

/**
 * Normalize common field aliases (mobile/mobile_number, firstName/firstname, etc.)
 * and infer loginType when not explicitly set.
 */
function normalizeRequestParams (req) {
  const out = { ...req }

  if (!out.mobile && out.mobile_number) out.mobile = out.mobile_number
  if (!out.mobile_number && out.mobile) out.mobile_number = out.mobile

  if (!out.firstname && out.firstName) out.firstname = out.firstName
  if (!out.firstName && out.firstname) out.firstName = out.firstname
  if (!out.lastname && out.lastName) out.lastname = out.lastName
  if (!out.lastName && out.lastname) out.lastName = out.lastname

  if (!out.loginType) {
    const hasEmail = !!out.email
    const hasMobile = !!out.mobile
    if (hasEmail && !hasMobile) out.loginType = 'email'
    if (hasMobile && !hasEmail) out.loginType = 'mobile'
  }

  return out
}

module.exports = { hasValue, getRequestParams, normalizeRequestParams }
