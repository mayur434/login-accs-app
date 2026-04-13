/**
 * Unit tests for customer service handlers:
 *   - actions/customer/services/register.js
 *   - actions/customer/services/update.js
 */

jest.mock('node-fetch', () => jest.fn())
const fetch = require('node-fetch')

// ── Shared mocks ────────────────────────────────────────────────────────

const mockCollection = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn()
}

const mockDbClient = {
  collection: jest.fn().mockResolvedValue(mockCollection),
  close: jest.fn()
}

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}

// ── Helper: make findOne throw "Document not found" to simulate not-found ─

function setupFindOneNotFound () {
  mockCollection.findOne.mockImplementation(() => {
    const e = new Error('Document not found')
    e.code = 'DOCUMENT_NOT_FOUND'
    throw e
  })
}

function setupFindOneReturns (doc) {
  mockCollection.findOne.mockResolvedValue(doc)
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default fetch mock: successful Commerce response
  fetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: jest.fn().mockResolvedValue(JSON.stringify({
      data: {
        createCustomerWrapper: { customer: { id: 42, firstname: 'John', lastname: 'Doe', email: 'test@x.com' } },
        generateCustomerToken: { token: 'mock-jwt-token' }
      }
    }))
  })
})

// ════════════════════════════════════════════════════════════════════════
// Register
// ════════════════════════════════════════════════════════════════════════

describe('register service', () => {
  const register = require('../actions/customer/services/register')

  test('returns 400 when password missing', async () => {
    const result = await register(mockDbClient, { email: 'a@b.com' }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('password')
  })

  test('returns 400 when no email and no mobile', async () => {
    const result = await register(mockDbClient, { password: 'pass@123' }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('email,mobile_number')
  })

  test('returns 409 when mobile already exists', async () => {
    // First findOne (mobile check) returns a doc; second (email check) not called
    setupFindOneReturns({ mobile_number: '+919876543210', status: 'active', customer_id: 1 })

    const result = await register(mockDbClient, {
      password: 'pass@123',
      mobile_number: '9876543210'
    }, mockLogger)
    expect(result.statusCode).toBe(409)
    expect(result.body.error).toContain('mobile_number already exists')
  })

  test('returns 400 for invalid mobile number', async () => {
    setupFindOneNotFound()

    const result = await register(mockDbClient, {
      password: 'pass@123',
      mobile_number: '123'
    }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('invalid')
  })

  test('successfully registers with email', async () => {
    setupFindOneNotFound() // No existing identity

    const result = await register(mockDbClient, {
      password: 'pass@123',
      email: 'newuser@example.com',
      firstname: 'John',
      lastname: 'Doe',
      GRAPHQL_ENDPOINT: 'https://commerce.example.com/graphql'
    }, mockLogger)

    expect(result.statusCode).toBe(200)
    expect(result.body.success).toBe(true)
    expect(result.body.customer).toBeDefined()
    // Email from commerce mock response
    expect(result.body.customer.email).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════════════════════
// Update
// ════════════════════════════════════════════════════════════════════════

describe('update service', () => {
  const update = require('../actions/customer/services/update')

  // Mock getAppConfig for update service
  jest.mock('../actions/lib/db', () => {
    const actualDb = jest.requireActual('../actions/lib/db')
    return {
      ...actualDb,
      getAppConfig: jest.fn().mockResolvedValue({ allow_key_info_update: true }),
      findOneOrNull: jest.fn()
    }
  })

  const { findOneOrNull, getAppConfig } = require('../actions/lib/db')

  beforeEach(() => {
    getAppConfig.mockResolvedValue({ allow_key_info_update: true })
  })

  test('returns 400 when customer_id missing', async () => {
    const result = await update(mockDbClient, {
      customer_token: 'abc',
      mobile_number: '9876543210'
    }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('customer_id')
  })

  test('returns 400 when customer_token missing', async () => {
    const result = await update(mockDbClient, {
      customer_id: 42,
      mobile_number: '9876543210'
    }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('customer_token')
  })

  test('returns 400 when no update fields provided', async () => {
    const result = await update(mockDbClient, {
      customer_id: 42,
      customer_token: 'abc'
    }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('at least one field')
  })

  test('returns 403 when key info updates disabled', async () => {
    getAppConfig.mockResolvedValue({ allow_key_info_update: false })

    const result = await update(mockDbClient, {
      customer_id: 42,
      customer_token: 'abc',
      mobile_number: '9876543210'
    }, mockLogger)
    expect(result.statusCode).toBe(403)
    expect(result.body.error).toContain('key info updates are disabled')
  })

  test('returns 404 when customer identity not found', async () => {
    findOneOrNull.mockResolvedValue(null)

    const result = await update(mockDbClient, {
      customer_id: 42,
      customer_token: 'abc',
      mobile_number: '9876543210'
    }, mockLogger)
    expect(result.statusCode).toBe(404)
    expect(result.body.error).toContain('customer identity not found')
  })

  test('returns 400 for invalid mobile number', async () => {
    const result = await update(mockDbClient, {
      customer_id: 42,
      customer_token: 'abc',
      mobile_number: '123'
    }, mockLogger)
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('invalid')
  })

  test('updates firstname and lastname', async () => {
    findOneOrNull.mockResolvedValue({
      customer_id: 42,
      email: 'existing@example.com',
      mobile_number: '+919876543210',
      firstname: 'Old',
      lastname: 'Name',
      status: 'active'
    })
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 })

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        data: {
          updateCustomerV2: {
            customer: {
              id: 42,
              firstname: 'John',
              lastname: 'Doe',
              email: 'existing@example.com'
            }
          }
        }
      }))
    })

    const result = await update(mockDbClient, {
      customer_id: 42,
      customer_token: 'abc',
      firstname: 'John',
      lastname: 'Doe',
      GRAPHQL_ENDPOINT: 'https://commerce.example.com/graphql'
    }, mockLogger)

    expect(result.statusCode).toBe(200)
    expect(result.body.customer.firstname).toBe('John')
    expect(result.body.customer.lastname).toBe('Doe')
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { customer_id: 42 },
      { $set: expect.objectContaining({ firstname: 'John', lastname: 'Doe' }) }
    )

    const requestBody = JSON.parse(fetch.mock.calls[0][1].body)
    expect(requestBody.query).toContain('updateCustomerV2')
    expect(requestBody.variables.input.firstname).toBe('John')
    expect(requestBody.variables.input.lastname).toBe('Doe')
  })

  test('rejects firstName/lastName alias-only payload', async () => {
    findOneOrNull.mockResolvedValue({
      customer_id: 42,
      email: 'existing@example.com',
      mobile_number: '+919876543210',
      firstname: 'Old',
      lastname: 'Name',
      status: 'active'
    })
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 })

    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        data: { updateCustomerV2: { customer: { id: 42, firstname: 'Jane', lastname: 'Smith', email: 'existing@example.com' } } }
      }))
    })

    const result = await update(mockDbClient, {
      customer_id: 42,
      customer_token: 'abc',
      firstName: 'Jane',
      lastName: 'Smith',
      GRAPHQL_ENDPOINT: 'https://commerce.example.com/graphql'
    }, mockLogger)

    expect(result.statusCode).toBe(400)
    expect(result.body.error).toContain('at least one field')
  })
})
