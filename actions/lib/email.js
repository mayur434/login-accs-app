/**
 * Email sender stub.
 *
 * When Email is configured in app_config, this module resolves the template
 * string and logs it.  Replace the stub with a real SMTP/transactional-email
 * call when ready for production.
 */

const { resolveTemplate } = require('./template')

/**
 * Send an Email OTP (stub — logs the resolved message).
 *
 * @param {object} config   - Full app_config object
 * @param {string} email    - Destination email address
 * @param {string} otp      - OTP value
 * @param {number} validity - OTP validity in minutes
 * @param {object} logger
 */
async function sendEmailOtp (config, email, otp, validity, logger) {
  if (!config.email_template_enabled) {
    logger.info('[Email] Template disabled — skipping email delivery')
    return
  }

  const message = resolveTemplate(config.email_template_string, {
    OTP: otp,
    VALIDITY: validity,
    EMAIL: email
  })

  // ── Stub: log the resolved message ──
  // TODO: Replace with actual SMTP / transactional email call
  // e.g. nodemailer.createTransport({
  //   host: config.email_smtp_host,
  //   port: config.email_smtp_port,
  //   auth: { user: config.email_smtp_user, pass: config.email_smtp_password }
  // }).sendMail({ from: `${config.email_from_name} <${config.email_from_address}>`, to: email, subject: 'Your OTP', text: message })
  logger.info(`[Email] To: ${email} | Template ID: ${config.email_template_id}`)
  logger.info(`[Email] From: ${config.email_from_name} <${config.email_from_address}>`)
  logger.info(`[Email] SMTP: ${config.email_smtp_host}:${config.email_smtp_port}`)
  logger.info(`[Email] Message: ${message}`)
}

module.exports = { sendEmailOtp, resolveTemplate }
