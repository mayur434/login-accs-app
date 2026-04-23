/**
 * Unit tests for actions/config/index.js
 *
 * Tests the config action main function with mocked DB and Adobe SDK.
 */

jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }),
    AuthClient: {
      generateAccessToken: jest.fn().mockResolvedValue({ access_token: 'mock-token' })
    }
  }
}))

jest.mock('../actions/lib/imsHelper', () => ({
  getAioDbToken: jest.fn().mockResolvedValue('mock-ims-token')
}))

const mockCollection = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn()
}

jest.mock('../actions/lib/db', () => {
  const actualDb = jest.requireActual('../actions/lib/db')
  return {
    ...actualDb,
    getCollection: jest.fn().mockResolvedValue({
      dbClient: { collection: jest.fn().mockResolvedValue(mockCollection), close: jest.fn() },
      collection: mockCollection
    }),
    closeDb: jest.fn(),
    findOneOrNull: jest.fn()
  }
})

const { main } = require('../actions/config/index')
const { findOneOrNull } = require('../actions/lib/db')

beforeEach(() => {
  jest.clearAllMocks()
})

describe('config action', () => {
  const baseParams = {
    __ow_headers: { host: 'localhost:9080' },
    LOG_LEVEL: 'info'
  }

  describe('GET', () => {
    test('returns normalized config when document exists', async () => {
      findOneOrNull.mockResolvedValue({
        _id: 'app_config',
        is_enabled: true,
        otp_expiration_validity: 5,
        otp_in_response: true,
        auto_register: false,
        allow_key_info_update: true,
        sms_template_enabled: false,
        email_template_enabled: false
      })
      mockCollection.findOne.mockResolvedValue({
        _id: 'app_config',
        is_enabled: true,
        otp_expiration_validity: 5,
        otp_in_response: true,
        auto_register: false,
        allow_key_info_update: true,
        sms_template_enabled: false,
        email_template_enabled: false
      })

      const result = await main({ ...baseParams, __ow_method: 'GET' })
      expect(result.statusCode).toBe(200)
      expect(result.body).toBeDefined()
    })
  })

  describe('POST — validation', () => {
    test('rejects empty body', async () => {
      const result = await main({ ...baseParams, __ow_method: 'POST' })
      expect(result.statusCode).toBe(400)
      expect(result.body.error).toContain('at least one configuration field')
    })

    test('rejects non-boolean is_enabled', async () => {
      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        is_enabled: 'yes'
      })
      expect(result.statusCode).toBe(400)
      expect(result.body.error).toContain('is_enabled must be boolean')
    })

    test('rejects non-integer otp_expiration_validity', async () => {
      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        otp_expiration_validity: -1
      })
      expect(result.statusCode).toBe(400)
      expect(result.body.error).toContain('otp_expiration_validity must be a positive integer')
    })

    test('rejects non-string sms_api_host', async () => {
      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        sms_api_host: 123
      })
      expect(result.statusCode).toBe(400)
      expect(result.body.error).toContain('sms_api_host must be a string')
    })

    test('accepts valid boolean fields', async () => {
      mockCollection.findOne.mockResolvedValue({ _id: 'app_config', is_enabled: true })
      findOneOrNull.mockResolvedValue({ _id: 'app_config', is_enabled: true })

      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        is_enabled: true
      })
      expect(result.statusCode).toBe(200)
    })

    test('accepts SMS string fields', async () => {
      mockCollection.findOne.mockResolvedValue({ _id: 'app_config' })
      findOneOrNull.mockResolvedValue({ _id: 'app_config' })

      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        sms_api_host: 'https://sms.example.com',
        sms_endpoint: '/send',
        sms_api_key: 'key123'
      })
      expect(result.statusCode).toBe(200)
    })

    test('accepts Email fields', async () => {
      mockCollection.findOne.mockResolvedValue({ _id: 'app_config' })
      findOneOrNull.mockResolvedValue({ _id: 'app_config' })

      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        email_smtp_host: 'smtp.example.com',
        email_smtp_port: 465,
        email_from_address: 'noreply@example.com'
      })
      expect(result.statusCode).toBe(200)
    })

    test('maps auto_login to auto_register', async () => {
      mockCollection.findOne.mockResolvedValue({ _id: 'app_config' })
      findOneOrNull.mockResolvedValue({ _id: 'app_config' })

      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        auto_login: true
      })
      expect(result.statusCode).toBe(200)
      // The updateOne should have been called with auto_register
      const updateCall = mockCollection.updateOne.mock.calls[0]
      expect(updateCall[1].$set.auto_register).toBe(true)
    })

    test('accepts Google SSO fields', async () => {
      mockCollection.findOne.mockResolvedValue({ _id: 'app_config' })
      findOneOrNull.mockResolvedValue({ _id: 'app_config' })

      const result = await main({
        ...baseParams,
        __ow_method: 'POST',
        google_sso_enabled: true,
        google_client_id: 'client-id.apps.googleusercontent.com',
        google_client_secret: 'secret'
      })
      expect(result.statusCode).toBe(200)
    })
  })

  describe('DELETE', () => {
    test('deletes config', async () => {
      const result = await main({
        ...baseParams,
        __ow_method: 'DELETE'
      })
      expect(result.statusCode).toBe(200)
      expect(result.body.success).toBe(true)
      expect(mockCollection.deleteOne).toHaveBeenCalledWith({ _id: 'app_config' })
    })
  })
})
