/**
 * Tests for lib/otpService.js
 */

jest.mock('../../lib/db', () => ({
  getAppConfig: jest.fn(),
  findOneOrNull: jest.fn(),
  APP_CONFIG_DEFAULTS: {
    otp_expiration_validity: 10,
    otp_in_response: false
  }
}))

jest.mock('../../lib/otp', () => ({
  generateOtpValue: jest.fn(() => '1234'),
  createReferenceId: jest.fn(() => 'otp_test_ref'),
  levenshtein: jest.fn((a, b) => (a === b ? 0 : 5))
}))

jest.mock('../../lib/sms', () => ({
  sendSmsOtp: jest.fn()
}))

jest.mock('../../lib/email', () => ({
  sendEmailOtp: jest.fn()
}))

const { generateOtp, validateOtp } = require('../../lib/otpService')
const { getAppConfig, findOneOrNull } = require('../../lib/db')
const { sendSmsOtp } = require('../../lib/sms')
const { sendEmailOtp } = require('../../lib/email')

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

function mockCollection () {
  return {
    insertOne: jest.fn(),
    deleteOne: jest.fn(),
    updateOne: jest.fn(),
    findOne: jest.fn()
  }
}

function mockDbClient (collections = {}) {
  return {
    collection: jest.fn(name => collections[name] || mockCollection())
  }
}

describe('otpService', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('generateOtp', () => {
    test('throws 403 when module is disabled', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: false })
      const db = mockDbClient()

      await expect(generateOtp(db, { flowType: 'login', loginType: 'mobile', mobile: '9876543210' }, logger))
        .rejects.toMatchObject({ statusCode: 403, message: 'otp module is disabled' })
    })

    test('generates OTP with otp_in_response=true and returns otpValue', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: true, otp_in_response: true, otp_expiration_validity: 5 })
      const otpCol = mockCollection()
      const db = mockDbClient({ otps: otpCol })

      const result = await generateOtp(db, {
        flowType: 'login',
        loginType: 'mobile',
        mobile: '9876543210'
      }, logger)

      expect(result.otpReferenceId).toBe('otp_test_ref')
      expect(result.otpValue).toBe('1234')
      expect(otpCol.insertOne).toHaveBeenCalledTimes(1)
      const doc = otpCol.insertOne.mock.calls[0][0]
      expect(doc.flowType).toBe('login')
      expect(doc.loginType).toBe('mobile')
      expect(doc.mobile).toBe('9876543210')
    })

    test('generates OTP with otp_in_response=false and sends SMS', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: true, otp_in_response: false, otp_expiration_validity: 10 })
      const otpCol = mockCollection()
      const db = mockDbClient({ otps: otpCol })

      const result = await generateOtp(db, {
        flowType: 'register',
        loginType: 'mobile',
        mobile: '9876543210'
      }, logger)

      expect(result.otpReferenceId).toBe('otp_test_ref')
      expect(result.otpValue).toBeUndefined()
      expect(sendSmsOtp).toHaveBeenCalledTimes(1)
    })

    test('sends email when only email provided', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: true, otp_in_response: false, otp_expiration_validity: 10 })
      const otpCol = mockCollection()
      const db = mockDbClient({ otps: otpCol })

      await generateOtp(db, {
        flowType: 'login',
        loginType: 'email',
        email: 'test@example.com'
      }, logger)

      expect(sendEmailOtp).toHaveBeenCalledTimes(1)
      expect(sendSmsOtp).not.toHaveBeenCalled()
    })

    test('throws 400 when no mobile or email for dispatch', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: true, otp_in_response: false, otp_expiration_validity: 10 })
      const otpCol = mockCollection()
      const db = mockDbClient({ otps: otpCol })

      await expect(generateOtp(db, { flowType: 'login', loginType: 'email' }, logger))
        .rejects.toMatchObject({ statusCode: 400 })
      expect(otpCol.deleteOne).toHaveBeenCalled()
    })

    test('throws 502 when SMS dispatch fails', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: true, otp_in_response: false, otp_expiration_validity: 10 })
      sendSmsOtp.mockRejectedValue(new Error('SMS gateway error'))
      const otpCol = mockCollection()
      const db = mockDbClient({ otps: otpCol })

      await expect(generateOtp(db, { flowType: 'login', loginType: 'mobile', mobile: '9876543210' }, logger))
        .rejects.toMatchObject({ statusCode: 502 })
      expect(otpCol.deleteOne).toHaveBeenCalled()
    })

    test('stores registration data in OTP record', async () => {
      getAppConfig.mockResolvedValue({ is_enabled: true, otp_in_response: true, otp_expiration_validity: 5 })
      const otpCol = mockCollection()
      const db = mockDbClient({ otps: otpCol })

      await generateOtp(db, {
        flowType: 'register',
        loginType: 'mobile',
        mobile: '9876543210',
        firstname: 'John',
        lastname: 'Doe'
      }, logger)

      const doc = otpCol.insertOne.mock.calls[0][0]
      expect(doc.flowType).toBe('register')
      expect(doc.firstname).toBe('John')
      expect(doc.lastname).toBe('Doe')
    })
  })

  describe('validateOtp', () => {
    test('throws 400 for invalid otpReferenceId', async () => {
      const otpCol = mockCollection()
      findOneOrNull.mockResolvedValue(null)
      const db = mockDbClient({ otps: otpCol })

      await expect(validateOtp(db, 'bad_ref', '1234', logger))
        .rejects.toMatchObject({ statusCode: 400, message: 'invalid otpReferenceId' })
    })

    test('throws 400 for already consumed OTP', async () => {
      const otpCol = mockCollection()
      findOneOrNull.mockResolvedValue({ otpReferenceId: 'ref1', consumed: true })
      const db = mockDbClient({ otps: otpCol })

      await expect(validateOtp(db, 'ref1', '1234', logger))
        .rejects.toMatchObject({ statusCode: 400, message: 'otp already used' })
    })

    test('throws 400 for expired OTP', async () => {
      const otpCol = mockCollection()
      findOneOrNull.mockResolvedValue({ otpReferenceId: 'ref1', consumed: false, expiresAt: Date.now() - 1000 })
      const db = mockDbClient({ otps: otpCol })

      await expect(validateOtp(db, 'ref1', '1234', logger))
        .rejects.toMatchObject({ statusCode: 400, message: 'otp expired' })
      expect(otpCol.deleteOne).toHaveBeenCalled()
    })

    test('throws 401 for wrong OTP value', async () => {
      const otpCol = mockCollection()
      findOneOrNull.mockResolvedValue({
        otpReferenceId: 'ref1', consumed: false,
        expiresAt: Date.now() + 60000, otp: '1234'
      })
      const db = mockDbClient({ otps: otpCol })

      await expect(validateOtp(db, 'ref1', '9999', logger))
        .rejects.toMatchObject({ statusCode: 401, message: 'invalid otp' })
    })

    test('returns record data on valid OTP', async () => {
      const otpCol = mockCollection()
      findOneOrNull.mockResolvedValue({
        otpReferenceId: 'ref1', consumed: false,
        expiresAt: Date.now() + 60000, otp: '1234',
        flowType: 'login', loginType: 'mobile',
        mobile: '9876543210', email: null,
        firstname: null, lastname: null, customer_id: null
      })
      const db = mockDbClient({ otps: otpCol })

      const result = await validateOtp(db, 'ref1', '1234', logger)

      expect(result.flowType).toBe('login')
      expect(result.loginType).toBe('mobile')
      expect(result.mobile).toBe('9876543210')
      expect(otpCol.updateOne).toHaveBeenCalledWith(
        { otpReferenceId: 'ref1' },
        { $set: expect.objectContaining({ consumed: true }) }
      )
    })

    test('returns registration data from stored record', async () => {
      const otpCol = mockCollection()
      findOneOrNull.mockResolvedValue({
        otpReferenceId: 'ref1', consumed: false,
        expiresAt: Date.now() + 60000, otp: '1234',
        flowType: 'register', loginType: 'mobile',
        mobile: '9876543210', email: null,
        firstname: 'John', lastname: 'Doe', customer_id: null
      })
      const db = mockDbClient({ otps: otpCol })

      const result = await validateOtp(db, 'ref1', '1234', logger)

      expect(result.flowType).toBe('register')
      expect(result.firstname).toBe('John')
      expect(result.lastname).toBe('Doe')
    })
  })
})
