const { badRequest, notFound, serverError } = require('../../lib/http')
const { findOneOrNull, isUniqueConstraintError } = require('../../lib/db')
const { hasValue } = require('../../lib/params')
const { normalizeMobile, CUSTOMER_IDENTITY_COLLECTION, parseCustomerIdFromToken, buildLoginType, getSyntheticEmail } = require('../../lib/customer')
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

    // Upsert identity on every successful login
    try {
      const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
      const customerId = customer?.id ? Number(customer.id) : parseCustomerIdFromToken(customerToken)
      let normalizedMobile = null
      const rawMobile = params.mobile || params.mobile_number
      if (rawMobile) {
        try { normalizedMobile = normalizeMobile(rawMobile) } catch (_) { normalizedMobile = rawMobile }
      }

      // Look up existing identity to protect real emails
      const existing = customerId ? await findOneOrNull(collection, { customer_id: customerId }) : null

      // Never overwrite a real email with a pattern email
      let emailToStore = resolved.email
      if (existing?.email && !/^\d+@email\.com$/i.test(existing.email)) {
        // Existing identity has a real (non-pattern) email — keep it
        emailToStore = existing.email
      }

      const hasEmail = !!emailToStore
      const hasMobile = !!normalizedMobile
      const loginType = buildLoginType(hasEmail, hasMobile)
      const now = new Date()

      const doc = {
        email: emailToStore,
        mobile_number: normalizedMobile,
        customer_id: customerId,
        status: 'active',
        updated_at: now
      }

      if (customerId) {
        await collection.updateOne(
          { customer_id: customerId },
          { $set: doc, $setOnInsert: { login_type: loginType, created_at: now } },
          { upsert: true }
        )
      }
      logger.info(`Identity upserted for customer_id=${customerId}, email=${emailToStore}`)
    } catch (e) {
      if (!isUniqueConstraintError(e)) {
        logger.warn('identity upsert on login failed (non-critical): ' + e.message)
      }
    }

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
