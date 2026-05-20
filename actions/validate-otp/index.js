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
const { getCollection, closeDb, assertModuleEnabled } = require('../lib/db')
const { commerceGraphQLRequest } = require('../lib/graphql')
const { getRequestParams } = require('../lib/params')
const {
  INTERNAL_CUSTOMER_PASSWORD,
  normalizeMobile,
  getSyntheticEmail,
  getCommerceMobileValue
} = require('../lib/customer')
const { validateOtp } = require('../lib/otpService')
const { getAioDbToken } = require('../lib/imsHelper')
const { fetchCustomerProfile } = require('../lib/commerce')
const { generateTraceId, actionStart, actionEnd } = require('../lib/logger')

// ── Commerce helpers ────────────────────────────────────────────────────

async function tryLogin (email, params, logger) {
  const mutation = `mutation generateCustomerToken($email: String!, $password: String!){ generateCustomerToken(email: $email, password: $password){ token } }`
  try {
    const resp = await commerceGraphQLRequest(params, mutation, { email, password: INTERNAL_CUSTOMER_PASSWORD }, logger)
    if (resp?.data?.generateCustomerToken?.token) return resp.data.generateCustomerToken.token
  } catch (e) {
    logger.debug?.('generateCustomerToken failed: ' + e.message)
  }
  return null
}

async function createAndLogin (email, mobile, opts, params, logger) {
  const firstname = opts.firstname || 'guest'
  const lastname = opts.lastname || 'user'

  const input = {
    firstname,
    lastname,
    email,
    password: INTERNAL_CUSTOMER_PASSWORD
  }

  // dob — same field name as updateCustomerV2
  if (opts.dob) {
    input.date_of_birth = opts.dob
  }

  // gender — pass as string (same as update flow)
  if (opts.gender) {
    input.gender = opts.gender
  }

  // custom_attributes: mobile_number + doa
  const customAttributes = []
  if (mobile) {
    try {
      const mobileValue = mobile;
      if (mobileValue) {
        input.vs_mobile_number = mobileValue;
      }
    } catch (err) {
      logger.debug?.('Skipping mobile attribute after normalization failure: ' + err.message)
    }
  }
  if (opts.doa) {
    customAttributes.push({ attribute_code: 'doa', value: opts.doa })
  }
  if (customAttributes.length) {
    input.custom_attributes = customAttributes
  }

  const mutation = `mutation CreateAndLogin($input: CustomerCreateInput!, $email: String!, $password: String!) {
    createCustomerWrapper: createCustomerV2(input: $input) { customer { id firstname lastname email date_of_birth gender custom_attributes { code ...on AttributeValue { value } } } }
    generateCustomerToken: generateCustomerToken(email: $email, password: $password) { token }
  }`
  return commerceGraphQLRequest(params, mutation, { input, email, password: INTERNAL_CUSTOMER_PASSWORD }, logger)
}

function extractCreateCustomerErrorMessage (err) {
  const message = String(err?.message || '').toLowerCase()
  if (message.includes('already exists')) return 'customer already exists in Commerce'
  if (message.includes('is invalid')) return 'invalid customer details for Commerce registration'
  return err?.message || 'customer creation failed in Commerce'
}

function resolvePrimaryLoginType (email, normalizedMobile) {
  if (email && normalizedMobile) return 'both'
  if (normalizedMobile) return 'mobile'
  if (email) return 'email'
  return null
}

function resolveNormalizedMobile (value) {
  if (!value) return null
  try {
    return normalizeMobile(value)
  } catch {
    return value
  }
}

function extractProfileMobile (profile) {
  const attrs = profile?.custom_attributes
  if (!Array.isArray(attrs)) return null
  const mobileAttr = attrs.find(a => String(a?.attribute_code || '').trim() === 'mobile_number')
  return mobileAttr?.value ? resolveNormalizedMobile(mobileAttr.value) : null
}

function toCustomerResponse (profile, record, fallbackEmail, createdCustomer = null) {
  let customerId = null
  const profileOrCreateId = profile?.id ?? createdCustomer?.id
  if (profileOrCreateId !== undefined && profileOrCreateId !== null && profileOrCreateId !== '') {
    const parsed = Number(profileOrCreateId)
    customerId = Number.isNaN(parsed) ? profileOrCreateId : parsed
  }

  const normalizedMobile =
    resolveNormalizedMobile(record?.mobile) ||
    extractProfileMobile(profile) ||
    null
  const email = profile?.email || createdCustomer?.email || fallbackEmail || null
  const firstName = profile?.firstname || createdCustomer?.firstname || record?.firstname || null
  const lastName = profile?.lastname || createdCustomer?.lastname || record?.lastname || null
  const loginType =
    record?.loginType ||
    resolvePrimaryLoginType(email, normalizedMobile)

  const mobileForResponse = normalizedMobile ? normalizedMobile.replace(/^\+91/, '') : null
  return {
    customer_id: customerId,
    firstname: firstName,
    lastname: lastName,
    email,
    mobile_number: mobileForResponse,
    login_type: loginType,
    dob: profile?.date_of_birth || record?.dob || null,
    gender: profile?.gender != null ? String(profile.gender) : (record?.gender || null),
    doa: record?.doa || null
  }
}

// ── Resolve Commerce email from identifier ──────────────────────────────

async function resolveEmail (record, logger) {
  if (record.loginType === 'mobile') {
    if (!record.mobile) throw Object.assign(new Error('mobile not present in OTP record'), { statusCode: 400 })
     let normalizedMobile = record.mobile
    try {
      normalizedMobile = normalizeMobile(record.mobile)
    } catch (err) {
      logger.debug?.('Using raw mobile for email resolution after normalization failure: ' + err.message)
    }
    const email = record.email || getSyntheticEmail(normalizedMobile)
    logger.info(`Resolved email=${email} (from otp record/pattern)`)
    return email
  }
  return record.email
}

// ── Main action ─────────────────────────────────────────────────────────

async function main (params) {
  const logger = Core.Logger('validateOtp', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = generateTraceId()

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
      { traceId }
    )
    dbClient = client
    const rawDb = dbClient._rawDbClient || dbClient
    actionStart(rawDb, traceId, 'validateOtp')

    await assertModuleEnabled(dbClient)

    // ── Validate OTP ──────────────────────────────────────────────────
    const record = await Promise.resolve(validateOtp(dbClient, inParams.otpReferenceId, inParams.otpValue, logger))
    logger.info(`OTP validated. flowType=${record.flowType}, loginType=${record.loginType}`)

    if (record.is_disabled) {
      return { statusCode: 403, body: { message: 'Your account has been locked. Please contact our support team for your account activation.' } }
    }

    const emailToUse = await resolveEmail(record, logger)

    // ── flowType: login ─────────────────────────────────────────────
    if (record.flowType === 'login') {
      const token = await tryLogin(record.loginType == "mobile"? record.mobile : emailToUse, inParams, logger)
      if (!token) {
        return errorResponse(404, 'user not found in Commerce', logger)
      }

      let loginProfile = null
      try {
        loginProfile = await fetchCustomerProfile(inParams, token, logger)
      } catch (profileErr) {
        logger.warn('Could not fetch customer profile after login: ' + profileErr.message)
      }

      actionEnd(rawDb, traceId, 'validateOtp', { statusCode: 200, flowType: 'login' });
      return {
        statusCode: 200,
        body: {
          success: true,
          customer_token: token,
          message: 'login successful',
          customer: toCustomerResponse(loginProfile, record, emailToUse)
        }
      }
    }

    // ── flowType: register ──────────────────────────────────────────
    logger.info('Register flow: creating customer in Commerce...')
    let createdCustomer = null
    let token = null
    try {
      const createResp = await createAndLogin(emailToUse, record.mobile, record, inParams, logger)
      createdCustomer = createResp?.data?.createCustomerWrapper?.customer || null
      token = createResp?.data?.generateCustomerToken?.token || null
    } catch (createErr) {
      const msg = extractCreateCustomerErrorMessage(createErr)
      if (msg === 'customer already exists in Commerce') {
        // Customer was partially created in a prior attempt — fall back to login
        logger.info('Customer already exists in Commerce, falling back to login...')
        token = await tryLogin(emailToUse, inParams, logger)
        if (!token) {
          return errorResponse(500, 'registration failed: customer exists but login failed', logger)
        }
      } else {
        logger.error('Commerce customer creation failed: ' + msg)
        return errorResponse(500, `registration failed: ${msg}`, logger)
      }
    }

    if (!token) {
      return errorResponse(500, 'registration failed: customer created but token generation failed', logger)
    }

    let profile = null
    try {
      profile = await fetchCustomerProfile(inParams, token, logger)
    } catch (profileErr) {
      logger.warn('Could not fetch customer profile after registration: ' + profileErr.message)
    }

    actionEnd(rawDb, traceId, 'validateOtp', { statusCode: 200, flowType: 'register' })
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
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) actionEnd(rawDb, traceId, 'validateOtp', { statusCode: code, error: err.message })
    // Return 200 with an error field for expired OTP so the API Mesh maps it through ValidateOtpResponse
    if (code === 410) {
      return { statusCode: 200, body: { error: 'otp expired. please resend to get a new otp.', expired: true } }
    }
    // Wrong OTP value — return as 200 so mesh exposes it under body.msg
    if (code === 401) {
      return { statusCode: 200, body: { success: false, msg: 'OTP mismatched' } }
    }
    // OTP reference not found or already consumed — return as 200 so mesh exposes it under body.msg
    if (code === 400 && (err.message === 'invalid otpReferenceId' || err.message === 'otp already used')) {
      return { statusCode: 200, body: { success: false, msg: 'OTP Validation Failed' } }
    }
    // Server-side failures — return errorBody.msg matching frontend check
    if (code >= 500) {
      return { statusCode: code, body: { msg: 'Internal server error' } }
    }
    return errorResponse(code, err.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main