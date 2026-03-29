/**
 * Unit tests for actions/lib/template.js
 */

const { resolveTemplate } = require('../../actions/lib/template')

describe('template resolver', () => {
  test('replaces single placeholder', () => {
    expect(resolveTemplate('Your OTP is {{OTP}}', { OTP: '1234' })).toBe('Your OTP is 1234')
  })

  test('replaces multiple placeholders', () => {
    const result = resolveTemplate(
      'OTP: {{OTP}}, valid for {{VALIDITY}} minutes',
      { OTP: '5678', VALIDITY: 10 }
    )
    expect(result).toBe('OTP: 5678, valid for 10 minutes')
  })

  test('replaces repeated placeholders', () => {
    expect(resolveTemplate('{{OTP}} and {{OTP}}', { OTP: '1234' })).toBe('1234 and 1234')
  })

  test('handles missing placeholders gracefully (leaves as-is)', () => {
    expect(resolveTemplate('Value: {{MISSING}}', {})).toBe('Value: {{MISSING}}')
  })

  test('handles empty template', () => {
    expect(resolveTemplate('', { OTP: '1234' })).toBe('')
  })

  test('handles null template', () => {
    expect(resolveTemplate(null, { OTP: '1234' })).toBe('')
  })

  test('handles undefined template', () => {
    expect(resolveTemplate(undefined, { OTP: '1234' })).toBe('')
  })

  test('converts non-string values to string', () => {
    expect(resolveTemplate('Port: {{PORT}}', { PORT: 587 })).toBe('Port: 587')
  })

  test('handles all OTP template placeholders', () => {
    const result = resolveTemplate(
      'OTP={{OTP}} VALIDITY={{VALIDITY}} MOBILE={{MOBILE}} EMAIL={{EMAIL}}',
      { OTP: '9999', VALIDITY: 5, MOBILE: '+919876543210', EMAIL: 'test@x.com' }
    )
    expect(result).toBe('OTP=9999 VALIDITY=5 MOBILE=+919876543210 EMAIL=test@x.com')
  })
})
