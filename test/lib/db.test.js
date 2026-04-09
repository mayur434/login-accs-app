/**
 * Unit tests for actions/lib/db.js
 *
 * Tests pure utility functions without requiring a live database.
 */

const {
  isDocumentNotFoundError,
  isCollectionNotFoundError,
  isUniqueConstraintError,
  isUnauthorizedDbError,
  assertModuleEnabled,
  normalizeAppConfig,
  APP_CONFIG_DEFAULTS,
  APP_CONFIG_ID,
  APP_CONFIG_COLLECTION
} = require('../../actions/lib/db')

describe('db.js utilities', () => {
  describe('constants', () => {
    test('APP_CONFIG_ID is app_config', () => {
      expect(APP_CONFIG_ID).toBe('app_config')
    })

    test('APP_CONFIG_COLLECTION is app_config', () => {
      expect(APP_CONFIG_COLLECTION).toBe('app_config')
    })

    test('APP_CONFIG_DEFAULTS has all 20 fields', () => {
      const keys = Object.keys(APP_CONFIG_DEFAULTS)
      expect(keys).toContain('is_enabled')
      expect(keys).toContain('otp_expiration_validity')
      expect(keys).toContain('otp_in_response')
      expect(keys).toContain('auto_register')
      expect(keys).toContain('allow_key_info_update')
      expect(keys).toContain('sms_api_host')
      expect(keys).toContain('sms_endpoint')
      expect(keys).toContain('sms_api_key')
      expect(keys).toContain('sms_template_enabled')
      expect(keys).toContain('sms_template_id')
      expect(keys).toContain('sms_template_string')
      expect(keys).toContain('email_smtp_host')
      expect(keys).toContain('email_smtp_port')
      expect(keys).toContain('email_smtp_user')
      expect(keys).toContain('email_smtp_password')
      expect(keys).toContain('email_from_address')
      expect(keys).toContain('email_from_name')
      expect(keys).toContain('email_template_enabled')
      expect(keys).toContain('email_template_id')
      expect(keys).toContain('email_template_string')
    })
  })

  describe('isDocumentNotFoundError', () => {
    test('detects "Document not found"', () => {
      expect(isDocumentNotFoundError(new Error('Document not found'))).toBe(true)
    })

    test('detects "not found" substring', () => {
      expect(isDocumentNotFoundError(new Error('key not found in store'))).toBe(true)
    })

    test('returns false for other errors', () => {
      expect(isDocumentNotFoundError(new Error('connection refused'))).toBe(false)
    })

    test('handles null error', () => {
      expect(isDocumentNotFoundError(null)).toBe(false)
    })
  })

  describe('isCollectionNotFoundError', () => {
    test('detects MySQL ER_NO_SUCH_TABLE', () => {
      const err = new Error('Table not found')
      err.code = 'ER_NO_SUCH_TABLE'
      expect(isCollectionNotFoundError(err)).toBe(true)
    })

    test('detects errno 1146', () => {
      const err = new Error('Table missing')
      err.errno = 1146
      expect(isCollectionNotFoundError(err)).toBe(true)
    })

    test('detects "collection not found" message', () => {
      expect(isCollectionNotFoundError(new Error('collection not found'))).toBe(true)
    })

    test('detects "does not exist" message', () => {
      expect(isCollectionNotFoundError(new Error('table does not exist'))).toBe(true)
    })

    test('returns false for other errors', () => {
      expect(isCollectionNotFoundError(new Error('timeout'))).toBe(false)
    })
  })

  describe('isUniqueConstraintError', () => {
    test('detects MongoDB code 11000', () => {
      const err = new Error('duplicate key')
      err.code = 11000
      expect(isUniqueConstraintError(err)).toBe(true)
    })

    test('detects MySQL ER_DUP_ENTRY', () => {
      const err = new Error('Duplicate entry')
      err.code = 'ER_DUP_ENTRY'
      expect(isUniqueConstraintError(err)).toBe(true)
    })

    test('detects errno 1062', () => {
      const err = new Error('dup')
      err.errno = 1062
      expect(isUniqueConstraintError(err)).toBe(true)
    })

    test('detects "duplicate key" message', () => {
      expect(isUniqueConstraintError(new Error('duplicate key error'))).toBe(true)
    })

    test('detects "already exists" message', () => {
      expect(isUniqueConstraintError(new Error('record already exists'))).toBe(true)
    })

    test('returns false for other errors', () => {
      expect(isUniqueConstraintError(new Error('connection lost'))).toBe(false)
    })
  })

  describe('isUnauthorizedDbError', () => {
    test('detects status 401', () => {
      expect(isUnauthorizedDbError({ status: 401 })).toBe(true)
    })

    test('detects status 403', () => {
      expect(isUnauthorizedDbError({ status: 403 })).toBe(true)
    })

    test('detects response.status 401', () => {
      expect(isUnauthorizedDbError({ response: { status: 401 } })).toBe(true)
    })

    test('returns false for 500', () => {
      expect(isUnauthorizedDbError({ status: 500 })).toBe(false)
    })
  })

  describe('normalizeAppConfig', () => {
    test('returns defaults for null config', () => {
      const result = normalizeAppConfig(null)
      expect(result.is_enabled).toBe(false)
      expect(result.otp_expiration_validity).toBe(10)
      expect(result.otp_in_response).toBe(false)
      expect(result.auto_register).toBe(false)
      expect(result.allow_key_info_update).toBe(false)
      expect(result.sms_template_enabled).toBe(false)
      expect(result.email_template_enabled).toBe(false)
      expect(result.email_smtp_port).toBe(587)
    })

    test('preserves actual values', () => {
      const result = normalizeAppConfig({
        is_enabled: true,
        otp_expiration_validity: 5,
        otp_in_response: true,
        auto_register: true,
        sms_api_host: 'https://sms.example.com',
        email_smtp_host: 'smtp.example.com'
      })
      expect(result.is_enabled).toBe(true)
      expect(result.otp_expiration_validity).toBe(5)
      expect(result.otp_in_response).toBe(true)
      expect(result.auto_register).toBe(true)
      expect(result.sms_api_host).toBe('https://sms.example.com')
      expect(result.email_smtp_host).toBe('smtp.example.com')
    })

    test('includes auto_login backward compat alias', () => {
      const result = normalizeAppConfig({ auto_register: true })
      expect(result.auto_login).toBe(true)
    })

    test('handles non-boolean values for boolean fields', () => {
      const result = normalizeAppConfig({
        is_enabled: 'yes',
        sms_template_enabled: 1
      })
      // Non-boolean types should fall back to defaults
      expect(result.sms_template_enabled).toBe(false)
    })

    test('handles non-integer otp_expiration_validity', () => {
      const result = normalizeAppConfig({ otp_expiration_validity: 'ten' })
      expect(result.otp_expiration_validity).toBe(10) // default
    })

    test('returns all 20+ fields', () => {
      const result = normalizeAppConfig({})
      const keys = Object.keys(result)
      expect(keys.length).toBeGreaterThanOrEqual(20)
      // Verify key SMS/Email fields present
      expect(keys).toContain('sms_api_host')
      expect(keys).toContain('sms_template_string')
      expect(keys).toContain('email_smtp_host')
      expect(keys).toContain('email_template_string')
    })
  })

  describe('assertModuleEnabled', () => {
    test('does not throw when module is enabled', async () => {
      const dbClient = {
        collection: jest.fn().mockResolvedValue({
          findOne: jest.fn().mockResolvedValue({ _id: 'app_config', is_enabled: true })
        })
      }

      await expect(assertModuleEnabled(dbClient)).resolves.toBeDefined()
    })

    test('throws 403 when module is disabled', async () => {
      const dbClient = {
        collection: jest.fn().mockResolvedValue({
          findOne: jest.fn().mockResolvedValue({ _id: 'app_config', is_enabled: false })
        })
      }

      await expect(assertModuleEnabled(dbClient)).rejects.toMatchObject({
        statusCode: 403,
        message: 'otp module is disabled'
      })
    })
  })
})
