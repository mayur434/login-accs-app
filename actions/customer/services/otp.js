const { normalizeMobile } = require('../../utils')
const { badRequest, unauthorized, forbidden, notFound, conflict, serverError } = require('../../lib/http')
const { getAppConfig, findOneOrNull, APP_CONFIG_DEFAULTS } = require('../../lib/db')
const { generateOtpValue, createReferenceId, levenshtein } = require('../../lib/otp')
const { hasValue } = require('../../lib/params')
const { CUSTOMER_IDENTITY_COLLECTION } = require('../../lib/customer')

// ── Identity look-ups (backward-compat with legacy field names) ─────────

async function findIdentityByEmail (collection, email, filter = {}) {
  return (
    await findOneOrNull(collection, { email, ...filter }) ||
    await findOneOrNull(collection, { resolvedEmail: email, ...filter })
  )
}

async function findIdentityByMobile (collection, rawMobile, filter = {}) {
  let normalizedMobile = rawMobile
  try { normalizedMobile = normalizeMobile(rawMobile) } catch (_) { /* keep raw */ }

  const candidates = [...new Set([rawMobile, normalizedMobile].filter(Boolean))]
  for (const m of candidates) {
    const hit =
      await findOneOrNull(collection, { mobile_number: m, ...filter }) ||
      await findOneOrNull(collection, { mobile: m, ...filter })
    if (hit) return hit
  }
  return null
}

async function checkRegistrationConflict (dbClient, params) {
  const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
  const email = hasValue(params.email) ? String(params.email).trim().toLowerCase() : null
  const mobile = hasValue(params.mobile) ? String(params.mobile).trim()
    : (hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null)

  const emailExists = email ? !!(await findIdentityByEmail(collection, email)) : false
  const mobileExists = mobile ? !!(await findIdentityByMobile(collection, mobile)) : false

  if (!emailExists && !mobileExists) return null

  const reason = emailExists && mobileExists
    ? 'email/mobile already exists'
    : (emailExists ? 'email already exists' : 'mobile already exists')
  return conflict(reason)
}

async function checkLoginExists (dbClient, params) {
  const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
  const loginType = String(params.loginType || '').toLowerCase()
  const activeFilter = { status: 'active' }

  if (loginType === 'mobile') {
    const mobile = hasValue(params.mobile) ? String(params.mobile).trim()
      : (hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null)
    if (!mobile) return false
    return !!(await findIdentityByMobile(collection, mobile, activeFilter))
  }

  const email = hasValue(params.email) ? String(params.email).trim().toLowerCase() : null
  if (!email) return false
  return !!(await findIdentityByEmail(collection, email, activeFilter))
}

// ── Main OTP handler ────────────────────────────────────────────────────

async function handleOtp (dbClient, params, operation, logger) {
  try {
    const otpCollection = await dbClient.collection('otps')
    const appConfig = await getAppConfig(dbClient)

    if (!appConfig.is_enabled) {
      return { response: forbidden('otp module is disabled') }
    }

    const isVerify = hasValue(params.otpReferenceId) && hasValue(params.otpValue)

    if (!isVerify) {
      // ── Validate required fields ──────────────────────────────────
      if (!hasValue(params.loginType)) {
        return { response: badRequest("missing parameter(s) 'loginType'") }
      }
      const lt = String(params.loginType).toLowerCase()
      if (lt === 'mobile' && !hasValue(params.mobile) && !hasValue(params.mobile_number)) {
        return { response: badRequest("missing parameter(s) 'mobile'") }
      }
      if (lt !== 'mobile' && !hasValue(params.email)) {
        return { response: badRequest("missing parameter(s) 'email'") }
      }

      // ── Identity existence check ──────────────────────────────────
      if (operation === 'register') {
        const conflictResponse = await checkRegistrationConflict(dbClient, params)
        if (conflictResponse) return { response: conflictResponse }
      }
      if (operation === 'login') {
        if (!(await checkLoginExists(dbClient, params))) {
          return { response: notFound('user not found') }
        }
      }

      // ── Generate OTP ──────────────────────────────────────────────
      const otpValue = generateOtpValue()
      const ref = createReferenceId()
      const otpValidityMinutes = (Number.isInteger(appConfig.otp_expiration_validity) && appConfig.otp_expiration_validity > 0)
        ? appConfig.otp_expiration_validity
        : APP_CONFIG_DEFAULTS.otp_expiration_validity
      const otpInResponse = typeof appConfig.otp_in_response === 'boolean'
        ? appConfig.otp_in_response
        : APP_CONFIG_DEFAULTS.otp_in_response

      await otpCollection.insertOne({
        otpReferenceId: ref,
        otp: otpValue,
        operation,
        loginType: params.loginType,
        mobile: params.mobile || params.mobile_number || null,
        email: params.email || null,
        customer_id: params.customer_id || null,
        firstname: params.firstname || params.firstName || null,
        firstName: params.firstName || params.firstname || null,
        lastname: params.lastname || params.lastName || null,
        lastName: params.lastName || params.lastname || null,
        createdAt: Date.now(),
        expiresAt: Date.now() + (otpValidityMinutes * 60 * 1000),
        otpExpirationValidityMinutes: otpValidityMinutes,
        consumed: false
      })

      return {
        response: {
          statusCode: 200,
          body: otpInResponse ? { otpReferenceId: ref, otpValue } : { otpReferenceId: ref }
        }
      }
    }

    // ── Verify OTP ────────────────────────────────────────────────────
    const record = await otpCollection.findOne({ otpReferenceId: params.otpReferenceId })
    if (!record) return { response: badRequest('invalid otpReferenceId') }
    if (record.consumed) return { response: badRequest('otp already used') }

    if (Date.now() > record.expiresAt) {
      await otpCollection.deleteOne({ otpReferenceId: params.otpReferenceId })
      return { response: badRequest('otp expired') }
    }

    if (record.operation !== operation) {
      return { response: badRequest(`otp not valid for operation: ${operation}`) }
    }

    const distance = levenshtein(String(params.otpValue), String(record.otp))
    if (distance > 1) return { response: unauthorized('invalid otp') }

    await otpCollection.updateOne(
      { otpReferenceId: params.otpReferenceId },
      { $set: { consumed: true, consumedAt: Date.now() } }
    )

    return { verified: true, record }
  } catch (e) {
    logger.error(e)
    return { response: serverError(e.message || 'server error') }
  }
}

module.exports = { handleOtp }
