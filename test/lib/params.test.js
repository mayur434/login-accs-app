/**
 * Unit tests for lib/params.js
 */

const { hasValue, getRequestParams, normalizeRequestParams } = require('../../lib/params')

describe('params helpers', () => {
  describe('hasValue', () => {
    test('returns true for non-empty string', () => {
      expect(hasValue('hello')).toBe(true)
    })

    test('returns true for number', () => {
      expect(hasValue(42)).toBe(true)
      expect(hasValue(0)).toBe(true)
    })

    test('returns true for boolean', () => {
      expect(hasValue(true)).toBe(true)
      expect(hasValue(false)).toBe(true)
    })

    test('returns false for undefined', () => {
      expect(hasValue(undefined)).toBe(false)
    })

    test('returns false for null', () => {
      expect(hasValue(null)).toBe(false)
    })

    test('returns false for empty string', () => {
      expect(hasValue('')).toBe(false)
    })

    test('returns false for whitespace-only string', () => {
      expect(hasValue('   ')).toBe(false)
    })
  })

  describe('getRequestParams', () => {
    test('merges params.params into top level', () => {
      const result = getRequestParams({ foo: 'bar', params: { baz: 'qux' } })
      expect(result.foo).toBe('bar')
      expect(result.baz).toBe('qux')
    })

    test('parses JSON __ow_body', () => {
      const body = JSON.stringify({ operation: 'login', email: 'test@x.com' })
      const result = getRequestParams({ __ow_body: body })
      expect(result.operation).toBe('login')
      expect(result.email).toBe('test@x.com')
      expect(result.loginType).toBe('email')
    })

    test('parses JSON body', () => {
      const result = getRequestParams({ body: '{"key":"val"}' })
      expect(result.key).toBe('val')
    })

    test('handles object body', () => {
      const result = getRequestParams({ body: { key: 'val' } })
      expect(result.key).toBe('val')
    })

    test('returns params as-is when no nested structures', () => {
      const result = getRequestParams({ foo: 'bar' })
      expect(result.foo).toBe('bar')
    })

    test('falls back to params on invalid __ow_body JSON', () => {
      const result = getRequestParams({ __ow_body: 'not json', foo: 'bar' })
      expect(result.foo).toBe('bar')
    })
  })

  describe('normalizeRequestParams', () => {
    test('copies mobile to mobile_number when missing', () => {
      const result = normalizeRequestParams({ mobile: '+919876543210' })
      expect(result.mobile_number).toBe('+919876543210')
    })

    test('copies mobile_number to mobile when missing', () => {
      const result = normalizeRequestParams({ mobile_number: '+919876543210' })
      expect(result.mobile).toBe('+919876543210')
    })

    test('copies firstName/firstname aliases', () => {
      const result = normalizeRequestParams({ firstName: 'John' })
      expect(result.firstname).toBe('John')
    })

    test('copies lastname/lastName aliases', () => {
      const result = normalizeRequestParams({ lastname: 'Doe' })
      expect(result.lastName).toBe('Doe')
    })

    test('infers loginType as mobile when only mobile present', () => {
      const result = normalizeRequestParams({ mobile: '9876543210' })
      expect(result.loginType).toBe('mobile')
    })

    test('infers loginType as email when only email present', () => {
      const result = normalizeRequestParams({ email: 'test@x.com' })
      expect(result.loginType).toBe('email')
    })

    test('infers loginType as both when both mobile and email are present', () => {
      const result = normalizeRequestParams({ email: 'test@x.com', mobile: '9876543210' })
      expect(result.loginType).toBe('both')
    })

    test('does not overwrite explicit loginType', () => {
      const result = normalizeRequestParams({ loginType: 'email', mobile: '9876543210' })
      expect(result.loginType).toBe('email')
    })
  })
})
