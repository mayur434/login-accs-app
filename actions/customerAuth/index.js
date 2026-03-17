const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const { stringParameters } = require('../utils')
const registerCustomer = require('./services/registerCustomer')
const loginCustomer = require('./services/loginCustomer')
const updateMobile = require('./services/updateMobile')
const { handleOtp } = require('./services/handleOtp.js');

const INTERNAL_CUSTOMER_PASSWORD = 'pass@123'

function getRequestParams(params) {
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

function badRequest(message) {
  return {
    statusCode: 400,
    body: {
      error: message
    }
  }
}

function serverError() {
  return {
    statusCode: 500,
    body: {
      error: 'server error'
    }
  }
}

function normalizeRequestParams(req) {
  const out = { ...req }

  // accept both mobile and mobile_number
  if (!out.mobile && out.mobile_number) out.mobile = out.mobile_number
  if (!out.mobile_number && out.mobile) out.mobile_number = out.mobile

  // accept both firstName/lastName and firstname/lastname
  if (!out.firstname && out.firstName) out.firstname = out.firstName
  if (!out.firstName && out.firstname) out.firstName = out.firstname
  if (!out.lastname && out.lastName) out.lastname = out.lastName
  if (!out.lastName && out.lastname) out.lastName = out.lastname

  // infer loginType if missing
  if (!out.loginType) {
    const hasEmail = !!out.email
    const hasMobile = !!out.mobile

    if (hasEmail && !hasMobile) out.loginType = 'email'
    if (hasMobile && !hasEmail) out.loginType = 'mobile'
  }

  return out
}

function extractBearerToken(params) {
  const h = (params && params.__ow_headers) || {}
  const auth = h.authorization || h.Authorization || params.authorization || params.Authorization || ''
  const s = String(auth).trim()
  return s.toLowerCase().startsWith('bearer ') ? s.slice(7).trim() : (s || null)
}

exports.main = async (params) => {
  const logger = Core.Logger('customerAuth', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('customerAuth action called')
    logger.debug(stringParameters(params))

    let requestParams = getRequestParams(params)
    requestParams = normalizeRequestParams(requestParams)

    // Generate IMS token for aio-lib-db (early-access DB requirement)
    try {
      const tokenResponse = await generateAccessToken(requestParams)
      const accessToken = tokenResponse && tokenResponse.access_token
      if (accessToken) {
        requestParams.AIO_DB_TOKEN = accessToken
      }
    } catch (e) {
      logger.warn(`Unable to generate IMS token for DB: ${e.message}`)

      // fallback: use bearer token from request headers
      const bearerToken = extractBearerToken(requestParams)
      if (bearerToken) {
        requestParams.AIO_DB_TOKEN = bearerToken
        logger.info('AIO_DB_TOKEN set from Authorization header (fallback)')
      } else {
        logger.warn('No bearer token found in headers either')
      }
    }

    const operation = String(requestParams.operation || '').trim()

    if (!operation) {
      return badRequest("missing parameter(s) 'operation'")
    }

    // Strict check:
    // - login: exactly one identifier
    // - register: at least one identifier (email/mobile or both)
    if (operation === 'login') {
      const hasEmail = !!requestParams.email
      const hasMobile = !!requestParams.mobile
      if (!requestParams.loginType && (hasEmail === hasMobile)) {
        return badRequest("provide exactly one identifier: 'email' or 'mobile_number'")
      }
    }

    if (operation === 'register') {
      const hasEmail = !!requestParams.email
      const hasMobile = !!requestParams.mobile
      if (!hasEmail && !hasMobile) {
        return badRequest("provide at least one identifier: 'email' or 'mobile_number'")
      }
    }

    // OTP gate for register/login/updateMobile
    if (['register', 'login'].includes(operation)) {
      const otp = await handleOtp(requestParams, operation, logger)
      if (otp.response) return otp.response

      // OTP verified: hydrate missing identity from OTP record
      const rec = otp.record || {}
      if (!requestParams.loginType && rec.loginType) requestParams.loginType = rec.loginType
      if (!requestParams.email && rec.email) requestParams.email = rec.email
      if (!requestParams.mobile && rec.mobile) requestParams.mobile = rec.mobile
      if (!requestParams.mobile_number && rec.mobile) requestParams.mobile_number = rec.mobile
      if (!requestParams.customer_id && rec.customer_id) requestParams.customer_id = rec.customer_id

      // added: hydrate names saved at OTP generation time
      if (!requestParams.firstname && rec.firstname) requestParams.firstname = rec.firstname
      if (!requestParams.firstName && rec.firstName) requestParams.firstName = rec.firstName || rec.firstname
      if (!requestParams.lastname && rec.lastname) requestParams.lastname = rec.lastname
      if (!requestParams.lastName && rec.lastName) requestParams.lastName = rec.lastName || rec.lastname

      // keep password internal
      if (operation === 'register' || operation === 'login') {
        requestParams.password = INTERNAL_CUSTOMER_PASSWORD
      }
    }

    switch (operation) {
      case 'register':
        return await registerCustomer(requestParams, logger)
      case 'login':
        return await loginCustomer(requestParams, logger)
      case 'updateMobile':
        return await updateMobile(requestParams, logger)
      default:
        return badRequest(`invalid operation: ${operation}`)
    }
  } catch (error) {
    logger.error(error)
    return serverError()
  }
}
