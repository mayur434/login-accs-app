const { runAction } = require('../../../lib/actionRunner')
const { badRequest } = require('../../../lib/http')
const { APP_CONFIG_COLLECTION } = require('../../../lib/db')
const { inferLoginTypeFromParams, normalizeMobile, normalizeEmailInput } = require('../../../lib/customer')
const { hasValue } = require('../../../lib/params')
const { generateOtp } = require('../../../lib/otpService')
const { checkCustomerStatus } = require('../../../lib/commerce')
const update = require('./services/update')

// ── Main action ─────────────────────────────────────────────────────────

exports.main = runAction('customer', APP_CONFIG_COLLECTION, async ({ params, dbClient, logger }) => {
  params.loginType = inferLoginTypeFromParams(params)
  const operation = String(params.operation || '').trim()
  if (!operation) return badRequest("missing parameter(s) 'operation'")

  switch (operation) {
    case 'register': {
      const loginType = params.loginType
      if (!loginType) return badRequest("provide at least one identifier: 'email' or 'mobile'")

      if (hasValue(params.mobile) || hasValue(params.mobile_number)) {
        const rawMobile = hasValue(params.mobile) ? params.mobile : params.mobile_number
        try {
          const normalized = normalizeMobile(rawMobile)
          params.mobile = normalized
          params.mobile_number = normalized
        } catch (e) {
          return badRequest(e.message || 'invalid indian mobile number')
        }
      }

      if (hasValue(params.email)) {
        try {
          params.email = normalizeEmailInput(params.email)
        } catch (e) {
          return badRequest(e.message || 'invalid email')
        }
      }

      const customerStatus = await checkCustomerStatus(params, params.email, params.mobile || params.mobile_number, logger)
      if (customerStatus.isDisabled) {
        return { statusCode: 200, body: { success: false, statusCode: 403, error: 'Your account is disabled. Please contact support.', message: 'Your account is disabled. Please contact support.' } }
      }
      if (customerStatus.isCustomerExists) {
        return { statusCode: 200, body: { success: false, statusCode: 409, error: 'customer already exists', message: 'customer already exists' } }
      }

      const result = await generateOtp(dbClient, {
        flowType: 'register',
        loginType,
        mobile: params.mobile || params.mobile_number || null,
        email: params.email || null,
        firstname: params.firstname || params.firstName || null,
        lastname: params.lastname || params.lastName || null,
        customer_id: params.customer_id || null,
        is_customer_exists: customerStatus.isCustomerExists,
        is_disabled: customerStatus.isDisabled
      }, logger)

      return { statusCode: 200, body: result }
    }

    case 'updateCustomerDetails':
      return update(dbClient, params, logger)

    default:
      return badRequest(`invalid operation: '${operation}'. Use 'register' or 'updateCustomerDetails'.`)
  }
})
