/**
 * SMS sender stub.
 *
 * When SMS is configured in app_config, this module resolves the template
 * string and logs it.  Replace the stub with a real HTTP call to your SMS
 * gateway when ready for production.
 */

const { resolveTemplate } = require('./template')

/**
 * Send an SMS OTP (stub — logs the resolved message).
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

  const message = resolveTemplate(config.sms_template_string, {
    OTP: otp,
    VALIDITY: validity,
    MOBILE: mobile
  })

  // ── Stub: log the resolved message ──
  // TODO: Replace with actual HTTP call to SMS gateway
  // e.g. POST ${config.sms_api_host}${config.sms_endpoint}
  //      Headers: { 'x-api-key': config.sms_api_key }
  //      Body: { to: mobile, message, template_id: config.sms_template_id }
  logger.info(`[SMS] To: ${mobile} | Template ID: ${config.sms_template_id}`)
  logger.info(`[SMS] Message: ${message}`)
  logger.info(`[SMS] API Host: ${config.sms_api_host}${config.sms_endpoint}`)
}

module.exports = { sendSmsOtp, resolveTemplate }
