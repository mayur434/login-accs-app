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
const { getCollection, closeDb, assertModuleEnabled, findOneOrNull, isUniqueConstraintError } = require('../lib/db')
const { graphQLRequest } = require('../lib/graphql')
const { getRequestParams } = require('../lib/params')
const {
  INTERNAL_CUSTOMER_PASSWORD,
  CUSTOMER_IDENTITY_COLLECTION,
  parseCustomerIdFromToken,
  normalizeMobile,
  buildLoginType,
  getSyntheticEmail,
  getCommerceMobileValue
} = require('../lib/customer')
const { validateOtp } = require('../lib/otpService')
const { getAioDbToken } = require('../lib/imsHelper')
const { fetchCustomerProfile } = require('../lib/commerce')
const { actionStart, actionEnd } = require('../lib/logger')

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

  const mutation = `mutation createCustomerV2($input: CustomerCreateInput!){ createCustomerV2(input: $input){ customer{ id firstname lastname email } } }`
  return graphQLRequest(params, mutation, { input }, logger)
}

function extractCreateCustomerErrorMessage (err) {
  const message = String(err?.message || '').toLowerCase()
  if (message.includes('already exists')) return 'customer already exists in Commerce'
  if (message.includes('is invalid')) return 'invalid customer details for Commerce registration'
  return err?.message || 'customer creation failed in Commerce'
}

function toCustomerResponse (profile, record, fallbackEmail, createdCustomer = null) {
  let customerId = null
  const profileOrCreateId = profile?.id ?? createdCustomer?.id
  if (profileOrCreateId !== undefined && profileOrCreateId !== null && profileOrCreateId !== '') {
    const parsed = Number(profileOrCreateId)
    customerId = Number.isNaN(parsed) ? profileOrCreateId : parsed
  }

  let normalizedMobile = null
  if (record?.mobile) {
    try { normalizedMobile = normalizeMobile(record.mobile) } catch (_) { normalizedMobile = record.mobile }
  }
  const email = profile?.email || createdCustomer?.email || fallbackEmail || null
  const firstName = profile?.firstname || createdCustomer?.firstname || record?.firstname || null
  const lastName = profile?.lastname || createdCustomer?.lastname || record?.lastname || null
  const loginType = buildLoginType(!!email, !!normalizedMobile)

  return {
    customer_id: customerId,
    firstname: firstName,
    lastname: lastName,
    email,
    mobile_number: normalizedMobile,
    login_type: loginType
  }
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

async function upsertIdentityStrict (dbClient, record, token, logger, profile, fallbackEmail, createdCustomer = null) {
  const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)

  let customerId = null
  const profileOrCreateId = profile?.id ?? createdCustomer?.id
  if (profileOrCreateId !== undefined && profileOrCreateId !== null && profileOrCreateId !== '') {
    const parsed = Number(profileOrCreateId)
    customerId = Number.isNaN(parsed) ? null : parsed
  }
  if (!customerId) {
    customerId = parseCustomerIdFromToken(token)
  }
  if (!customerId) {
    throw Object.assign(new Error('could not resolve customer id for local DB persistence'), { statusCode: 500 })
  }

  let normalizedMobile = null
  if (record.mobile) {
    try { normalizedMobile = normalizeMobile(record.mobile) } catch (_) { normalizedMobile = record.mobile }
  }

  const existing = await findOneOrNull(collection, { customer_id: customerId })

  const email = profile?.email || createdCustomer?.email || fallbackEmail || existing?.email || null
  const loginType = buildLoginType(!!email, !!normalizedMobile)
  const now = new Date()

  const doc = {
    email,
    mobile_number: normalizedMobile,
    customer_id: customerId,
    firstname: profile?.firstname || createdCustomer?.firstname || record.firstname || existing?.firstname || null,
    lastname: profile?.lastname || createdCustomer?.lastname || record.lastname || existing?.lastname || null,
    status: 'active',
    updated_at: now
  }

  await collection.updateOne(
    { customer_id: customerId },
    { $set: doc, $setOnInsert: { login_type: loginType, created_at: now } },
    { upsert: true }
  )

  logger.info(`Identity strictly upserted for customer_id=${customerId}, email=${email}`)
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
  const traceId = actionStart(logger, 'validateOtp')

  try {
    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    if (!inParams.otpReferenceId || !inParams.otpValue) {
      return errorResponse(400, "missing parameter(s) 'otpReferenceId' and 'otpValue'", logger)
    }

    const aioDbToken = await getAioDbToken(inParams)
    const { dbClient: client } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      'otps',
      { logger, traceId }
    )
    dbClient = client

    await assertModuleEnabled(dbClient)

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
      actionEnd(logger, traceId, 'validateOtp', { statusCode: 200, flowType: 'login' })
      return { statusCode: 200, body: { success: true, customer_token: token, message: 'login successful' } }
    }

    // ── flowType: register ──────────────────────────────────────────
    logger.info('Register flow: creating customer in Commerce...')
    let createdCustomer = null
    try {
      const createResp = await createUser(emailToUse, record.mobile, record, inParams, logger)
      createdCustomer = createResp?.data?.createCustomerV2?.customer || null
    } catch (createErr) {
      const msg = extractCreateCustomerErrorMessage(createErr)
      logger.error('Commerce customer creation failed: ' + msg)
      return errorResponse(500, `registration failed: ${msg}`, logger)
    }

    const token = await tryLogin(emailToUse, inParams, logger)
    if (!token) {
      return errorResponse(500, 'registration failed: customer created but token generation failed', logger)
    }

    let profile = null
    try {
      profile = await fetchCustomerProfile(inParams, token, logger)
    } catch (profileErr) {
      logger.warn('Could not fetch customer profile after registration: ' + profileErr.message)
    }

    try {
      await upsertIdentityStrict(dbClient, record, token, logger, profile, emailToUse, createdCustomer)
    } catch (dbErr) {
      logger.error('Local DB persistence failed after Commerce registration: ' + dbErr.message)
      return errorResponse(500, `registration failed: could not store user in local DB (${dbErr.message})`, logger)
    }

    actionEnd(logger, traceId, 'validateOtp', { statusCode: 200, flowType: 'register' })
    return {
      statusCode: 200,
      body: {
        success: true,
        customer_token: token,
        message: 'registration successful',
        customer: toCustomerResponse(profile, record, emailToUse, createdCustomer)
      }
    }
  } catch (err) {
    const code = err.statusCode || 500
    actionEnd(logger, traceId, 'validateOtp', { statusCode: code, error: err.message })
    return errorResponse(code, err.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
