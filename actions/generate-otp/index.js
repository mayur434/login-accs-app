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
const { getCollection, closeDb, assertModuleEnabled, findOneOrNull } = require('../lib/db')
const { getRequestParams, hasValue } = require('../lib/params')
const { inferLoginTypeFromParams, normalizeMobile, normalizeEmailInput, CUSTOMER_IDENTITY_COLLECTION } = require('../lib/customer')
const { generateOtp } = require('../lib/otpService')
const { getAioDbToken } = require('../lib/imsHelper')
const { generateTraceId, actionStart, actionEnd } = require('../lib/logger')

async function main (params) {
  const logger = Core.Logger('generateOtp', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = generateTraceId()

  try {
    const inParams = getRequestParams(params)
    const loginType = inferLoginTypeFromParams(inParams)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    if (!loginType) {
      return errorResponse(400, "provide at least one identifier: 'email' or 'mobile'", logger)
    }

    if (hasValue(inParams.mobile) || hasValue(inParams.mobile_number)) {
      const rawMobile = hasValue(inParams.mobile) ? inParams.mobile : inParams.mobile_number
      try {
        const normalizedMobile = normalizeMobile(rawMobile)
        inParams.mobile = normalizedMobile
        inParams.mobile_number = normalizedMobile
      } catch (e) {
        return errorResponse(400, e.message || 'invalid indian mobile number', logger)
      }
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

    const appConfig = await assertModuleEnabled(dbClient)

    // ── Check if user exists in identity table ────────────────────────
    const identityCollection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
    let userExists = false

    if (loginType === 'mobile' || loginType === 'both') {
      const identity = await findOneOrNull(identityCollection, { mobile_number: inParams.mobile, status: 'active' })
      userExists = !!identity
    }
    if (!userExists && (loginType === 'email' || loginType === 'both')) {
      const email = String(inParams.email).trim().toLowerCase()
      const identity = await findOneOrNull(identityCollection, { email, status: 'active' })
      userExists = !!identity
    }

    // ── Determine flowType ────────────────────────────────────────────
    console.log("autologin: " +appConfig.autoLogin);
    const autoLogin = !!(appConfig.auto_register || appConfig.auto_login)
    let flowType
    if (userExists) {
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
      mobile: inParams.mobile || null,
      email: inParams.email || null,
      firstname: inParams.firstname || inParams.firstName || null,
      lastname: inParams.lastname || inParams.lastName || null
    }, logger)

    actionEnd(rawDb, traceId, 'generateOtp', { statusCode: 200, flowType })
    return { statusCode: 200, body: result }
  } catch (err) {
    const code = err.statusCode || 500
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) actionEnd(rawDb, traceId, 'generateOtp', { statusCode: code, error: err.message })
    return errorResponse(code, err.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
