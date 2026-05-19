/**
 * resendOtpAction
 *
 * Public endpoint: POST /resend-otp
 *
 * Accepts { otpReferenceId } — the reference ID issued by the previous generate-otp call.
 * Looks up the existing OTP record, extracts stored identifiers and flow data,
 * then generates a fresh OTP (new value + new referenceId) and dispatches it.
 *
 * Returns { otpReferenceId, otpValue? }
 */

const { Core } = require('@adobe/aio-sdk')
const { errorResponse } = require('../lib/http')
const { getCollection, closeDb, assertModuleEnabled, findOneOrNull } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { generateOtp } = require('../lib/otpService')
const { getAioDbToken } = require('../lib/imsHelper')
const { generateTraceId, actionStart, actionEnd } = require('../lib/logger')

async function main (params) {
  const logger = Core.Logger('resendOtp', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = generateTraceId()

  try {
    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    if (!inParams.otpReferenceId) {
      return errorResponse(400, "missing parameter 'otpReferenceId'", logger)
    }

    const aioDbToken = await getAioDbToken(inParams)
    const { dbClient: client } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      'otps',
      { traceId }
    )
    dbClient = client
    const rawDb = dbClient._rawDbClient || dbClient
    actionStart(rawDb, traceId, 'resendOtp')

    const appConfig = await assertModuleEnabled(dbClient)

    // ── Fetch existing OTP record ─────────────────────────────────────────
    const otpCollection = await dbClient.collection('otps')
    const existingRecord = await findOneOrNull(otpCollection, { otpReferenceId: inParams.otpReferenceId })

    if (!existingRecord) {
      return errorResponse(400, 'invalid otpReferenceId', logger)
    }

    if (existingRecord.consumed) {
      return errorResponse(400, 'otp already used, cannot resend', logger)
    }

    // Allow resend for expired OTPs (expired flag is set when validation was attempted on an expired OTP)
    logger.info(`Resending OTP for flowType=${existingRecord.flowType}, loginType=${existingRecord.loginType}`)

    // ── Generate fresh OTP using stored record data ───────────────────────
    const result = await generateOtp(dbClient, {
      flowType: existingRecord.flowType,
      loginType: existingRecord.loginType,
      mobile: existingRecord.mobile || null,
      email: existingRecord.email || null,
      firstname: existingRecord.firstname || null,
      lastname: existingRecord.lastname || null,
      customer_id: existingRecord.customer_id || null,
      is_customer_exists: existingRecord.is_customer_exists || false,
      is_disabled: existingRecord.is_disabled || false
    }, logger, appConfig)

    actionEnd(rawDb, traceId, 'resendOtp', { statusCode: 200 })
    return { statusCode: 200, body: result }
  } catch (err) {
    const code = err.statusCode || 500
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) actionEnd(rawDb, traceId, 'resendOtp', { statusCode: code, error: err.message })
    return errorResponse(code, err.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
