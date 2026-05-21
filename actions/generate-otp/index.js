/**
 * generateOtpAction
 *
 * Public endpoint: POST /generate-otp
 *
 * Accepts { mobile } or { email }.
 * - Checks if user exists in identity table.
 *   - If user exists → generateOtp with flowType: 'login'
 *   - If user does NOT exist:
 *     - If auto_register is enabled → generateOtp with flowType: 'register' (stores identifier)
 *     - Else → error "User not found. Please register first."
 *
 * Returns { otpReferenceId, otpValue? }
 */

const { Core } = require('@adobe/aio-sdk')
const { errorResponse } = require('../lib/http')
const { getCollection, closeDb, assertModuleEnabled } = require('../lib/db')
const { getRequestParams, hasValue } = require('../lib/params')
const { inferLoginTypeFromParams, normalizeEmailInput, getCommerceMobileValue } = require('../lib/customer')
const { generateOtp } = require('../lib/otpService')
const { getAioDbToken } = require('../lib/imsHelper')
const { generateTraceId, actionStart, actionEnd } = require('../lib/logger')
const { graphQLRequest } = require('../lib/graphql')

async function main (params) {
  const logger = Core.Logger('generateOtp', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = generateTraceId()

  try {
    const inParams = getRequestParams(params)
    const loginType = inferLoginTypeFromParams(inParams)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    if (!loginType) {
      return { statusCode: 400, body: { error: `${loginType == "mobile"? "Mobile Number": "Email ID"} cannot be empty` } }
    }

    if (hasValue(inParams.mobile) || hasValue(inParams.mobile_number)) {
      const rawMobile = hasValue(inParams.mobile) ? inParams.mobile : inParams.mobile_number
      inParams.mobile = rawMobile
      inParams.mobile_number = rawMobile
    }

    if (hasValue(inParams.email)) {
      try {
        inParams.email = normalizeEmailInput(inParams.email)
      } catch (e) {
        return errorResponse(400, e.message || 'invalid email', logger)
      }
    }

    const aioDbToken = await getAioDbToken(inParams)
    const { dbClient: client } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      'otps',
      { traceId }
    )
    dbClient = client
    const rawDb = dbClient._rawDbClient || dbClient
    actionStart(rawDb, traceId, 'generateOtp')

    const isCustomerExistsQuery = `query IsCustomerExists($email: String!, $mobile_number: String!) {
      isCustomerExists(email: $email, mobile_number: $mobile_number) {
        is_customer_exists
        is_disabled
      }
    }`
    const gqlVariables = {
      email: inParams.email || '',
      mobile_number: getCommerceMobileValue(inParams.mobile || inParams.mobile_number) || ''
    }

    const [appConfig, gqlResp] = await Promise.all([
      assertModuleEnabled(dbClient),
      graphQLRequest(inParams, isCustomerExistsQuery, gqlVariables, logger)
    ])

    const customerStatus = gqlResp?.data?.isCustomerExists
    const isCustomerExists = !!customerStatus?.is_customer_exists
    const isDisabled = !!customerStatus?.is_disabled

    // ── Block disabled customers ──────────────────────────────────────
    if (isDisabled) {
      return { statusCode: 403, body: { error: 'Your account has been locked. Please contact our support team for your account activation' } }
    }

    // ── Determine flowType ────────────────────────────────────────────
    console.log("autologin: " +appConfig.autoLogin);
    const autoLogin = !!(appConfig.auto_register || appConfig.auto_login)
    let flowType
    if (isCustomerExists) {
      flowType = 'login'
      logger.info(`User exists → flowType=login`)
    } else if (autoLogin) {
      flowType = 'register'
      logger.info(`User not found, auto_login=true → flowType=register (will auto-register on OTP validation)`)
    } else {
      return errorResponse(404, 'User not found. Please register first.', logger)
    }

    // ── Generate OTP ──────────────────────────────────────────────────
    const result = await generateOtp(dbClient, {
      flowType,
      loginType,
      mobile: inParams.mobile || inParams.mobile_number || null,
      email: inParams.email || null,
      firstname: inParams.firstname || inParams.firstName || null,
      lastname: inParams.lastname || inParams.lastName || null,
      dob: inParams.dob || null,
      gender: inParams.gender || null,
      doa: inParams.doa || null,
      is_customer_exists: isCustomerExists,
      is_disabled: isDisabled
    }, logger, appConfig)

    actionEnd(rawDb, traceId, 'generateOtp', { statusCode: 200, flowType })
    return { statusCode: 200, body: result }
  } catch (err) {
    const code = err.statusCode || 500
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) actionEnd(rawDb, traceId, 'generateOtp', { statusCode: code, error: err.message })

    // Return proper status codes with { error } field for API Mesh ErrorResponse
    const msg = err.message || ''
    if (code === 400 && msg.includes('mobile')) {
      return { statusCode: 400, body: { error: 'Mobile Number cannot be empty' } }
    }
    if (code === 400 && msg.includes('email')) {
      return { statusCode: 400, body: { error: 'Email ID cannot be empty' } }
    }
    if (code === 400) {
      return { statusCode: 400, body: { error: msg || 'Invalid input' } }
    }
    if (code === 403) {
      return { statusCode: 403, body: { error: 'Your account has been locked. Please contact our support team for your account activation' } }
    }
    if (code === 429 || msg.toLowerCase().includes('max attempts') || msg.toLowerCase().includes('exceeded')) {
      return { statusCode: 429, body: { error: 'User has exceeded max attempts of generating OTP' } }
    }
    if (code === 502 || msg.includes('failed to deliver')) {
      return { statusCode: 502, body: { error: 'Generate OTP API failed due to header status failure' } }
    }
    return { statusCode: 500, body: { error: 'Generate OTP API failed due to header status failure' } }
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
