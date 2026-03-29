/**
 * Unit tests for actions/lib/commerce.js
 */

jest.mock('node-fetch')
const fetch = require('node-fetch')

const { generateCustomerToken, fetchCustomerProfile } = require('../../actions/lib/commerce')

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}

const baseParams = {
  GRAPHQL_ENDPOINT: 'https://store.example.com/graphql'
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('commerce helpers', () => {
  describe('generateCustomerToken', () => {
    test('returns token on successful response', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'jwt-token-123' } }
        }))
      })

      const token = await generateCustomerToken(baseParams, 'test@x.com', 'pass', mockLogger)
      expect(token).toBe('jwt-token-123')
    })

    test('throws when token not in response', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: null } }
        }))
      })

      await expect(
        generateCustomerToken(baseParams, 'test@x.com', 'pass', mockLogger)
      ).rejects.toThrow('failed to generate customer token')
    })
  })

  describe('fetchCustomerProfile', () => {
    test('returns customer object on success', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { customer: { id: 42, firstname: 'John', email: 'test@x.com' } }
        }))
      })

      const profile = await fetchCustomerProfile(baseParams, 'cust-token', mockLogger)
      expect(profile.id).toBe(42)
      expect(profile.firstname).toBe('John')
    })

    test('returns null when customer missing in response', async () => {
      fetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ data: {} }))
      })

      const profile = await fetchCustomerProfile(baseParams, 'cust-token', mockLogger)
      expect(profile).toBeNull()
    })
  })
})
