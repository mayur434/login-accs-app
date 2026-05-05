/**
 * google-sso action
 *
 * Public endpoint: POST /google-sso
 *
 * Accepts { google_token } — a Google ID token (JWT) from Google Sign-In / MSAL.
 *
 * Flow:
 *   1. Verify the Google ID token signature, issuer, audience and expiry.
 *   2. Extract email, name, and Google sub (unique user ID) from token.
 *   3. Look up identity table by google_sub or email.
 *   4. If found → generate Commerce token.
 *   5. If not found → create Commerce customer, generate token, save identity.
 *   6. Return { customer_token, customer }.
 *
 * Required env / runtime inputs:
 *   GOOGLE_CLIENT_ID   — Google OAuth 2.0 Client ID
 *   GRAPHQL_ENDPOINT, DB_TYPE, MYSQL_* (same as other actions)
 */

const { Core } = require('@adobe/aio-sdk')
const jwt = require('jsonwebtoken')
const fetch = require('node-fetch')

const { serverError, badRequest } = require('../lib/http')
const { getCollection, closeDb, assertModuleEnabled, APP_CONFIG_COLLECTION } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { graphQLRequest, commerceGraphQLRequest } = require('../lib/graphql')
const { getAioDbToken } = require('../lib/imsHelper')
const { generateTraceId, actionStart, actionEnd } = require('../lib/logger')
const {
  INTERNAL_CUSTOMER_PASSWORD,
  parseCustomerIdFromToken
} = require('../lib/customer')
const { fetchCustomerProfile } = require('../lib/commerce')

// ── Google token verification ───────────────────────────────────────────

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v1/certs'
const CERTS_CACHE = { certs: null, fetchedAt: 0 }
const CERTS_TTL_MS = 60 * 60 * 1000 // 1 hour

async function getGoogleCerts () {
  const now = Date.now()
  if (CERTS_CACHE.certs && now - CERTS_CACHE.fetchedAt < CERTS_TTL_MS) {
    return CERTS_CACHE.certs
  }
  const res = await fetch(GOOGLE_CERTS_URL)
  if (!res.ok) throw new Error(`Failed to fetch Google certs (HTTP ${res.status})`)
  const certs = await res.json()
  CERTS_CACHE.certs = certs
  CERTS_CACHE.fetchedAt = now
  return certs
}

async function verifyGoogleToken (googleToken, clientId) {
  // Decode header to find matching kid
  const decoded = jwt.decode(googleToken, { complete: true })
  if (!decoded) throw Object.assign(new Error('invalid google_token: not a valid JWT'), { statusCode: 401 })

  const { kid } = decoded.header
  const certs = await getGoogleCerts()
  const cert = certs[kid]
  if (!cert) throw Object.assign(new Error('google_token: signing key not found'), { statusCode: 401 })

  // Verify with Google's public certificate
  const payload = jwt.verify(googleToken, cert, {
    algorithms: ['RS256'],
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com']
  })

  return payload
}

// ── Commerce helpers ────────────────────────────────────────────────────

async function createCommerceCustomer (email, firstname, lastname, params, logger) {
  const mutation = `mutation CreateCustomer($input: CustomerCreateInput!) {
    createCustomerV2(input: $input) { customer { id firstname lastname email } }
  }`
  const input = {
    firstname: firstname || 'Guest',
    lastname: lastname || 'User',
    email,
    password: INTERNAL_CUSTOMER_PASSWORD
  }
  return commerceGraphQLRequest(params, mutation, { input }, logger)
}

async function generateCommerceToken (email, params, logger) {
  const mutation = `mutation GenerateToken($email: String!) {
    generateCustomerToken(email: $email, password: "${INTERNAL_CUSTOMER_PASSWORD}") { token }
  }`
  try {
    const resp = await graphQLRequest(params, mutation, { email }, logger)
    return resp?.data?.generateCustomerToken?.token || null
  } catch (e) {
    logger.debug('generateCustomerToken failed: ' + e.message)
    return null
  }
}

async function getCustomerStatus (params, email, logger) {
  // Probe via generateCustomerToken – Commerce has no public exists-check query
  try {
    const mutation = `mutation { generateCustomerToken(email: "${email.replace(/"/g, '')}", password: "${INTERNAL_CUSTOMER_PASSWORD}") { token } }`
    const resp = await commerceGraphQLRequest(params, mutation, {}, logger)
    const exists = !!resp?.data?.generateCustomerToken?.token
    return { isCustomerExists: exists, isDisabled: false }
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase()
    if (msg.includes('disabled') || msg.includes('locked')) {
      return { isCustomerExists: true, isDisabled: true }
    }
    return { isCustomerExists: false, isDisabled: false }
  }
}

function resolveCustomerId (createdCustomer, token) {
  if (createdCustomer?.id !== undefined && createdCustomer?.id !== null && createdCustomer.id !== '') {
    const parsed = Number(createdCustomer.id)
    return Number.isNaN(parsed) ? createdCustomer.id : parsed
  }

  return parseCustomerIdFromToken(token)
}

// ── Main action ─────────────────────────────────────────────────────────

exports.main = async (params) => {
  const logger = Core.Logger('google-sso', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = generateTraceId()

  try {
    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    const googleToken = inParams.google_token
    if (!googleToken) return badRequest("missing parameter 'google_token'")

    const clientId = params.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    if (!clientId) return serverError('GOOGLE_CLIENT_ID is not configured')

    // ── Verify Google token ──────────────────────────────────────────
    let googlePayload
    try {
      googlePayload = await verifyGoogleToken(googleToken, clientId)
    } catch (e) {
      const code = e.statusCode || 401
      return { statusCode: code, body: { error: e.message } }
    }

    const email = googlePayload.email
    if (!email?.includes('@')) {
      return { statusCode: 400, body: { error: 'Google token does not contain a verified email address' } }
    }
    const normalizedEmail = email.trim().toLowerCase()

    // sub is Google's stable unique identifier for the user
    const googleSub = googlePayload.sub
    const name = googlePayload.name || ''
    const firstname = googlePayload.given_name || name.split(' ')[0] || 'Guest'
    const lastname = googlePayload.family_name || name.split(' ').slice(1).join(' ') || 'User'

    logger.info(`Google SSO login: email=${normalizedEmail}, sub=${googleSub}`)

    const aioDbToken = await getAioDbToken(inParams).catch(e => {
      logger.warn(`Unable to generate IMS token for DB: ${e.message}`)
      return null
    })
    const { dbClient: client } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      APP_CONFIG_COLLECTION,
      { traceId }
    )
    dbClient = client
    const rawDb = dbClient._rawDbClient || dbClient
    actionStart(rawDb, traceId, 'google-sso')

    await assertModuleEnabled(dbClient)

    const customerStatus = await getCustomerStatus(inParams, normalizedEmail, logger)
    if (customerStatus.isDisabled) {
      actionEnd(rawDb, traceId, 'google-sso', { statusCode: 403 })
      return { statusCode: 403, body: { error: 'Your account is disabled. Please contact support.' } }
    }

    if (customerStatus.isCustomerExists) {
      // ── Returning user: just generate Commerce token ──────────────
      logger.info('Existing Google SSO user found')
      const token = await generateCommerceToken(normalizedEmail, inParams, logger)
      if (!token) {
        actionEnd(rawDb, traceId, 'google-sso', { statusCode: 404 })
        return { statusCode: 404, body: { error: 'user exists but not found in Commerce' } }
      }

      let profile = null
      try { profile = await fetchCustomerProfile(inParams, token, logger) } catch (e) {
        logger.debug('Could not fetch customer profile after login: ' + e.message)
      }

      actionEnd(rawDb, traceId, 'google-sso', { statusCode: 200, operation: 'login' })
      return {
        statusCode: 200,
        body: {
          success: true,
          customer_token: token,
          message: 'login successful',
          customer: {
            customer_id: parseCustomerIdFromToken(token) || profile?.id || null,
            email: profile?.email || normalizedEmail,
            firstname: profile?.firstname || firstname,
            lastname: profile?.lastname || lastname,
            login_provider: 'google',
            login_type: 'email'
          }
        }
      }
    }

    // ── New user: create Commerce customer ────────────────────────────
    logger.info('New Google SSO user — creating Commerce customer...')
    let createdCustomer = null
    try {
      const createResp = await createCommerceCustomer(normalizedEmail, firstname, lastname, inParams, logger)
      createdCustomer = createResp?.data?.createCustomerV2?.customer || null
    } catch (createErr) {
      const msg = String(createErr?.message || '')
      if (!msg.toLowerCase().includes('already exists')) {
        logger.error('Commerce customer creation failed: ' + msg)
        actionEnd(rawDb, traceId, 'google-sso', { statusCode: 500 })
        return serverError(`registration failed: ${msg}`)
      }
      logger.warn('Customer already exists in Commerce — skipping creation')
    }

    const token = await generateCommerceToken(normalizedEmail, inParams, logger)
    if (!token) {
      actionEnd(rawDb, traceId, 'google-sso', { statusCode: 500 })
      return serverError('customer created but Commerce token generation failed')
    }

    const customerId = resolveCustomerId(createdCustomer, token)

    let profile = null
    try { profile = await fetchCustomerProfile(inParams, token, logger) } catch (e) {
      logger.debug('Could not fetch customer profile after registration: ' + e.message)
    }

    actionEnd(rawDb, traceId, 'google-sso', { statusCode: 200, operation: 'register' })
    return {
      statusCode: 200,
      body: {
        success: true,
        customer_token: token,
        message: 'registration successful',
        customer: {
          customer_id: customerId || profile?.id || null,
          email: profile?.email || normalizedEmail,
          firstname: profile?.firstname || firstname,
          lastname: profile?.lastname || lastname,
          login_provider: 'google',
          login_type: 'email'
        }
      }
    }
  } catch (err) {
    const code = err.statusCode || 500
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) actionEnd(rawDb, traceId, 'google-sso', { statusCode: code, error: err.message })
    if (code >= 500) logger.error(err)
    return { statusCode: code, body: { error: err.message || 'server error' } }
  } finally {
    await closeDb(dbClient, logger)
  }
}
