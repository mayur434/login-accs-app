const { Core } = require('@adobe/aio-sdk')
const { stringParameters } = require('../utils')
const { badRequest, conflict } = require('../lib/http')
const { getCollection, closeDb, APP_CONFIG_COLLECTION, assertModuleEnabled } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { inferLoginTypeFromParams, normalizeMobile, normalizeEmailInput, extractCustomerId } = require('../lib/customer')
const { getAioDbToken } = require('../lib/imsHelper')
const { hasValue } = require('../lib/params')
const { generateOtp, validateOtp } = require('../lib/otpService')
const { commerceGraphQLRequest } = require('../lib/graphql')
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

  const gqlResp = await commerceGraphQLRequest(params, isCustomerExistsQuery, {
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

    const appConfig = await assertModuleEnabled(dbClient)

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
          dob: requestParams.dob || null,
          gender: requestParams.gender || null,
          doa: requestParams.doa || null,
          customer_id: requestParams.customer_id || null,
          is_customer_exists: customerStatus.isCustomerExists,
          is_disabled: customerStatus.isDisabled
        }, logger, appConfig)

        actionEnd(rawDb, traceId, 'customer', { statusCode: 200, operation: 'register' })
        return { statusCode: 200, body: result }
      }

      case 'requestUpdateOtp': {
        // ── Step 1: Send OTP to the new mobile/email before updating ──
        const customerToken = requestParams.customer_token || requestParams.customerToken || requestParams.token
        if (!customerToken) return badRequest('customer_token is required')

        const hasMobile = hasValue(requestParams.mobile_number)
        const hasEmail = hasValue(requestParams.new_email) || hasValue(requestParams.email)
        if (!hasMobile && !hasEmail) return badRequest("provide 'mobile_number' or 'email' (or 'new_email') to request an update OTP")

        let newMobile = null
        if (hasMobile) {
          try {
            newMobile = normalizeMobile(String(requestParams.mobile_number).trim())
          } catch (e) {
            return badRequest(e.message || 'invalid mobile number')
          }
        }

        let newEmail = null
        if (hasEmail) {
          try {
            const rawEmail = requestParams.new_email || requestParams.email
            newEmail = normalizeEmailInput(String(rawEmail).trim())
          } catch (e) {
            return badRequest(e.message || 'invalid email')
          }
        }

        const loginType = newMobile && newEmail ? 'both' : newMobile ? 'mobile' : 'email'

        // ── Check if new email/mobile already belongs to another account ─────
        const isCustomerExistsQuery = `query IsCustomerExists($email: String!, $mobile_number: String!) {
          isCustomerExists(email: $email, mobile_number: $mobile_number) {
            is_customer_exists
            is_disabled
          }
        }`

        if (newEmail) {
          const emailCheckResp = await commerceGraphQLRequest(requestParams, isCustomerExistsQuery, {
            email: newEmail, mobile_number: ''
          }, logger)
          const emailStatus = emailCheckResp?.data?.isCustomerExists
          if (emailStatus?.is_disabled) return conflict('email belongs to a disabled account')
          if (emailStatus?.is_customer_exists) return conflict('email already in use by another account')
        }

        if (newMobile) {
          const mobileCheckResp = await commerceGraphQLRequest(requestParams, isCustomerExistsQuery, {
            email: '', mobile_number: newMobile
          }, logger)
          const mobileStatus = mobileCheckResp?.data?.isCustomerExists
          if (mobileStatus?.is_disabled) return conflict('mobile belongs to a disabled account')
          if (mobileStatus?.is_customer_exists) return conflict('mobile number already in use by another account')
        }

        const otpResult = await generateOtp(dbClient, {
          flowType: 'update_mobile_email',
          loginType,
          mobile: newMobile || null,
          email: newEmail || null,
          customer_id: extractCustomerId(requestParams) || null
        }, logger, appConfig)

        actionEnd(rawDb, traceId, 'customer', { statusCode: 200, operation: 'requestUpdateOtp' })
        return { statusCode: 200, body: otpResult }
      }

      case 'updateCustomerDetails': {
        // ── If mobile or email is being changed, OTP proof is required ──
        const hasSensitiveUpdate = hasValue(requestParams.mobile_number) ||
          hasValue(requestParams.new_email) || hasValue(requestParams.email)

        if (hasSensitiveUpdate) {
          const { otpReferenceId, otpValue } = requestParams
          if (!otpReferenceId || !otpValue) {
            return badRequest("'otpReferenceId' and 'otpValue' are required when updating mobile or email")
          }

          const record = await validateOtp(dbClient, otpReferenceId, otpValue, logger)

          if (record.flowType !== 'update_mobile_email') {
            return badRequest('invalid OTP: not issued for a mobile/email update')
          }

          const customerId = extractCustomerId(requestParams)
          if (customerId && record.customer_id && String(record.customer_id) !== String(customerId)) {
            return badRequest('OTP does not belong to this customer')
          }

          if (hasValue(requestParams.mobile_number) && record.mobile) {
            let submittedMobile = null
            try { submittedMobile = normalizeMobile(String(requestParams.mobile_number).trim()) } catch { /* invalid */ }
            if (submittedMobile !== record.mobile) {
              return badRequest('mobile number does not match the OTP request')
            }
          }

          const submittedEmailRaw = requestParams.new_email || requestParams.email
          if (hasValue(submittedEmailRaw) && record.email) {
            let submittedEmail = null
            try { submittedEmail = normalizeEmailInput(String(submittedEmailRaw).trim()) } catch { /* invalid */ }
            if (submittedEmail !== record.email) {
              return badRequest('email does not match the OTP request')
            }
          }
        }

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

