const { Core } = require('@adobe/aio-sdk')
const { stringParameters, checkMissingRequestInputs } = require('../utils')
const { errorResponse } = require('../lib/http')
const { getCollection, closeDb, getAppConfig, findOneOrNull, APP_CONFIG_DEFAULTS } = require('../lib/db')
const { graphQLRequest } = require('../lib/graphql')
const { generateOtpValue, createReferenceId, levenshtein } = require('../lib/otp')
const { getRequestParams } = require('../lib/params')
const { INTERNAL_CUSTOMER_PASSWORD, CUSTOMER_IDENTITY_COLLECTION, parseCustomerIdFromToken, normalizeMobile, buildLoginType, getSyntheticEmail, getCommerceMobileValue } = require('../lib/customer')
const { isUniqueConstraintError } = require('../lib/db')
const { sendSmsOtp } = require('../lib/sms')
const { sendEmailOtp } = require('../lib/email')
const { getAioDbToken } = require('../lib/imsHelper')

// ── Commerce helpers ────────────────────────────────────────────────────

async function upsertIdentity (dbClient, record, token, logger) {
  try {
    const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
    const customerId = parseCustomerIdFromToken(token)
    if (!customerId) {
      logger.warn('upsertIdentity: could not parse customer_id from token — skipping')
      return
    }

    let normalizedMobile = null
    if (record.mobile) {
      try { normalizedMobile = normalizeMobile(record.mobile) } catch (_) { normalizedMobile = record.mobile }
    }

    // Look up existing identity by customer_id first
    const existing = await findOneOrNull(collection, { customer_id: customerId })

    // Determine email: NEVER overwrite a real email with a pattern email
    let email
    if (record.email) {
      // OTP record has an explicit email — use it
      email = record.email
    } else if (existing?.email && !/^\d+@email\.com$/i.test(existing.email)) {
      // Existing identity has a real (non-pattern) email — keep it
      email = existing.email
    } else {
      // No real email anywhere — use pattern email
      email = normalizedMobile ? getSyntheticEmail(normalizedMobile) : (existing?.email || null)
    }

    const hasEmail = !!email
    const hasMobile = !!normalizedMobile
    const loginType = buildLoginType(hasEmail, hasMobile)
    const now = new Date()

    const doc = {
      email,
      mobile_number: normalizedMobile,
      customer_id: customerId,
      status: 'active',
      updated_at: now
    }

    if (existing) {
      // Update existing record — do NOT overwrite login_type
      await collection.updateOne(
        { customer_id: customerId },
        { $set: doc }
      )
    } else {
      // Insert new record with login_type and created_at
      try {
        await collection.insertOne({
          ...doc,
          login_type: loginType,
          created_at: now
        })
      } catch (insertErr) {
        if (isUniqueConstraintError(insertErr)) {
          // Race condition: record was created between findOne and insertOne
          await collection.updateOne(
            { customer_id: customerId },
            { $set: doc }
          )
        } else {
          throw insertErr
        }
      }
    }
    logger.info(`Identity upserted for customer_id=${customerId}, email=${email}`)
  } catch (e) {
    if (!isUniqueConstraintError(e)) {
      logger.warn('identity upsert failed (non-critical): ' + e.message)
    }
  }
}

async function tryLogin (email, password, params, logger) {
  const mutation = `mutation generateCustomerToken($email: String!){ generateCustomerToken(email: $email, password: "${INTERNAL_CUSTOMER_PASSWORD}"){ token } }`
  try {
    const resp = await graphQLRequest(params, mutation, { email }, logger)
    if (resp?.data?.generateCustomerToken?.token) return resp.data.generateCustomerToken.token
  } catch (e) {
    logger.debug && logger.debug('generateCustomerToken attempt failed: ' + e.message)
  }
  return null
}

async function createUser (email, password, mobile, params, logger) {
  const firstname = params.firstname || params.firstName || 'Guest'
  const lastname = params.lastname || params.lastName || 'User'

  const input = {
    firstname,
    lastname,
    email,
    password: INTERNAL_CUSTOMER_PASSWORD
  }

  if (mobile) {
    try {
      const mobileValue = getCommerceMobileValue(normalizeMobile(mobile))
      if (mobileValue) {
        input.custom_attributes = [{ attribute_code: 'mobile_number', value: mobileValue }]
      }
    } catch (_) { /* normalization failed, skip mobile attr */ }
  }

  const mutation = `mutation createCustomerV2($input: CustomerCreateInput!){ createCustomerV2(input: $input){ customer{ firstname lastname email } } }`
  return graphQLRequest(params, mutation, { input }, logger)
}

// ── Main action ─────────────────────────────────────────────────────────

async function main (params) {
  const logger = Core.Logger('otp', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.info('OTP action called')

    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    const headers = inParams.__ow_headers || {}
    const aioDbToken = await getAioDbToken(inParams)

    const dbResult = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      'otps'
    )
    dbClient = dbResult.dbClient
    const otpCollection = dbResult.collection

    const appConfig = await getAppConfig(dbClient)

    if (!appConfig.is_enabled) {
      return errorResponse(403, 'otp module is disabled', logger)
    }

    const isValidate = inParams.otpValue && inParams.otpReferenceId

    if (!isValidate) {
      // ── Generate OTP ──────────────────────────────────────────────
      const requiredParams = ['loginType']
      const errorMessage = checkMissingRequestInputs(inParams, requiredParams, [])
      if (errorMessage) return errorResponse(400, errorMessage, logger)

      if (inParams.loginType === 'mobile') {
        const missing = checkMissingRequestInputs(inParams, ['mobile'], [])
        if (missing) return errorResponse(400, missing, logger)
      } else if (inParams.loginType === 'email') {
        const missing = checkMissingRequestInputs(inParams, ['email'], [])
        if (missing) return errorResponse(400, missing, logger)
      } else {
        return errorResponse(400, 'invalid loginType', logger)
      }

      let emailForLogin = inParams.email
      if (inParams.loginType === 'mobile') {
        // First check identity table for existing record with this mobile
        const identityCollection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
        let normalizedMobile = inParams.mobile
        try { normalizedMobile = normalizeMobile(inParams.mobile) } catch (_) { /* keep raw */ }
        const identity = await findOneOrNull(identityCollection, { mobile_number: normalizedMobile, status: 'active' })
        emailForLogin = identity?.email || getSyntheticEmail(normalizedMobile)
        logger.info(`Mobile login: resolved email = ${emailForLogin} (from ${identity ? 'identity table' : 'pattern'})`)
      }

      let token = null
      try {
        token = await tryLogin(emailForLogin, '', inParams, logger)
      } catch (e) {
        logger.debug && logger.debug('initial tryLogin failed: ' + e.message)
      }

      const autoRegister = !!appConfig.auto_register

      if (!token) {
        if (!autoRegister) {
          return errorResponse(404, 'user not exist', logger)
        }

        try {
          await createUser(emailForLogin, INTERNAL_CUSTOMER_PASSWORD, inParams.mobile, inParams, logger)
          token = await tryLogin(emailForLogin, INTERNAL_CUSTOMER_PASSWORD, inParams, logger)
        } catch (e) {
          logger.error && logger.error('user creation/login failed: ' + e.message)
          return errorResponse(500, 'unable to create/login user', logger)
        }

        if (!token) {
          return errorResponse(500, 'unable to obtain token after user creation', logger)
        }
      }

      const otpValue = generateOtpValue()
      const ref = createReferenceId()
      const otpValidityMinutes = (Number.isInteger(appConfig.otp_expiration_validity) && appConfig.otp_expiration_validity > 0)
        ? appConfig.otp_expiration_validity
        : APP_CONFIG_DEFAULTS.otp_expiration_validity
      const otpInResponse = typeof appConfig.otp_in_response === 'boolean'
        ? appConfig.otp_in_response
        : APP_CONFIG_DEFAULTS.otp_in_response

      await otpCollection.insertOne({
        otpReferenceId: ref,
        otp: otpValue,
        loginType: inParams.loginType,
        mobile: inParams.mobile,
        email: inParams.email,
        createdAt: Date.now(),
        expiresAt: Date.now() + (otpValidityMinutes * 60 * 1000),
        otpExpirationValidityMinutes: otpValidityMinutes,
        consumed: false,
        token,
        tokenStoredAt: Date.now()
      })

      // ── Dispatch OTP via SMS / Email when bypass is OFF ───────────
      if (!otpInResponse) {
        const mobileTarget = inParams.mobile || null
        const emailTarget = inParams.email || emailForLogin || null

        try {
          // Priority: mobile first when both identifiers are present.
          if (mobileTarget) {
            await sendSmsOtp(appConfig, mobileTarget, otpValue, otpValidityMinutes, logger)
          } else if (emailTarget) {
            await sendEmailOtp(appConfig, emailTarget, otpValue, otpValidityMinutes, logger)
          } else {
            await otpCollection.deleteOne({ otpReferenceId: ref })
            return errorResponse(400, "missing parameter(s) 'mobile' or 'email'", logger)
          }
        } catch (dispatchErr) {
          // Fail closed: delete OTP so it cannot be used if delivery failed.
          await otpCollection.deleteOne({ otpReferenceId: ref })
          logger.warn('OTP dispatch failed: ' + dispatchErr.message)
          return errorResponse(502, 'failed to deliver otp notification', logger)
        }
      }

      return {
        statusCode: 200,
        body: otpInResponse
          ? { otpReferenceId: ref, otpValue }
          : { otpReferenceId: ref }
      }
    }

    // ── Validate OTP ──────────────────────────────────────────────────
    const missing = checkMissingRequestInputs(inParams, ['otpReferenceId', 'otpValue', 'loginType'], [])
    if (missing) return errorResponse(400, missing, logger)

    const record = await findOneOrNull(otpCollection, { otpReferenceId: inParams.otpReferenceId })
    if (!record) return errorResponse(400, 'invalid otpReferenceId', logger)
    if (record.consumed) return errorResponse(400, 'otp already used', logger)

    if (Date.now() > record.expiresAt) {
      await otpCollection.deleteOne({ otpReferenceId: inParams.otpReferenceId })
      return errorResponse(400, 'otp expired', logger)
    }

    const distance = levenshtein(String(inParams.otpValue), String(record.otp))
    if (distance > 1) return errorResponse(401, 'invalid otp', logger)

    // Mark OTP as consumed immediately after successful validation
    await otpCollection.updateOne(
      { otpReferenceId: inParams.otpReferenceId },
      { $set: { consumed: true, consumedAt: Date.now() } }
    )

    let emailToUse = record.email
    if (inParams.loginType === 'mobile') {
      if (!record.mobile) return errorResponse(400, 'mobile not present for this reference', logger)
      // Look up real email from identity table before falling back to pattern email
      const identityCollection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
      let normalizedMobile = record.mobile
      try { normalizedMobile = normalizeMobile(record.mobile) } catch (_) { /* keep raw */ }
      const identity = await findOneOrNull(identityCollection, { mobile_number: normalizedMobile, status: 'active' })
      emailToUse = identity?.email || getSyntheticEmail(normalizedMobile)
      logger.info(`OTP validation: resolved email = ${emailToUse} (from ${identity ? 'identity table' : 'pattern'})`)
    }

    // Reuse the token cached during OTP generation to avoid a redundant Commerce call
    let token = record.token || null
    if (token) {
      logger.info('Reusing cached customer token from OTP generation')
    } else {
      // Fallback: token was not stored during generation (edge case)
      logger.info('No cached token found, generating new customer token')
      try {
        token = await tryLogin(emailToUse, INTERNAL_CUSTOMER_PASSWORD, inParams, logger)
      } catch (err) {
        logger.info('login attempt failed: ' + err.message)
      }
    }

    if (token) {
      await upsertIdentity(dbClient, record, token, logger)
      return { statusCode: 200, body: { success: true, customer_token: token, message: 'otp matched' } }
    }

    const autoRegister = !!appConfig.auto_register

    if (!autoRegister) {
      return errorResponse(404, 'user not exist', logger)
    }

    // Auto-create user and login
    try {
      await createUser(emailToUse, INTERNAL_CUSTOMER_PASSWORD, record.mobile, inParams, logger)
      const tokenAfterCreate = await tryLogin(emailToUse, INTERNAL_CUSTOMER_PASSWORD, inParams, logger)
      if (tokenAfterCreate) {
        await upsertIdentity(dbClient, record, tokenAfterCreate, logger)
        return { statusCode: 200, body: { success: true, customer_token: tokenAfterCreate, message: 'otp matched' } }
      }
      return errorResponse(500, 'unable to obtain token after user creation', logger)
    } catch (err) {
      logger.error(err)
      return errorResponse(500, 'server error during user creation/login', logger)
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main