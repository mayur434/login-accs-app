/**
 * Unit tests for actions/lib/customer.js
 */

const {
  parseCustomerIdValue,
  getCustomerId,
  parseCustomerIdFromToken,
  extractCustomerId,
  extractCustomerToken,
  extractBearerToken,
  getSyntheticEmail,
  getCommerceMobileValue,
  buildLoginType,
  normalizeEmailInput,
  normalizeMobile,
  INTERNAL_CUSTOMER_PASSWORD,
  CUSTOMER_IDENTITY_COLLECTION
} = require('../../actions/lib/customer')

describe('customer helpers', () => {
  describe('constants', () => {
    test('INTERNAL_CUSTOMER_PASSWORD is defined', () => {
      expect(INTERNAL_CUSTOMER_PASSWORD).toBe('pass@123')
    })

    test('CUSTOMER_IDENTITY_COLLECTION is defined', () => {
      expect(CUSTOMER_IDENTITY_COLLECTION).toBe('customer_mobile_identity')
    })
  })

  describe('parseCustomerIdValue', () => {
    test('parses integer', () => {
      expect(parseCustomerIdValue(42)).toBe(42)
    })

    test('parses numeric string', () => {
      expect(parseCustomerIdValue('42')).toBe(42)
    })

    test('parses base64 encoded id', () => {
      const encoded = Buffer.from('42').toString('base64')
      expect(parseCustomerIdValue(encoded)).toBe(42)
    })

    test('returns null for null', () => {
      expect(parseCustomerIdValue(null)).toBeNull()
    })

    test('returns null for undefined', () => {
      expect(parseCustomerIdValue(undefined)).toBeNull()
    })

    test('returns null for empty string', () => {
      expect(parseCustomerIdValue('')).toBeNull()
    })

    test('returns null for zero', () => {
      expect(parseCustomerIdValue(0)).toBeNull()
    })

    test('returns null for negative number', () => {
      expect(parseCustomerIdValue(-1)).toBeNull()
    })

    test('returns null for non-numeric string', () => {
      expect(parseCustomerIdValue('abc')).toBeNull()
    })
  })

  describe('getCustomerId', () => {
    test('extracts id from createCustomerV2 response', () => {
      const response = { data: { createCustomerV2: { customer: { id: 42 } } } }
      expect(getCustomerId(response)).toBe(42)
    })

    test('extracts id from createCustomerWrapper response', () => {
      const response = { data: { createCustomerWrapper: { customer: { id: 99 } } } }
      expect(getCustomerId(response)).toBe(99)
    })

    test('returns null for missing customer', () => {
      expect(getCustomerId({ data: {} })).toBeNull()
    })

    test('returns null for null response', () => {
      expect(getCustomerId(null)).toBeNull()
    })
  })

  describe('parseCustomerIdFromToken', () => {
    test('returns null for non-string', () => {
      expect(parseCustomerIdFromToken(null)).toBeNull()
      expect(parseCustomerIdFromToken(123)).toBeNull()
    })

    test('returns null for string without dots', () => {
      expect(parseCustomerIdFromToken('noperiods')).toBeNull()
    })

    test('extracts customer_id from JWT payload', () => {
      const payload = Buffer.from(JSON.stringify({ customer_id: 42 })).toString('base64')
      const token = `header.${payload}.signature`
      expect(parseCustomerIdFromToken(token)).toBe(42)
    })

    test('extracts uid from JWT payload', () => {
      const payload = Buffer.from(JSON.stringify({ uid: 99 })).toString('base64')
      const token = `header.${payload}.signature`
      expect(parseCustomerIdFromToken(token)).toBe(99)
    })

    test('returns null for invalid JWT', () => {
      expect(parseCustomerIdFromToken('a.!!!.c')).toBeNull()
    })
  })

  describe('extractCustomerId', () => {
    test('extracts from customer_id param', () => {
      expect(extractCustomerId({ customer_id: 42 })).toBe(42)
    })

    test('extracts from customerId param', () => {
      expect(extractCustomerId({ customerId: 42 })).toBe(42)
    })

    test('extracts from context.customer_id', () => {
      expect(extractCustomerId({ context: { customer_id: 42 } })).toBe(42)
    })

    test('falls back to customer_token JWT extraction', () => {
      const payload = Buffer.from(JSON.stringify({ customer_id: 55 })).toString('base64')
      const token = `h.${payload}.s`
      expect(extractCustomerId({ customer_token: token })).toBe(55)
    })

    test('returns null when no customer_id available', () => {
      expect(extractCustomerId({})).toBeNull()
    })
  })

  describe('extractCustomerToken', () => {
    test('extracts customer_token from params', () => {
      expect(extractCustomerToken({ customer_token: 'abc123' })).toBe('abc123')
    })

    test('extracts from customerToken', () => {
      expect(extractCustomerToken({ customerToken: 'def456' })).toBe('def456')
    })

    test('extracts from Authorization header', () => {
      expect(extractCustomerToken({
        __ow_headers: { authorization: 'Bearer mytoken' }
      })).toBe('mytoken')
    })

    test('returns null when not present', () => {
      expect(extractCustomerToken({})).toBeNull()
    })
  })

  describe('extractBearerToken', () => {
    test('extracts from authorization header', () => {
      expect(extractBearerToken({ __ow_headers: { authorization: 'Bearer abc' } })).toBe('abc')
    })

    test('returns null for empty params', () => {
      expect(extractBearerToken({})).toBeNull()
    })

    test('handles non-Bearer auth', () => {
      expect(extractBearerToken({ __ow_headers: { authorization: 'Basic abc' } })).toBe('Basic abc')
    })
  })

  describe('getSyntheticEmail', () => {
    test('generates pattern email from normalized mobile', () => {
      expect(getSyntheticEmail('+919876543210')).toBe('919876543210@email.com')
    })

    test('strips non-digit chars', () => {
      expect(getSyntheticEmail('+91-9876-543210')).toBe('919876543210@email.com')
    })
  })

  describe('getCommerceMobileValue', () => {
    test('returns last 10 digits', () => {
      expect(getCommerceMobileValue('+919876543210')).toBe('9876543210')
    })

    test('returns digits as-is when 10 or fewer', () => {
      expect(getCommerceMobileValue('9876543210')).toBe('9876543210')
    })

    test('returns null for null/undefined', () => {
      expect(getCommerceMobileValue(null)).toBeNull()
      expect(getCommerceMobileValue(undefined)).toBeNull()
    })

    test('returns null for empty string', () => {
      expect(getCommerceMobileValue('')).toBeNull()
    })
  })

  describe('buildLoginType', () => {
    test('returns both when email and mobile', () => {
      expect(buildLoginType(true, true)).toBe('both')
    })

    test('returns email when only email', () => {
      expect(buildLoginType(true, false)).toBe('email')
    })

    test('returns mobile when only mobile', () => {
      expect(buildLoginType(false, true)).toBe('mobile')
    })

    test('returns null when neither', () => {
      expect(buildLoginType(false, false)).toBeNull()
    })
  })

  describe('normalizeEmailInput', () => {
    test('lowercases and trims email', () => {
      expect(normalizeEmailInput('  Test@Example.COM  ')).toBe('test@example.com')
    })

    test('throws for empty email', () => {
      expect(() => normalizeEmailInput('')).toThrow('invalid email')
    })

    test('throws for null', () => {
      expect(() => normalizeEmailInput(null)).toThrow('invalid email')
    })
  })

  describe('normalizeMobile', () => {
    test('normalizes 10-digit Indian mobile', () => {
      expect(normalizeMobile('9876543210')).toBe('+919876543210')
    })

    test('normalizes 12-digit with country code', () => {
      expect(normalizeMobile('919876543210')).toBe('+919876543210')
    })

    test('normalizes with + prefix', () => {
      expect(normalizeMobile('+919876543210')).toBe('+919876543210')
    })

    test('strips non-digit characters', () => {
      expect(normalizeMobile('+91 9876-543210')).toBe('+919876543210')
    })

    test('throws for invalid mobile (wrong start digit)', () => {
      expect(() => normalizeMobile('1234567890')).toThrow('invalid indian mobile number')
    })

    test('throws for too few digits', () => {
      expect(() => normalizeMobile('98765')).toThrow('invalid indian mobile number')
    })
  })
})
