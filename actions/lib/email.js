/**
 * Email sender implementation via SMTP (nodemailer).
 */

const nodemailer = require('nodemailer')
const { resolveTemplate } = require('./template')

function ensure (condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * Send an Email OTP via SMTP.
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

  ensure(email, 'missing destination email')
  ensure(config.email_smtp_host, 'missing email_smtp_host')
  ensure(config.email_smtp_port, 'missing email_smtp_port')
  ensure(config.email_smtp_user, 'missing email_smtp_user')
  ensure(config.email_smtp_password, 'missing email_smtp_password')
  ensure(config.email_from_address, 'missing email_from_address')

  const message = resolveTemplate(config.email_template_string, {
    OTP: otp,
    VALIDITY: validity,
    EMAIL: email,
    otp,
    validity,
    email
  })

  const port = Number(config.email_smtp_port)
  const secure = port === 465
  const transporter = nodemailer.createTransport({
    host: config.email_smtp_host,
    port,
    secure,
    auth: {
      user: config.email_smtp_user,
      pass: config.email_smtp_password
    }
  })

  const fromName = config.email_from_name ? `${config.email_from_name} ` : ''
  const from = `${fromName}<${config.email_from_address}>`

  await transporter.sendMail({
    from,
    to: email,
    subject: config.email_subject || 'Your OTP for Vijay Sales',
    text: message.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    html: message
  })

  logger.info(`[Email] SMTP success for ${email}`)
}

module.exports = { sendEmailOtp, resolveTemplate }
