/**
 * SMS sender implementation.
 *
 * Primary provider: Kaleyra
 * Fallback provider: ICS (sendmsg.in) when sms_fallback_enabled is true and Kaleyra fails.
 */

const fetch = require('node-fetch')
const { resolveTemplate } = require('./template')

function ensure (condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeMobileNumber (mobile) {
  return String(mobile || '').replace(/\D/g, '')
}

function summarizeProviderResponse (text) {
  const raw = String(text || '').trim()
  if (!raw) return 'empty response body'

  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const summary = {
        id: parsed.id || parsed.messageId || parsed.message_id || null,
        status: parsed.status || parsed.response || parsed.code || null
      }
      return JSON.stringify(summary)
    }
  } catch {
    // Non-JSON responses are expected from some providers.
  }

  return raw.slice(0, 300)
}

async function sendViaKaleyra (config, mobile, message, logger) {
  ensure(config.sms_api_host, 'missing sms_api_host for Kaleyra')
  ensure(config.sms_endpoint, 'missing sms_endpoint for Kaleyra')
  ensure(config.sms_api_key, 'missing sms_api_key for Kaleyra')
  ensure(config.sms_sender_id, 'missing sms_sender_id for Kaleyra')

  const url = `${config.sms_api_host}${config.sms_endpoint}`
  const body = new URLSearchParams({
    to: normalizeMobileNumber(mobile),
    sender: config.sms_sender_id,
    body: message,
    type: config.sms_type || 'OTP'
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': config.sms_api_key,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Kaleyra failed (${res.status}): ${text.slice(0, 400)}`)
  }

  logger.info(`[SMS] Kaleyra success for ${mobile} | ${summarizeProviderResponse(text)}`)
}

async function sendViaIcs (config, mobile, message, logger) {
  ensure(config.sms_ics_api_host, 'missing sms_ics_api_host for ICS')
  ensure(config.sms_ics_endpoint, 'missing sms_ics_endpoint for ICS')
  ensure(config.sms_ics_username, 'missing sms_ics_username for ICS')
  ensure(config.sms_ics_password, 'missing sms_ics_password for ICS')
  ensure(config.sms_ics_sender, 'missing sms_ics_sender for ICS')

  const query = new URLSearchParams({
    username: config.sms_ics_username,
    password: config.sms_ics_password,
    from: config.sms_ics_sender,
    urlshortening: config.sms_ics_urlshortening || '1',
    to: normalizeMobileNumber(mobile),
    text: message
  })

  const url = `${config.sms_ics_api_host}${config.sms_ics_endpoint}?${query.toString()}`
  const res = await fetch(url, { method: 'GET' })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`ICS failed (${res.status}): ${text.slice(0, 400)}`)
  }

  logger.info(`[SMS] ICS fallback success for ${mobile} | ${summarizeProviderResponse(text)}`)
}

/**
 * Send an SMS OTP via Kaleyra, fallback to ICS when sms_fallback_enabled is true.
 *
 * @param {object} config  - Full app_config object
 * @param {string} mobile  - Destination mobile number
 * @param {string} otp     - OTP value
 * @param {number} validity - OTP validity in minutes
 * @param {object} logger
 */
async function sendSmsOtp (config, mobile, otp, validity, logger) {
  if (!config.sms_template_enabled) {
    logger.info('[SMS] Template disabled — skipping SMS delivery')
    return
  }

  ensure(mobile, 'missing destination mobile number')

  const message = resolveTemplate(config.sms_template_string, {
    OTP: otp,
    VALIDITY: validity,
    MOBILE: mobile,
    otp,
    validity,
    mobile
  })

  try {
    await sendViaKaleyra(config, mobile, message, logger)
    return
  } catch (kaleyraErr) {
    logger.warn('[SMS] Kaleyra failed: ' + kaleyraErr.message)

    if (!config.sms_fallback_enabled) {
      throw kaleyraErr
    }

    await sendViaIcs(config, mobile, message, logger)
  }
}

module.exports = { sendSmsOtp, resolveTemplate }
