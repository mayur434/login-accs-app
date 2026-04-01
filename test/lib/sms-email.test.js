/**
 * Unit tests for actions/lib/sms.js and actions/lib/email.js
 */

jest.mock('node-fetch', () => jest.fn())
jest.mock('nodemailer', () => ({
  createTransport: jest.fn()
}))

const fetch = require('node-fetch')
const nodemailer = require('nodemailer')
const { sendSmsOtp } = require('../../actions/lib/sms')
const { sendEmailOtp } = require('../../actions/lib/email')

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}

beforeEach(() => {
  jest.clearAllMocks()
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue('ok')
  })
  nodemailer.createTransport.mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-id' })
  })
})

describe('sendSmsOtp', () => {
  test('skips when sms_template_enabled is false', async () => {
    await sendSmsOtp(
      { sms_template_enabled: false },
      '+919876543210', '1234', 10, mockLogger
    )
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Template disabled'))
  })

  test('sends through Kaleyra when enabled', async () => {
    await sendSmsOtp(
      {
        sms_api_host: 'https://api.kaleyra.io',
        sms_endpoint: '/v1/HX/messages',
        sms_api_key: 'kaleyra-key',
        sms_sender_id: 'VIJAYS',
        sms_type: 'OTP',
        sms_template_enabled: true,
        sms_template_string: 'OTP: {{OTP}}, valid {{VALIDITY}} min'
      },
      '+919876543210', '5678', 5, mockLogger
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('api.kaleyra.io')
  })

  test('uses ICS fallback when Kaleyra fails and fallback is enabled', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: jest.fn().mockResolvedValue('kaleyra failed') })
      .mockResolvedValueOnce({ ok: true, status: 200, text: jest.fn().mockResolvedValue('ics ok') })

    await sendSmsOtp(
      {
        sms_api_host: 'https://api.kaleyra.io',
        sms_endpoint: '/v1/HX/messages',
        sms_api_key: 'kaleyra-key',
        sms_sender_id: 'VIJAYS',
        sms_template_enabled: true,
        sms_template_string: 'OTP: {{OTP}}',
        sms_fallback_enabled: true,
        sms_ics_api_host: 'https://sms.sendmsg.in',
        sms_ics_endpoint: '/smpp',
        sms_ics_username: 'ics-user',
        sms_ics_password: 'ics-pass',
        sms_ics_sender: 'VIJAYS'
      },
      '+919876543210', '1234', 10, mockLogger
    )

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toContain('sms.sendmsg.in')
  })

  test('throws when Kaleyra fails and fallback is disabled', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: jest.fn().mockResolvedValue('kaleyra failed') })

    await expect(sendSmsOtp(
      {
        sms_api_host: 'https://api.kaleyra.io',
        sms_endpoint: '/v1/HX/messages',
        sms_api_key: 'kaleyra-key',
        sms_sender_id: 'VIJAYS',
        sms_template_enabled: true,
        sms_template_string: 'OTP: {{OTP}}',
        sms_fallback_enabled: false
      },
      '+919876543210', '1234', 10, mockLogger
    )).rejects.toThrow('Kaleyra failed')
  })

  test('handles lowercase {{otp}} placeholder', async () => {
    await sendSmsOtp(
      {
        sms_api_host: 'https://api.kaleyra.io',
        sms_endpoint: '/v1/HX/messages',
        sms_api_key: 'kaleyra-key',
        sms_sender_id: 'VIJAYS',
        sms_template_enabled: true,
        sms_template_string: 'code={{otp}}'
      },
      '+919876543210', '7777', 10, mockLogger
    )
    const requestOptions = fetch.mock.calls[0][1]
    expect(String(requestOptions.body)).toContain('7777')
  })
})

describe('sendEmailOtp', () => {
  test('skips when email_template_enabled is false', async () => {
    await sendEmailOtp(
      { email_template_enabled: false },
      'test@example.com', '1234', 10, mockLogger
    )
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Template disabled'))
  })

  test('sends SMTP email when enabled', async () => {
    await sendEmailOtp(
      {
        email_smtp_host: 'smtp.example.com',
        email_smtp_port: 587,
        email_smtp_user: 'user',
        email_smtp_password: 'pass',
        email_from_address: 'noreply@example.com',
        email_from_name: 'Store',
        email_template_enabled: true,
        email_template_string: '<b>Your code is {{OTP}}</b>'
      },
      'user@example.com', '9876', 15, mockLogger
    )

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1)
    const transport = nodemailer.createTransport.mock.results[0].value
    expect(transport.sendMail).toHaveBeenCalledTimes(1)
  })

  test('handles lowercase {{otp}} placeholder in email template', async () => {
    await sendEmailOtp(
      {
        email_smtp_host: 'smtp.example.com',
        email_smtp_port: 587,
        email_smtp_user: 'user',
        email_smtp_password: 'pass',
        email_from_address: 'noreply@example.com',
        email_template_enabled: true,
        email_template_string: '<p>{{otp}}</p>'
      },
      'test@example.com', '1234', 10, mockLogger
    )

    const transport = nodemailer.createTransport.mock.results[0].value
    const sendPayload = transport.sendMail.mock.calls[0][0]
    expect(sendPayload.html).toContain('1234')
  })
})
