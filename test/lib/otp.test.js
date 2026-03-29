/**
 * Unit tests for actions/lib/otp.js
 */

const { generateOtpValue, createReferenceId, levenshtein } = require('../../actions/lib/otp')

describe('otp helpers', () => {
  describe('generateOtpValue', () => {
    test('returns a 4-digit string', () => {
      const otp = generateOtpValue()
      expect(otp).toMatch(/^\d{4}$/)
    })

    test('returns value between 1000 and 9999', () => {
      for (let i = 0; i < 100; i++) {
        const num = parseInt(generateOtpValue(), 10)
        expect(num).toBeGreaterThanOrEqual(1000)
        expect(num).toBeLessThanOrEqual(9999)
      }
    })

    test('generates different values (randomness check)', () => {
      const values = new Set()
      for (let i = 0; i < 50; i++) {
        values.add(generateOtpValue())
      }
      // With 50 random 4-digit numbers, we expect at least 10 unique values
      expect(values.size).toBeGreaterThan(10)
    })
  })

  describe('createReferenceId', () => {
    test('returns string starting with otp_', () => {
      const ref = createReferenceId()
      expect(ref).toMatch(/^otp_\d+_\d+$/)
    })

    test('generates unique reference IDs', () => {
      const refs = new Set()
      for (let i = 0; i < 20; i++) {
        refs.add(createReferenceId())
      }
      expect(refs.size).toBe(20)
    })
  })

  describe('levenshtein', () => {
    test('returns 0 for identical strings', () => {
      expect(levenshtein('1234', '1234')).toBe(0)
    })

    test('returns 1 for single character difference', () => {
      expect(levenshtein('1234', '1235')).toBe(1)
    })

    test('returns 1 for single insertion', () => {
      expect(levenshtein('123', '1234')).toBe(1)
    })

    test('returns 1 for single deletion', () => {
      expect(levenshtein('1234', '123')).toBe(1)
    })

    test('returns full length for completely different strings', () => {
      expect(levenshtein('1234', '5678')).toBe(4)
    })

    test('handles empty strings', () => {
      expect(levenshtein('', '1234')).toBe(4)
      expect(levenshtein('1234', '')).toBe(4)
      expect(levenshtein('', '')).toBe(0)
    })

    test('handles null/undefined', () => {
      expect(levenshtein(null, '1234')).toBe(4)
      expect(levenshtein('1234', null)).toBe(4)
      expect(levenshtein(null, null)).toBe(0)
    })

    test('distance > 1 for two character differences', () => {
      expect(levenshtein('1234', '1256')).toBe(2)
    })
  })
})
