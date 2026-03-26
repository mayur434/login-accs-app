const { badRequest, notFound, serverError, success } = require('../../lib/http')
const { findOneOrNull } = require('../../lib/db')
const { hasValue } = require('../../lib/params')
const { normalizeMobile, CUSTOMER_IDENTITY_COLLECTION } = require('../../lib/customer')
const { generateCustomerToken, fetchCustomerProfile } = require('../../lib/commerce')

// ── Mobile → email resolution via identity collection ───────────────────

async function resolveLoginEmail(dbClient, params) {
  const loginType = String(params.loginType || '').toLowerCase()

  if (loginType !== 'mobile') {
    const email = String(params.email || '').trim().toLowerCase()
    if (!email) return { error: badRequest("missing parameter(s) 'email'") }
    return { email }
  }

  const rawMobile = params.mobile || params.mobile_number
  if (!rawMobile) return { error: badRequest("missing parameter(s) 'mobile'") }

  let normalizedMobile
  try {
    normalizedMobile = normalizeMobile(rawMobile)
  } catch (e) {
    return { error: badRequest(e.message || 'invalid mobile number') }
  }

  const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
  const identity = await findOneOrNull(collection, { mobile_number: normalizedMobile, status: 'active' })
  if (!identity?.email) return { error: notFound('mobile number not found') }

  return { email: identity.email }
}

// ── Exported handler ────────────────────────────────────────────────────

module.exports = async function login(dbClient, params, logger) {
  try {
    if (!hasValue(params.password)) return badRequest("missing parameter(s) 'password'")

    const resolved = await resolveLoginEmail(dbClient, params)
    if (resolved.error) return resolved.error

    const customerToken = await generateCustomerToken(params, resolved.email, params.password, logger)
    const customer = await fetchCustomerProfile(params, customerToken, logger)

    return {
      statusCode: 200,
      body: {
        success: true,
        customerToken,
        customer
      }
    }
  } catch (error) {
    logger.error(error)
    return serverError(error.message || 'login failed')
  }
}
