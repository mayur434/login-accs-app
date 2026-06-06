/**
 * generateOtpAction
 *
 * Public endpoint: POST /generate-otp
 *
 * Accepts { mobile } or { email }.
 * - Checks if user exists in Commerce (parallel with IMS token).
 *   - If user exists → generateOtp with flowType: 'login'
 *   - If user does NOT exist:
 *     - If auto_register is enabled → generateOtp with flowType: 'register'
 *     - Else → error "User not found. Please register first."
 *
 * Returns { otpReferenceId, otpValue? }
 */

const { runAction } = require('../../../lib/actionRunner')
const { errorResponse } = require('../../../lib/http')
const { hasValue } = require('../../../lib/params')
const { inferLoginTypeFromParams, normalizeEmailInput, normalizeMobile } = require('../../../lib/customer')
const { generateOtp } = require('../../../lib/otpService')
const { checkCustomerStatus } = require('../../../lib/commerce')

exports.main = runAction('generateOtp', 'otps', async ({ params, dbClient, logger, appConfig, parallelResult }) => {
  const loginType = inferLoginTypeFromParams(params)
  if (!loginType) {
    return errorResponse(400, "provide at least one identifier: 'email' or 'mobile'", logger)
  }

  const { isCustomerExists, isDisabled } = parallelResult

  if (isDisabled) {
    return errorResponse(403, 'Your account is disabled. Please contact support.', logger)
  }

  const autoLogin = !!(appConfig.auto_register || appConfig.auto_login)
  let flowType
  if (isCustomerExists) {
    flowType = 'login'
  } else if (autoLogin) {
    flowType = 'register'
  } else {
    return errorResponse(404, 'User not found. Please register first.', logger)
  }

  const result = await generateOtp(dbClient, {
    flowType,
    loginType,
    mobile: params.mobile || params.mobile_number || null,
    email: params.email || null,
    firstname: params.firstname || params.firstName || null,
    lastname: params.lastname || params.lastName || null,
    is_customer_exists: isCustomerExists,
    is_disabled: isDisabled
  }, logger, appConfig)

  return { statusCode: 200, body: result }
}, {
  requireModule: true,
  parallelInit: async (params, logger) => {
    // Validate & normalize inputs before Commerce check
    if (hasValue(params.mobile) || hasValue(params.mobile_number)) {
      const raw = hasValue(params.mobile) ? params.mobile : params.mobile_number
      const normalized = normalizeMobile(raw) // throws if invalid
      params.mobile = normalized
      params.mobile_number = normalized
    }
    if (hasValue(params.email)) {
      params.email = normalizeEmailInput(params.email) // throws if invalid
    }
    return checkCustomerStatus(params, params.email, params.mobile || params.mobile_number, logger)
  }
})
