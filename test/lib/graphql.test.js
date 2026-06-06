/**
 * Unit tests for lib/graphql.js
 */

jest.mock('node-fetch')
const fetch = require('node-fetch')

const { graphQLRequest, commerceGraphQLRequest } = require('../../lib/graphql')

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('graphQLRequest', () => {
  test('throws when GRAPHQL_ENDPOINT not configured', async () => {
    await expect(
      graphQLRequest({}, 'query { test }', {}, mockLogger)
    ).rejects.toThrow('GRAPHQL_ENDPOINT not configured')
  })

  test('sends POST with correct headers', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ data: { test: true } }))
    })

    await graphQLRequest(
      { GRAPHQL_ENDPOINT: 'https://graphql.example.com' },
      'query { test }',
      { var1: 'val1' },
      mockLogger
    )

    expect(fetch).toHaveBeenCalledWith(
      'https://graphql.example.com',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: 'query { test }', variables: { var1: 'val1' } })
      })
    )
  })

  test('includes auth token when provided', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ data: {} }))
    })

    await graphQLRequest(
      { GRAPHQL_ENDPOINT: 'https://graphql.example.com' },
      'query { test }',
      {},
      mockLogger,
      'bearer-token-123'
    )

    const callHeaders = fetch.mock.calls[0][1].headers
    expect(callHeaders.authorization).toBe('Bearer bearer-token-123')
  })

  test('throws on empty response body', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('')
    })

    await expect(
      graphQLRequest(
        { GRAPHQL_ENDPOINT: 'https://graphql.example.com' },
        'query { test }', {}, mockLogger
      )
    ).rejects.toThrow('empty body')
  })

  test('throws on non-JSON response', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('<html>error</html>')
    })

    await expect(
      graphQLRequest(
        { GRAPHQL_ENDPOINT: 'https://graphql.example.com' },
        'query { test }', {}, mockLogger
      )
    ).rejects.toThrow('non-JSON')
  })

  test('throws on GraphQL errors', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        errors: [{ message: 'Field not found' }]
      }))
    })

    await expect(
      graphQLRequest(
        { GRAPHQL_ENDPOINT: 'https://graphql.example.com' },
        'query { test }', {}, mockLogger
      )
    ).rejects.toThrow('Field not found')
  })

  test('throws on non-OK HTTP status', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        errors: [{ message: 'Internal error' }]
      }))
    })

    await expect(
      graphQLRequest(
        { GRAPHQL_ENDPOINT: 'https://graphql.example.com' },
        'query { test }', {}, mockLogger
      )
    ).rejects.toThrow('Internal error')
  })
})

describe('commerceGraphQLRequest', () => {
  test('throws when GRAPHQL_ENDPOINT not configured', async () => {
    await expect(
      commerceGraphQLRequest({}, 'query { test }', {}, mockLogger)
    ).rejects.toThrow('GRAPHQL_ENDPOINT not configured')
  })

  test('rejects admin.commerce.adobe.com endpoint', async () => {
    await expect(
      commerceGraphQLRequest(
        { GRAPHQL_ENDPOINT: 'https://admin.commerce.adobe.com/graphql' },
        'query { test }', {}, mockLogger
      )
    ).rejects.toThrow('admin.commerce.adobe.com is not a storefront')
  })

  test('succeeds with valid storefront endpoint', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ data: { result: true } }))
    })

    const result = await commerceGraphQLRequest(
      { GRAPHQL_ENDPOINT: 'https://store.example.com/graphql' },
      'query { test }', {}, mockLogger
    )
    expect(result.data.result).toBe(true)
  })
})
