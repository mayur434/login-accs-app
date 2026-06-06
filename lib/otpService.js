/**
 * OTP Service Library
 *
 * Provides two core operations:
 *   generateOtp  — generate and store an OTP with identifier and flowType
 *   validateOtp  — validate an OTP and return stored data
 *
 * flowType values: 'login' | 'register'
 */

const { getAppConfig, findOneOrNull, APP_CONFIG_DEFAULTS } = require('./db')
const { generateOtpValue, createReferenceId, levenshtein } = require('./otp')
const { sendSmsOtp } = require('./sms')
const { sendEmailOtp } = require('./email')

/**
 * Generate an OTP, store it in the otps collection, and dispatch via SMS/Email.
 *
 * @param {object}  dbClient    — connected DB client
 * @param {object}  opts
 * @param {string}  opts.flowType       — 'login' | 'register'
 * @param {string}  opts.loginType      — 'mobile' | 'email'
 * @param {string}  [opts.mobile]       — mobile number (raw)
 * @param {string}  [opts.email]        — email address
 * @param {string}  [opts.firstname]    — first name (stored for register flow)
 * @param {string}  [opts.lastname]     — last name (stored for register flow)
 * @param {string}  [opts.customer_id]  — existing customer id (if known)
 * @param {object}  logger
 * @param {object}  [cachedAppConfig]   — pre-fetched app config to avoid duplicate DB read
 * @returns {Promise<{ otpReferenceId: string, otpValue?: string }>} otpValue only when otp_in_response is true
 */
async function generateOtp (dbClient, opts, logger, cachedAppConfig) {
  const otpCollection = await dbClient.collection('otps')
  const appConfig = cachedAppConfig || await getAppConfig(dbClient)

  if (!appConfig.is_enabled) {
    throw Object.assign(new Error('otp module is disabled'), { statusCode: 403 })
  }

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
    flowType: opts.flowType,
    loginType: opts.loginType,
    mobile: opts.mobile || null,
    email: opts.email || null,
    customer_id: opts.customer_id || null,
    firstname: opts.firstname || null,
    lastname: opts.lastname || null,
    is_customer_exists: opts.is_customer_exists || false,
    is_disabled: opts.is_disabled || false,
    // Pending update fields (flowType: 'update')
    customer_token: opts.customer_token || null,
    pending_email: opts.pending_email || null,
    pending_mobile: opts.pending_mobile || null,
    pending_firstname: opts.pending_firstname || null,
    pending_lastname: opts.pending_lastname || null,
    createdAt: Date.now(),
    expiresAt: Date.now() + (otpValidityMinutes * 60 * 1000),
    otpExpirationValidityMinutes: otpValidityMinutes,
    consumed: false
  })

  // Dispatch OTP via SMS / Email when bypass is OFF
  if (!otpInResponse) {
    const mobileTarget = opts.mobile || null
    const emailTarget = opts.email || null

    try {
      if (mobileTarget) {
        await sendSmsOtp(appConfig, mobileTarget, otpValue, otpValidityMinutes, logger)
      } else if (emailTarget) {
        await sendEmailOtp(appConfig, emailTarget, otpValue, otpValidityMinutes, logger)
      } else {
        await otpCollection.deleteOne({ otpReferenceId: ref })
        throw Object.assign(new Error("missing parameter(s) 'mobile' or 'email'"), { statusCode: 400 })
      }
    } catch (dispatchErr) {
      if (dispatchErr.statusCode) throw dispatchErr
      await otpCollection.deleteOne({ otpReferenceId: ref })
      logger.warn('OTP dispatch failed: ' + dispatchErr.message)
      throw Object.assign(new Error('failed to deliver otp notification'), { statusCode: 502 })
    }
  }

  return otpInResponse
    ? { otpReferenceId: ref, otpValue }
    : { otpReferenceId: ref }
}

/**
 * Validate an OTP and return the stored record data.
 *
 * @param {object} dbClient     — connected DB client
 * @param {string} otpReferenceId
 * @param {string} otpValue
 * @param {object} logger
 * @returns {Promise<{ flowType: string, loginType: string, mobile: string|null, email: string|null, firstname: string|null, lastname: string|null, customer_id: string|null, is_customer_exists: boolean, is_disabled: boolean }>}
 */
async function validateOtp (dbClient, otpReferenceId, otpValue, logger) {
  const otpCollection = await dbClient.collection('otps')

  const record = await findOneOrNull(otpCollection, { otpReferenceId })
  if (!record) {
    throw Object.assign(new Error('invalid otpReferenceId'), { statusCode: 400 })
  }
  if (record.consumed) {
    throw Object.assign(new Error('otp already used'), { statusCode: 400 })
  }

  if (Date.now() > record.expiresAt) {
    await otpCollection.deleteOne({ otpReferenceId })
    throw Object.assign(new Error('otp expired'), { statusCode: 400 })
  }

  // Strict equality check — no fuzzy matching for security
  if (String(otpValue).trim() !== String(record.otp).trim()) {
    throw Object.assign(new Error('invalid otp'), { statusCode: 401 })
  }

  // Mark OTP as consumed
  await otpCollection.updateOne(
    { otpReferenceId },
    { $set: { consumed: true, consumedAt: Date.now() } }
  )

  return {
    flowType: record.flowType,
    loginType: record.loginType,
    mobile: record.mobile,
    email: record.email,
    firstname: record.firstname,
    lastname: record.lastname,
    customer_id: record.customer_id,
    is_customer_exists: record.is_customer_exists || false,
    is_disabled: record.is_disabled || false,
    // Pending update fields (flowType: 'update')
    customer_token: record.customer_token || null,
    pending_email: record.pending_email || null,
    pending_mobile: record.pending_mobile || null,
    pending_firstname: record.pending_firstname || null,
    pending_lastname: record.pending_lastname || null
  }
}

module.exports = { generateOtp, validateOtp }
