/**
 * validateOtpAction
 *
 * Public endpoint: POST /validate-otp
 *
 * Accepts { otpReferenceId, otpValue }.
 * Validates the OTP, then based on the stored flowType:
 *   - 'login'    → look up user, generate Commerce token, upsert identity, return token
 *   - 'register' → create Commerce user, generate token, upsert identity, return token
 */

const { Core } = require('@adobe/aio-sdk')
const { errorResponse } = require('../lib/http')
const { getCollection, closeDb, getAppConfig, findOneOrNull, isUniqueConstraintError } = require('../lib/db')
const { graphQLRequest } = require('../lib/graphql')
const { getRequestParams } = require('../lib/params')
const {
  INTERNAL_CUSTOMER_PASSWORD,
  CUSTOMER_IDENTITY_COLLECTION,
  parseCustomerIdFromToken,
  normalizeMobile,
  inferLoginTypeFromParams,
  buildLoginType,
  getSyntheticEmail,
  getCommerceMobileValue
} = require('../lib/customer')
const { validateOtp } = require('../lib/otpService')
const { getAioDbToken } = require('../lib/imsHelper')

// ── Commerce helpers ────────────────────────────────────────────────────

async function tryLogin (email, params, logger) {
  const mutation = `mutation generateCustomerToken($email: String!){ generateCustomerToken(email: $email, password: "${INTERNAL_CUSTOMER_PASSWORD}"){ token } }`
  try {
    const resp = await graphQLRequest(params, mutation, { email }, logger)
    if (resp?.data?.generateCustomerToken?.token) return resp.data.generateCustomerToken.token
  } catch (e) {
    logger.debug && logger.debug('generateCustomerToken failed: ' + e.message)
  }
  return null
}

async function createUser (email, mobile, opts, params, logger) {
  const firstname = opts.firstname || 'Guest'
  const lastname = opts.lastname || 'User'

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

    const existing = await findOneOrNull(collection, { customer_id: customerId })

    // Determine email: NEVER overwrite a real email with a pattern email
    let email
    if (record.email) {
      email = record.email
    } else if (existing?.email && !/^\d+@email\.com$/i.test(existing.email)) {
      email = existing.email
    } else {
      email = normalizedMobile ? getSyntheticEmail(normalizedMobile) : (existing?.email || null)
    }

    const loginType = buildLoginType(!!email, !!normalizedMobile)
    const now = new Date()

    const doc = {
      email,
      mobile_number: normalizedMobile,
      customer_id: customerId,
      firstname: record.firstname || existing?.firstname || null,
      lastname: record.lastname || existing?.lastname || null,
      status: 'active',
      updated_at: now
    }

    if (existing) {
      await collection.updateOne({ customer_id: customerId }, { $set: doc })
    } else {
      try {
        await collection.insertOne({ ...doc, login_type: loginType, created_at: now })
      } catch (insertErr) {
        if (isUniqueConstraintError(insertErr)) {
          await collection.updateOne({ customer_id: customerId }, { $set: doc })
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

// ── Resolve Commerce email from identifier ──────────────────────────────

async function resolveEmail (dbClient, record, logger) {
  if (record.loginType === 'mobile') {
    if (!record.mobile) throw Object.assign(new Error('mobile not present in OTP record'), { statusCode: 400 })
    const identityCollection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
    let normalizedMobile = record.mobile
    try { normalizedMobile = normalizeMobile(record.mobile) } catch (_) { /* keep raw */ }
    const identity = await findOneOrNull(identityCollection, { mobile_number: normalizedMobile, status: 'active' })
    const email = identity?.email || getSyntheticEmail(normalizedMobile)
    logger.info(`Resolved email=${email} (from ${identity ? 'identity table' : 'pattern'})`)
    return email
  }
  return record.email
}

// ── Main action ─────────────────────────────────────────────────────────

async function main (params) {
  const logger = Core.Logger('validateOtp', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.info('validateOtpAction called')
    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    if (!inParams.otpReferenceId || !inParams.otpValue) {
      return errorResponse(400, "missing parameter(s) 'otpReferenceId' and 'otpValue'", logger)
    }

    const aioDbToken = await getAioDbToken(inParams)
    const { dbClient: client } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      'otps'
    )
    dbClient = client

    // ── Validate OTP ──────────────────────────────────────────────────
    const record = await validateOtp(dbClient, inParams.otpReferenceId, inParams.otpValue, logger)
    logger.info(`OTP validated. flowType=${record.flowType}, loginType=${record.loginType}`)

    const emailToUse = await resolveEmail(dbClient, record, logger)

    // ── flowType: login ─────────────────────────────────────────────
    if (record.flowType === 'login') {
      const token = await tryLogin(emailToUse, inParams, logger)
      if (!token) {
        return errorResponse(404, 'user not found in Commerce', logger)
      }
      await upsertIdentity(dbClient, record, token, logger)
      return { statusCode: 200, body: { success: true, customer_token: token, message: 'login successful' } }
    }

    // ── flowType: register ──────────────────────────────────────────
    // Try login first — user might already exist in Commerce
    let token = await tryLogin(emailToUse, inParams, logger)
    if (!token) {
      logger.info('User not in Commerce, creating...')
      await createUser(emailToUse, record.mobile, record, inParams, logger)
      token = await tryLogin(emailToUse, inParams, logger)
    }
    if (!token) {
      return errorResponse(500, 'unable to obtain token after user creation', logger)
    }
    await upsertIdentity(dbClient, record, token, logger)
    return { statusCode: 200, body: { success: true, customer_token: token, message: 'registration successful' } }
  } catch (err) {
    const code = err.statusCode || 500
    return errorResponse(code, err.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
