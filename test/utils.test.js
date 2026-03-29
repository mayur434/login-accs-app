/**
 * Unit tests for actions/utils.js
 */

const {
  errorResponse,
  getBearerToken,
  normalizeMobile,
  stringParameters,
  checkMissingRequestInputs
} = require('../actions/utils')

describe('utils', () => {
  describe('errorResponse', () => {
    test('returns error wrapper with statusCode and body', () => {
      const result = errorResponse(400, 'bad input')
      expect(result.error).toBeDefined()
      expect(result.error.statusCode).toBe(400)
      expect(result.error.body.error).toBe('bad input')
    })

    test('logs via logger.info when provided', () => {
      const logger = { info: jest.fn() }
      errorResponse(500, 'fail', logger)
      expect(logger.info).toHaveBeenCalledWith('500: fail')
    })
  })

  describe('stringParameters', () => {
    test('serializes params with hidden auth', () => {
      const result = stringParameters({
        key: 'value',
        __ow_headers: { authorization: 'Bearer secret123' }
      })
      const parsed = JSON.parse(result)
      expect(parsed.key).toBe('value')
      expect(parsed.__ow_headers.authorization).toBe('<hidden>')
    })

    test('handles missing __ow_headers', () => {
      const result = stringParameters({ key: 'value' })
      expect(result).toContain('key')
    })
  })

  describe('checkMissingRequestInputs', () => {
    test('returns null when all params present', () => {
      expect(checkMissingRequestInputs({ a: 'x', b: 'y' }, ['a', 'b'])).toBeNull()
    })

    test('returns error for missing params', () => {
      const result = checkMissingRequestInputs({ a: 'x' }, ['a', 'b'])
      expect(result).toContain("missing parameter(s) 'b'")
    })

    test('returns error for missing headers', () => {
      const result = checkMissingRequestInputs(
        { __ow_headers: {} },
        [],
        ['x-api-key']
      )
      expect(result).toContain("missing header(s) 'x-api-key'")
    })

    test('combines missing params and headers', () => {
      const result = checkMissingRequestInputs(
        { __ow_headers: {} },
        ['param1'],
        ['header1']
      )
      expect(result).toContain('header')
      expect(result).toContain('param')
    })

    test('returns null for no required params/headers', () => {
      expect(checkMissingRequestInputs({}, [], [])).toBeNull()
    })

    test('treats empty string as missing', () => {
      expect(checkMissingRequestInputs({ a: '' }, ['a'])).toContain("missing parameter(s) 'a'")
    })

    test('treats undefined as missing', () => {
      expect(checkMissingRequestInputs({}, ['x'])).toContain("missing parameter(s) 'x'")
    })

    test('handles nested key path', () => {
      const result = checkMissingRequestInputs({ a: { b: 'val' } }, ['a.b'])
      expect(result).toBeNull()
    })

    test('detects missing nested key', () => {
      const result = checkMissingRequestInputs({ a: {} }, ['a.b'])
      expect(result).toContain("missing parameter(s) 'a.b'")
    })

    test('handles multiple missing params', () => {
      const result = checkMissingRequestInputs({}, ['a', 'b', 'c'])
      expect(result).toContain('a')
      expect(result).toContain('b')
      expect(result).toContain('c')
    })
  })

  describe('getBearerToken', () => {
    test('extracts Bearer token from authorization header', () => {
      expect(getBearerToken({
        __ow_headers: { authorization: 'Bearer abc123' }
      })).toBe('abc123')
    })

    test('returns undefined for non-Bearer auth', () => {
      expect(getBearerToken({
        __ow_headers: { authorization: 'Basic abc123' }
      })).toBeUndefined()
    })

    test('returns undefined when no authorization header', () => {
      expect(getBearerToken({ __ow_headers: {} })).toBeUndefined()
    })

    test('returns undefined when no __ow_headers', () => {
      expect(getBearerToken({})).toBeUndefined()
    })

    test('handles token with spaces', () => {
      expect(getBearerToken({
        __ow_headers: { authorization: 'Bearer token with spaces' }
      })).toBe('token with spaces')
    })
  })

  describe('normalizeMobile', () => {
    test('normalizes 10-digit Indian mobile', () => {
      expect(normalizeMobile('9876543210')).toBe('+919876543210')
    })

    test('normalizes 12-digit with 91 prefix', () => {
      expect(normalizeMobile('919876543210')).toBe('+919876543210')
    })

    test('normalizes with +91 prefix', () => {
      expect(normalizeMobile('+919876543210')).toBe('+919876543210')
    })

    test('strips non-digit characters', () => {
      expect(normalizeMobile('+91 9876-543210')).toBe('+919876543210')
    })

    test('throws for non-Indian number start digit', () => {
      expect(() => normalizeMobile('1234567890')).toThrow('invalid indian mobile number')
    })

    test('throws for too few digits', () => {
      expect(() => normalizeMobile('98765')).toThrow('invalid indian mobile number')
    })
  })
})
