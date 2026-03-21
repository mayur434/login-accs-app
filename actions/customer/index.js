const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const { stringParameters } = require('../utils')
const { badRequest, serverError } = require('../lib/http')
const { connectDb, closeDb } = require('../lib/db')
const { getRequestParams, normalizeRequestParams } = require('../lib/params')
const { extractBearerToken, INTERNAL_CUSTOMER_PASSWORD } = require('../lib/customer')
const register = require('./services/register')
const login = require('./services/login')
const update = require('./services/update')
const { handleOtp } = require('./services/otp')

exports.main = async (params) => {
  const logger = Core.Logger('customer', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.info('customer action called')
    logger.debug(stringParameters(params))

    let requestParams = normalizeRequestParams(getRequestParams(params))

    // Generate IMS token for DB
    try {
      const tokenResponse = await generateAccessToken(requestParams)
      if (tokenResponse?.access_token) {
        requestParams.AIO_DB_TOKEN = tokenResponse.access_token
      }
    } catch (e) {
      logger.warn(`Unable to generate IMS token for DB: ${e.message}`)
      const bearerToken = extractBearerToken(requestParams)
      if (bearerToken) {
        requestParams.AIO_DB_TOKEN = bearerToken
      } else {
        logger.warn('No bearer token found in headers either')
      }
    }

    const operation = String(requestParams.operation || '').trim()
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
      if (!requestParams.email && !requestParams.mobile) {
        return badRequest("provide at least one identifier: 'email' or 'mobile_number'")
      }
    }

    // Single DB connection for the entire request lifecycle
    const db = await connectDb(requestParams)
    dbClient = db.dbClient

    // OTP gate for register/login
    if (['register', 'login'].includes(operation)) {
      const otp = await handleOtp(dbClient, requestParams, operation, logger)
      if (otp.response) return otp.response

      // Hydrate missing identity from OTP record
      const rec = otp.record || {}
      for (const key of ['loginType', 'email', 'mobile', 'customer_id', 'firstname', 'firstName', 'lastname', 'lastName']) {
        if (!requestParams[key] && rec[key]) requestParams[key] = rec[key]
      }
      if (!requestParams.mobile_number && rec.mobile) requestParams.mobile_number = rec.mobile

      requestParams.password = INTERNAL_CUSTOMER_PASSWORD
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
