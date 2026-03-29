const { Core } = require('@adobe/aio-sdk')
const { stringParameters } = require('../utils')
const { badRequest, serverError } = require('../lib/http')
const { getCollection, closeDb, APP_CONFIG_COLLECTION } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { INTERNAL_CUSTOMER_PASSWORD, CUSTOMER_IDENTITY_COLLECTION } = require('../lib/customer')
const { getAioDbToken } = require('../lib/imsHelper')
const { findOneOrNull } = require('../lib/db')
const register = require('./services/register')
const login = require('./services/login')
const update = require('./services/update')
const { handleOtp } = require('./services/otp')

// Helper to check if user exists for login
async function userExistsForLogin(dbClient, params) {
  const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
  const loginType = String(params.loginType || '').toLowerCase()
  const activeFilter = { status: 'active' }

  if (loginType === 'mobile') {
    const mobile = params.mobile || params.mobile_number
    if (!mobile) return false
    try {
      const { normalizeMobile } = require('../utils')
      const normalizedMobile = normalizeMobile(mobile)
      return !!(await findOneOrNull(collection, { mobile_number: normalizedMobile, ...activeFilter }))
    } catch { 
      return false 
    }
  }

  const email = params.email
  if (!email) return false
  return !!(await findOneOrNull(collection, { email: String(email).toLowerCase(), ...activeFilter }))
}

exports.main = async (params) => {
  const logger = Core.Logger('customer', { level: params.LOG_LEVEL || 'info' })
  let dbClient, aioDbToken

  try {
    logger.info('customer action called')
    logger.debug(stringParameters(params))
    const requestParams = getRequestParams(params);

    // Generate IMS token for DB
    try {
    requestParams.__ow_headers = params.__ow_headers || requestParams.__ow_headers || {}
    const headers = requestParams.__ow_headers || {}
    aioDbToken = await getAioDbToken(headers)
      if (aioDbToken?.access_token) {
        requestParams.AIO_DB_TOKEN = aioDbToken.access_token
      }
    } catch (e) {
      logger.warn(`Unable to generate IMS token for DB: ${e.message}`)
    }

    let operation = String(requestParams.operation || '').trim()
    if (!operation) {
      return badRequest("missing parameter(s) 'operation'")
    }

    if (operation === 'login') {
      const hasEmail = !!requestParams.email
      const hasMobile = !!requestParams.mobile
      if (!requestParams.loginType && (hasEmail === hasMobile)) {
        return badRequest("provide exactly one identifier: 'email' or 'mobile_number'")
      }
    }

    if (operation === 'register') {
      const isOtpValidation = requestParams.otpReferenceId && requestParams.otpValue
      if (!isOtpValidation && !requestParams.email && !requestParams.mobile) {
        return badRequest("provide at least one identifier: 'email' or 'mobile_number'")
      }
    }

    logger.debug(`access_token: ${aioDbToken }`)

    // Single DB connection for the entire request lifecycle
    const { dbClient: connectedClient } = await getCollection(
      { ...requestParams, AIO_DB_TOKEN: aioDbToken },
      APP_CONFIG_COLLECTION
    )
    dbClient = connectedClient

    // OTP gate for register/login
    if (['register', 'login'].includes(operation)) {
      logger.info('Before handleOtp: about to check OTP and uniqueness for register/login')
      const otp = await handleOtp(dbClient, requestParams, operation, logger)
      logger.info('After handleOtp: OTP handler returned', otp)
      if (otp.response) return otp.response

      // Hydrate missing identity from OTP record
      const rec = otp.record || {}
      for (const key of ['loginType', 'email', 'mobile', 'customer_id', 'firstname', 'firstName', 'lastname', 'lastName']) {
        if (!requestParams[key] && rec[key]) requestParams[key] = rec[key]
      }
      if (!requestParams.mobile_number && rec.mobile) requestParams.mobile_number = rec.mobile

      requestParams.password = INTERNAL_CUSTOMER_PASSWORD

      // Auto-register logic: if OTP verified for login but user doesn't exist,
      // switch to register flow. (auto_register was already checked during OTP generation)
      if (operation === 'login' && otp.verified) {
        const userExists = await userExistsForLogin(dbClient, requestParams)
        if (!userExists) {
          logger.info('Login: user does not exist after OTP verification, switching to register flow')
          operation = 'register'
        }
      }
    }

    switch (operation) {
      case 'register':
        return await register(dbClient, requestParams, logger)
      case 'login':
        return await login(dbClient, requestParams, logger)
      case 'updateCustomerDetails':
        return await update(dbClient, requestParams, logger)
      default:
        return badRequest(`invalid operation: ${operation}`)
    }
  } catch (error) {
    logger.error(error)
    return serverError()
  } finally {
    await closeDb(dbClient, logger)
  }
}
