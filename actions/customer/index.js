const { Core } = require('@adobe/aio-sdk')
const { stringParameters } = require('../utils')
const { badRequest } = require('../lib/http')
const { getCollection, closeDb, APP_CONFIG_COLLECTION, findOneOrNull, assertModuleEnabled } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { CUSTOMER_IDENTITY_COLLECTION, inferLoginTypeFromParams, normalizeMobile } = require('../lib/customer')
const { getAioDbToken } = require('../lib/imsHelper')
const { hasValue } = require('../lib/params')
const { generateOtp } = require('../lib/otpService')
const update = require('./services/update')

// ── Registration conflict checks ────────────────────────────────────────

async function checkRegistrationConflict (dbClient, params, logger) {
  const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
  const email = hasValue(params.email) ? String(params.email).trim().toLowerCase() : null
  const mobile = hasValue(params.mobile) ? String(params.mobile).trim()
    : (hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null)

  if (email) {
    const existing = await findOneOrNull(collection, { email })
    if (existing) return 'email already exists'
  }
  if (mobile) {
    let normalizedMobile = mobile
    try { normalizedMobile = normalizeMobile(mobile) } catch (_) { /* keep raw */ }
    const candidates = [...new Set([mobile, normalizedMobile].filter(Boolean))]
    for (const m of candidates) {
      const existing = await findOneOrNull(collection, { mobile_number: m, status: 'active' })
      if (existing) return 'mobile already exists'
    }
  }
  return null
}

// ── Main action ─────────────────────────────────────────────────────────

exports.main = async (params) => {
  const logger = Core.Logger('customer', { level: params.LOG_LEVEL || 'info' })
  let dbClient, aioDbToken

  try {
    logger.info('customer action called')
    logger.debug(stringParameters(params))
    const requestParams = getRequestParams(params)
    requestParams.loginType = inferLoginTypeFromParams(requestParams)

    try {
      requestParams.__ow_headers = params.__ow_headers || requestParams.__ow_headers || {}
      aioDbToken = await getAioDbToken(requestParams)
    } catch (e) {
      logger.warn(`Unable to generate IMS token for DB: ${e.message}`)
    }

    const operation = String(requestParams.operation || '').trim()
    if (!operation) {
      return badRequest("missing parameter(s) 'operation'")
    }

    const { dbClient: connectedClient } = await getCollection(
      { ...requestParams, AIO_DB_TOKEN: aioDbToken },
      APP_CONFIG_COLLECTION
    )
    dbClient = connectedClient

    await assertModuleEnabled(dbClient)

    switch (operation) {
      case 'register': {
        // ── Customer Registration: generate OTP with flowType 'register' ──
        const loginType = requestParams.loginType
        if (!loginType) {
          return badRequest("provide at least one identifier: 'email' or 'mobile'")
        }

        // Check for duplicate email/mobile before generating OTP
        const conflict = await checkRegistrationConflict(dbClient, requestParams, logger)
        if (conflict) {
          return { statusCode: 409, body: { error: conflict } }
        }

        const result = await generateOtp(dbClient, {
          flowType: 'register',
          loginType,
          mobile: requestParams.mobile || requestParams.mobile_number || null,
          email: requestParams.email || null,
          firstname: requestParams.firstname || requestParams.firstName || null,
          lastname: requestParams.lastname || requestParams.lastName || null,
          customer_id: requestParams.customer_id || null
        }, logger)

        return { statusCode: 200, body: result }
      }

      case 'updateCustomerDetails':
        return await update(dbClient, requestParams, logger)

      default:
        return badRequest(`invalid operation: '${operation}'. Use 'register' or 'updateCustomerDetails'.`)
    }
  } catch (err) {
    const code = err.statusCode || 500
    if (code >= 500) logger.error(err)
    return { statusCode: code, body: { error: err.message || 'server error' } }
  } finally {
    await closeDb(dbClient, logger)
  }
}

