/**
 * Unit tests for actions/lib/sms.js and actions/lib/email.js
 */

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
})

describe('sendSmsOtp', () => {
  test('skips when sms_template_enabled is false', async () => {
    await sendSmsOtp(
      { sms_template_enabled: false },
      '+919876543210', '1234', 10, mockLogger
    )
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Template disabled'))
  })

  test('resolves template and logs when enabled', async () => {
    await sendSmsOtp(
      {
        sms_template_enabled: true,
        sms_template_string: 'OTP: {{OTP}}, valid {{VALIDITY}} min'
      },
      '+919876543210', '5678', 5, mockLogger
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('OTP: 5678, valid 5 min')
    )
  })

  test('handles empty template string', async () => {
    await sendSmsOtp(
      { sms_template_enabled: true, sms_template_string: '' },
      '+919876543210', '1234', 10, mockLogger
    )
    // Should not throw
    expect(mockLogger.info).toHaveBeenCalled()
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

  test('resolves template and logs when enabled', async () => {
    await sendEmailOtp(
      {
        email_template_enabled: true,
        email_template_string: 'Your code is {{OTP}}, valid for {{VALIDITY}} min'
      },
      'user@example.com', '9876', 15, mockLogger
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Your code is 9876, valid for 15 min')
    )
  })

  test('handles empty template string', async () => {
    await sendEmailOtp(
      { email_template_enabled: true, email_template_string: '' },
      'test@example.com', '1234', 10, mockLogger
    )
    expect(mockLogger.info).toHaveBeenCalled()
  })
})
