const { Core } = require('@adobe/aio-sdk')
const { stringParameters } = require('../utils')
const { badRequest } = require('../lib/http')
const { getCollection, closeDb, APP_CONFIG_COLLECTION, assertModuleEnabled } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { inferLoginTypeFromParams, normalizeMobile, normalizeEmailInput } = require('../lib/customer')
const { getAioDbToken } = require('../lib/imsHelper')
const { hasValue } = require('../lib/params')
const { generateOtp } = require('../lib/otpService')
const { graphQLRequest } = require('../lib/graphql')
const update = require('./services/update')
const { generateTraceId, actionStart, actionEnd } = require('../lib/logger')

// ── Registration conflict checks ────────────────────────────────────────

async function checkRegistrationConflict (params, logger) {
  const isCustomerExistsQuery = `query IsCustomerExists($email: String!, $mobile_number: String!) {
    isCustomerExists(email: $email, mobile_number: $mobile_number) {
      is_customer_exists
      is_disabled
    }
  }`

  const gqlResp = await graphQLRequest(params, isCustomerExistsQuery, {
    email: params.email || '',
    mobile_number: params.mobile || params.mobile_number || ''
  }, logger)

  return {
    isCustomerExists: !!gqlResp?.data?.isCustomerExists?.is_customer_exists,
    isDisabled: !!gqlResp?.data?.isCustomerExists?.is_disabled
  }
}

// ── Main action ─────────────────────────────────────────────────────────

exports.main = async (params) => {
  const logger = Core.Logger('customer', { level: params.LOG_LEVEL || 'info' })
  let dbClient, aioDbToken
  const traceId = generateTraceId()

  try {
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
      APP_CONFIG_COLLECTION,
      { traceId }
    )
    dbClient = connectedClient
    const rawDb = dbClient._rawDbClient || dbClient
    actionStart(rawDb, traceId, 'customer')

    await assertModuleEnabled(dbClient)

    switch (operation) {
      case 'register': {
        // ── Customer Registration: generate OTP with flowType 'register' ──
        const loginType = requestParams.loginType
        if (!loginType) {
          return badRequest("provide at least one identifier: 'email' or 'mobile'")
        }

        if (hasValue(requestParams.mobile) || hasValue(requestParams.mobile_number)) {
          const rawMobile = hasValue(requestParams.mobile) ? requestParams.mobile : requestParams.mobile_number
          try {
            const normalizedMobile = rawMobile
            requestParams.mobile = normalizedMobile
            requestParams.mobile_number = normalizedMobile
          } catch (e) {
            return badRequest(e.message || 'invalid indian mobile number')
          }
        }

        if (hasValue(requestParams.email)) {
          try {
            requestParams.email = normalizeEmailInput(requestParams.email)
          } catch (e) {
            return badRequest(e.message || 'invalid email')
          }
        }

        // Check for duplicate email/mobile before generating OTP
        const customerStatus = await checkRegistrationConflict(requestParams, logger)
        console.log('Customer status from conflict check', customerStatus);
        if (customerStatus.isDisabled) {
          return { statusCode: 403, body: { error: 'Your account is disabled. Please contact support.' } }
        }
        if (customerStatus.isCustomerExists) {
          return { statusCode: 409, body: { error: 'customer already exists' } }
        }

        const result = await generateOtp(dbClient, {
          flowType: 'register',
          loginType,
          mobile: requestParams.mobile || requestParams.mobile_number || null,
          email: requestParams.email || null,
          firstname: requestParams.firstname || requestParams.firstName || null,
          lastname: requestParams.lastname || requestParams.lastName || null,
          customer_id: requestParams.customer_id || null,
          is_customer_exists: customerStatus.isCustomerExists,
          is_disabled: customerStatus.isDisabled
        }, logger)

        actionEnd(rawDb, traceId, 'customer', { statusCode: 200, operation: 'register' })
        return { statusCode: 200, body: result }
      }

      case 'updateCustomerDetails': {
        const result = await update(dbClient, requestParams, logger)
        actionEnd(rawDb, traceId, 'customer', { statusCode: result.statusCode, operation: 'updateCustomerDetails' })
        return result
      }

      default:
        actionEnd(rawDb, traceId, 'customer', { statusCode: 400, operation })
        return badRequest(`invalid operation: '${operation}'. Use 'register' or 'updateCustomerDetails'.`)
    }
  } catch (err) {
    const code = err.statusCode || 500
    if (code >= 500) logger.error(err)
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) actionEnd(rawDb, traceId, 'customer', { statusCode: code, error: err.message })
    return { statusCode: code, body: { error: err.message || 'server error' } }
  } finally {
    await closeDb(dbClient, logger)
  }
}

