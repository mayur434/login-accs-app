/**
 * Unit tests for actions/google-sso/index.js
 *
 * Covers:
 *   - Token verification failures (bad JWT, wrong audience, missing kid)
 *   - Existing user login path
 *   - New user registration path
 *   - Identity upsert / google_sub backfill behaviour
 *   - DocDB adapter path with DB_TYPE=docdb
 *   - Integration-style test: stage-like env inputs → success response shape
 */

// ── External deps mocks ────────────────────────────────────────────────

jest.mock('node-fetch')
const fetch = require('node-fetch')

jest.mock('jsonwebtoken', () => ({
  decode: jest.fn(),
  verify: jest.fn()
}))
const jwt = require('jsonwebtoken')

jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    })
  }
}))

jest.mock('../actions/lib/imsHelper', () => ({
  getAioDbToken: jest.fn().mockResolvedValue('mock-ims-token')
}))

// ── DB mock ────────────────────────────────────────────────────────────

const mockCollection = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  deleteOne: jest.fn()
}

const mockDbClient = {
  collection: jest.fn().mockResolvedValue(mockCollection),
  close: jest.fn(),
  _rawDbClient: null
}

jest.mock('../actions/lib/db', () => {
  const actual = jest.requireActual('../actions/lib/db')
  return {
    ...actual,
    getCollection: jest.fn().mockResolvedValue({
      dbClient: mockDbClient,
      collection: mockCollection
    }),
    closeDb: jest.fn(),
    findOneOrNull: jest.fn(),
    assertModuleEnabled: jest.fn().mockResolvedValue(undefined)
  }
})

const { findOneOrNull, assertModuleEnabled } = require('../actions/lib/db')

// ── Logger mock ────────────────────────────────────────────────────────

jest.mock('../actions/lib/logger', () => ({
  generateTraceId: jest.fn().mockReturnValue('trace-test-001'),
  actionStart: jest.fn(),
  actionEnd: jest.fn()
}))

// ── Commerce mock ──────────────────────────────────────────────────────

jest.mock('../actions/lib/commerce', () => ({
  fetchCustomerProfile: jest.fn().mockResolvedValue({
    id: 42,
    email: 'jane@example.com',
    firstname: 'Jane',
    lastname: 'Doe'
  })
}))

// ── Helpers ────────────────────────────────────────────────────────────

const { main } = require('../actions/google-sso/index')

/** Build a base64url-encoded JWT segment */
function b64url (obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function makeFakeJwt (payload = {}) {
  return `${b64url({ alg: 'RS256', kid: 'kid1' })}.${b64url(payload)}.sig`
}

const MOCK_GOOGLE_TOKEN = makeFakeJwt({
  sub: 'google-sub-123',
  email: 'jane@example.com',
  email_verified: true,
  given_name: 'Jane',
  family_name: 'Doe',
  name: 'Jane Doe',
  aud: 'test-client-id',
  iss: 'https://accounts.google.com'
})

const BASE_PARAMS = {
  __ow_method: 'POST',
  __ow_headers: { host: 'adobeioruntime.net' },
  LOG_LEVEL: 'info',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GRAPHQL_ENDPOINT: 'https://store.example.com/graphql',
  DB_TYPE: 'docdb',
  IMS_OAUTH_S2S_CLIENT_ID: 'ims-client-id',
  IMS_OAUTH_S2S_CLIENT_SECRET: 'ims-secret',
  IMS_OAUTH_S2S_ORG_ID: 'org@AdobeOrg',
  IMS_OAUTH_S2S_SCOPES: '["AdobeID","openid"]',
  MAGENTO_ENVIRONMENT_ID: 'env-id',
  MAGENTO_STORE_CODE: 'main_website_store',
  MAGENTO_STORE_VIEW_CODE: 'default',
  MAGENTO_WEBSITE_CODE: 'base'
}

/** Default fetch mock that returns Google certs and Commerce token */
function setupDefaultFetch () {
  fetch.mockImplementation((url) => {
    // Google public certs
    if (url && url.includes('googleapis.com/oauth2/v1/certs')) {
      return Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue({ kid1: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----' })
      })
    }
    // Commerce GraphQL
    return Promise.resolve({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({
        data: {
          createCustomerV2: { customer: { id: 42, email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' } },
          generateCustomerToken: { token: 'commerce-jwt-token' }
        }
      }))
    })
  })
}

/** Make jwt.decode return a well-formed Google token header+payload */
function setupJwtDecode (payload = null) {
  jwt.decode.mockReturnValue({
    header: { alg: 'RS256', kid: 'kid1' },
    payload: payload || {
      sub: 'google-sub-123',
      email: 'jane@example.com',
      email_verified: true,
      given_name: 'Jane',
      family_name: 'Doe',
      name: 'Jane Doe'
    }
  })
}

/** Make jwt.verify succeed with the given payload */
function setupJwtVerifySuccess (payload = null) {
  jwt.verify.mockReturnValue(payload || {
    sub: 'google-sub-123',
    email: 'jane@example.com',
    email_verified: true,
    given_name: 'Jane',
    family_name: 'Doe',
    name: 'Jane Doe'
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDbClient.collection.mockResolvedValue(mockCollection)
  mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 })
  assertModuleEnabled.mockResolvedValue(undefined)
  setupDefaultFetch()
  setupJwtDecode()
  setupJwtVerifySuccess()
})

// ════════════════════════════════════════════════════════════════════════
// 1. Input validation
// ════════════════════════════════════════════════════════════════════════

describe('input validation', () => {
  test('returns 400 when google_token is missing', async () => {
    const result = await main({ ...BASE_PARAMS })
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toMatch(/google_token/)
  })

  test('returns 500 when GOOGLE_CLIENT_ID is not configured', async () => {
    const { GOOGLE_CLIENT_ID: _, ...noClientId } = BASE_PARAMS
    const result = await main({ ...noClientId, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(500)
    expect(result.body.error).toMatch(/GOOGLE_CLIENT_ID/i)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 2. Token verification failures
// ════════════════════════════════════════════════════════════════════════

describe('token verification failures', () => {
  test('returns 401 when JWT cannot be decoded at all', async () => {
    jwt.decode.mockReturnValue(null)
    const result = await main({ ...BASE_PARAMS, google_token: 'not.a.jwt' })
    expect(result.statusCode).toBe(401)
    expect(result.body.error).toMatch(/invalid google_token/)
  })

  test('returns 401 when kid is not in Google certs', async () => {
    jwt.decode.mockReturnValue({ header: { alg: 'RS256', kid: 'unknown-kid' }, payload: {} })
    // Certs cache: only has 'kid1', not 'unknown-kid'
    fetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: jest.fn().mockResolvedValue({ kid1: 'cert-value' })
      })
    )
    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(401)
    expect(result.body.error).toMatch(/signing key not found/)
  })

  test('returns 401 when jwt.verify throws (wrong audience)', async () => {
    const err = new Error('jwt audience invalid')
    jwt.verify.mockImplementation(() => { throw err })
    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(401)
    expect(result.body.error).toContain('jwt audience invalid')
  })

  test('returns 401 when jwt.verify throws (expired)', async () => {
    const err = new Error('jwt expired')
    jwt.verify.mockImplementation(() => { throw err })
    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(401)
    expect(result.body.error).toContain('jwt expired')
  })

  test('returns 401 when jwt.verify throws (wrong issuer)', async () => {
    const err = new Error('jwt issuer invalid')
    jwt.verify.mockImplementation(() => { throw err })
    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(401)
  })

  test('returns 400 when verified token contains no email', async () => {
    jwt.verify.mockReturnValue({ sub: 'google-sub-123' }) // no email
    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(400)
    expect(result.body.error).toMatch(/email/)
  })

  test('returns 500 when Google certs endpoint is unreachable', async () => {
    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: false, status: 503 })
      }
      // Commerce calls succeed
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({ data: {} }))
      })
    })
    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(500)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 3. Existing user — login path
// ════════════════════════════════════════════════════════════════════════

describe('existing user — login', () => {
  test('returns 200 with customer_token when user found by google_sub', async () => {
    findOneOrNull.mockResolvedValueOnce({
      email: 'jane@example.com',
      customer_id: 42,
      google_sub: 'google-sub-123',
      firstname: 'Jane',
      lastname: 'Doe',
      status: 'active'
    })

    // Commerce token generation
    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({ kid1: '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----' })
        })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'commerce-login-token' } }
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(200)
    expect(result.body.success).toBe(true)
    expect(result.body.customer_token).toBe('commerce-login-token')
    expect(result.body.message).toMatch(/login/)
    expect(result.body.customer.login_provider).toBe('google')
    expect(result.body.customer.login_type).toBe('email')
    expect(result.body.customer.customer_id).toBe(42)
  })

  test('falls back to email match when google_sub lookup returns null', async () => {
    findOneOrNull
      .mockResolvedValueOnce(null) // google_sub miss
      .mockResolvedValueOnce({     // email hit
        email: 'jane@example.com',
        customer_id: 99,
        google_sub: null,
        status: 'active'
      })

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'email-fallback-token' } }
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(200)
    expect(result.body.customer_token).toBe('email-fallback-token')
  })

  test('backfills google_sub when existing record has none', async () => {
    const existingRecord = {
      email: 'jane@example.com',
      customer_id: 55,
      google_sub: null, // missing — should be backfilled
      status: 'active'
    }
    findOneOrNull
      .mockResolvedValueOnce(null)        // google_sub miss
      .mockResolvedValueOnce(existingRecord) // email hit

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'backfill-token' } }
        }))
      })
    })

    await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })

    // updateOne should have been called to write google_sub (filter on email, not customer_id)
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { email: 'jane@example.com' },
      expect.objectContaining({
        $set: expect.objectContaining({ google_sub: 'google-sub-123' })
      }),
      expect.objectContaining({ upsert: true })
    )
  })

  test('returns 404 when identity record exists but Commerce token generation fails', async () => {
    findOneOrNull.mockResolvedValueOnce({
      email: 'jane@example.com',
      customer_id: 7,
      google_sub: 'google-sub-123',
      status: 'active'
    })

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      // generateCustomerToken returns empty / errors
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          errors: [{ message: 'invalid credentials' }]
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(404)
    expect(result.body.error).toMatch(/not found in Commerce/)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 4. New user — registration path
// ════════════════════════════════════════════════════════════════════════

describe('new user — registration', () => {
  test('creates Commerce customer and returns 200 with registration message', async () => {
    // No identity records exist
    findOneOrNull.mockResolvedValue(null)

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: {
            createCustomerV2: { customer: { id: 88, email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' } },
            generateCustomerToken: { token: 'new-user-token' }
          }
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })

    expect(result.statusCode).toBe(200)
    expect(result.body.success).toBe(true)
    expect(result.body.customer_token).toBe('new-user-token')
    expect(result.body.message).toMatch(/registration/)
    expect(result.body.customer.login_provider).toBe('google')
    // profile.id (42 from mock) takes priority over create response id (88)
    expect(result.body.customer.customer_id).toBe(42)
  })

  test('upserts identity record with correct fields for new user', async () => {
    findOneOrNull.mockResolvedValue(null)

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: {
            createCustomerV2: { customer: { id: 100, email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' } },
            generateCustomerToken: { token: 'new-user-token-2' }
          }
        }))
      })
    })

    await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })

    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { email: 'jane@example.com' },
      expect.objectContaining({
        $set: expect.objectContaining({
          email: 'jane@example.com',
          google_sub: 'google-sub-123',
          login_provider: 'google',
          login_type: 'email',
          status: 'active'
        }),
        $setOnInsert: expect.objectContaining({ created_at: expect.any(Date) })
      }),
      expect.objectContaining({ upsert: true })
    )
  })

  test('falls back gracefully when Commerce create says customer already exists', async () => {
    findOneOrNull.mockResolvedValue(null)

    let callCount = 0
    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      callCount++
      // First call: createCustomerV2 returns "already exists" error
      if (callCount === 1) {
        return Promise.resolve({
          ok: true, status: 200,
          text: jest.fn().mockResolvedValue(JSON.stringify({
            errors: [{ message: 'A customer with the same email address already exists.' }]
          }))
        })
      }
      // Second call: generateCustomerToken succeeds
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'existing-commerce-token' } }
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(200)
    expect(result.body.customer_token).toBe('existing-commerce-token')
  })

  test('returns 500 when createCustomerV2 fails with non-conflict error', async () => {
    findOneOrNull.mockResolvedValue(null)

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          errors: [{ message: 'Internal server error' }]
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    expect(result.statusCode).toBe(500)
    expect(result.body.error).toMatch(/registration failed/)
  })

  test('resolves customer_id from token JWT payload when create response has no id', async () => {
    findOneOrNull.mockResolvedValue(null)
    // fetchCustomerProfile returns nothing so token payload is the fallback
    const { fetchCustomerProfile } = require('../actions/lib/commerce')
    fetchCustomerProfile.mockResolvedValueOnce(null)

    // Encode a token that carries customer_id=77 in payload
    const tokenPayload = { customer_id: 77, exp: 9999999999 }
    const fakeCommerceToken = `${b64url({ alg: 'HS256' })}.${b64url(tokenPayload)}.sig`

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: {
            createCustomerV2: { customer: { email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' } }, // no id
            generateCustomerToken: { token: fakeCommerceToken }
          }
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })

    expect(result.statusCode).toBe(200)
    // updateOne should have been called with email filter; customer_id resolved from token payload
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { email: 'jane@example.com' },
      expect.objectContaining({
        $set: expect.objectContaining({ customer_id: 77 })
      }),
      expect.anything()
    )
  })
})

// ════════════════════════════════════════════════════════════════════════
// 5. DocDB adapter path — ensures IMS token is requested
// ════════════════════════════════════════════════════════════════════════

describe('docdb adapter — IMS token generation', () => {
  test('calls getAioDbToken with request params (DB_TYPE=docdb)', async () => {
    const { getAioDbToken } = require('../actions/lib/imsHelper')
    findOneOrNull.mockResolvedValueOnce({
      email: 'jane@example.com',
      customer_id: 42,
      google_sub: 'google-sub-123',
      status: 'active'
    })

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'docdb-token' } }
        }))
      })
    })

    await main({ ...BASE_PARAMS, DB_TYPE: 'docdb', google_token: MOCK_GOOGLE_TOKEN })
    expect(getAioDbToken).toHaveBeenCalledWith(expect.objectContaining({ DB_TYPE: 'docdb' }))
  })

  test('continues when IMS token generation fails (non-fatal for SSO action)', async () => {
    const { getAioDbToken } = require('../actions/lib/imsHelper')
    getAioDbToken.mockRejectedValueOnce(new Error('IMS unreachable'))

    findOneOrNull.mockResolvedValueOnce({
      email: 'jane@example.com',
      customer_id: 42,
      google_sub: 'google-sub-123',
      status: 'active'
    })

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'ims-fallback-token' } }
        }))
      })
    })

    const result = await main({ ...BASE_PARAMS, google_token: MOCK_GOOGLE_TOKEN })
    // Should still succeed — IMS token failure is warn-logged, not fatal
    expect(result.statusCode).toBe(200)
  })
})

// ════════════════════════════════════════════════════════════════════════
// 6. Integration-style: stage-like env inputs → complete response shape
// ════════════════════════════════════════════════════════════════════════

describe('integration — stage env inputs → success response shape', () => {
  const STAGE_PARAMS = {
    __ow_method: 'POST',
    __ow_headers: {
      host: '108480-customerotplogin-stage.adobeioruntime.net',
      'x-forwarded-for': '203.0.113.1'
    },
    LOG_LEVEL: 'info',
    GOOGLE_CLIENT_ID: '740451404995-abc.apps.googleusercontent.com',
    GRAPHQL_ENDPOINT: 'https://na1-sandbox.api.commerce.adobe.com/vijaySales/graphql',
    DB_TYPE: 'docdb',
    IMS_OAUTH_S2S_CLIENT_ID: 'stage-client-id',
    IMS_OAUTH_S2S_CLIENT_SECRET: 'stage-secret',
    IMS_OAUTH_S2S_ORG_ID: '0DC5A26A5AC20D8C0A495ECD@AdobeOrg',
    IMS_OAUTH_S2S_SCOPES: '["AdobeID","openid","adobeio_api"]',
    MAGENTO_ENVIRONMENT_ID: 'f38a0de0-764b-41fa-bd2c-5bc2f3c7b39a',
    MAGENTO_STORE_CODE: 'main_website_store',
    MAGENTO_STORE_VIEW_CODE: 'default',
    MAGENTO_WEBSITE_CODE: 'base',
    google_token: MOCK_GOOGLE_TOKEN
  }

  test('existing user: returns all required response fields', async () => {
    findOneOrNull.mockResolvedValueOnce({
      email: 'jane@example.com',
      customer_id: 42,
      google_sub: 'google-sub-123',
      status: 'active'
    })

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: { generateCustomerToken: { token: 'stage-commerce-token' } }
        }))
      })
    })

    const result = await main({ ...STAGE_PARAMS, GOOGLE_CLIENT_ID: '740451404995-abc.apps.googleusercontent.com' })

    expect(result.statusCode).toBe(200)
    expect(result.body).toMatchObject({
      success: true,
      customer_token: 'stage-commerce-token',
      message: expect.stringMatching(/login/),
      customer: {
        customer_id: expect.anything(),
        email: expect.stringContaining('@'),
        firstname: expect.any(String),
        lastname: expect.any(String),
        login_provider: 'google',
        login_type: 'email'
      }
    })
  })

  test('new user: returns all required response fields', async () => {
    findOneOrNull.mockResolvedValue(null)

    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: {
            createCustomerV2: { customer: { id: 200, email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' } },
            generateCustomerToken: { token: 'stage-new-user-token' }
          }
        }))
      })
    })

    const result = await main({ ...STAGE_PARAMS, GOOGLE_CLIENT_ID: '740451404995-abc.apps.googleusercontent.com' })

    expect(result.statusCode).toBe(200)
    expect(result.body).toMatchObject({
      success: true,
      customer_token: 'stage-new-user-token',
      message: expect.stringMatching(/registration/),
      customer: {
        customer_id: expect.anything(),
        email: expect.stringContaining('@'),
        login_provider: 'google',
        login_type: 'email'
      }
    })
  })

  test('email is normalized to lowercase', async () => {
    // Token has UPPER case email
    jwt.verify.mockReturnValue({
      sub: 'google-sub-123',
      email: 'JANE@EXAMPLE.COM',
      given_name: 'Jane',
      family_name: 'Doe',
      name: 'Jane Doe'
    })

    findOneOrNull.mockResolvedValue(null)
    fetch.mockImplementation((url) => {
      if (url && url.includes('googleapis.com')) {
        return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue({ kid1: 'cert' }) })
      }
      return Promise.resolve({
        ok: true, status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          data: {
            createCustomerV2: { customer: { id: 300, email: 'jane@example.com', firstname: 'Jane', lastname: 'Doe' } },
            generateCustomerToken: { token: 'lowercase-token' }
          }
        }))
      })
    })

    await main({ ...STAGE_PARAMS, GOOGLE_CLIENT_ID: '740451404995-abc.apps.googleusercontent.com' })

    // identity upsert should use lowercase email
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ email: 'jane@example.com' })
      }),
      expect.anything()
    )
  })
})
