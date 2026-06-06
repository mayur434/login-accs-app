/**
 * google-sso action
 *
 * Public endpoint: POST /google-sso
 *
 * Accepts { google_token } — a Google ID token (JWT) from Google Sign-In.
 * Verifies token → checks Commerce customer → login or register → return token.
 */

const jwt = require('jsonwebtoken')
const fetch = require('node-fetch')

const { runAction } = require('../../../lib/actionRunner')
const { serverError, badRequest } = require('../../../lib/http')
const { APP_CONFIG_COLLECTION } = require('../../../lib/db')
const { graphQLRequest, commerceGraphQLRequest } = require('../../../lib/graphql')
const {
  INTERNAL_CUSTOMER_PASSWORD,
  parseCustomerIdFromToken
} = require('../../../lib/customer')
const { fetchCustomerProfile, checkCustomerStatus } = require('../../../lib/commerce')

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
  const decoded = jwt.decode(googleToken, { complete: true })
  if (!decoded) throw Object.assign(new Error('invalid google_token: not a valid JWT'), { statusCode: 401 })

  const { kid } = decoded.header
  const certs = await getGoogleCerts()
  const cert = certs[kid]
  if (!cert) throw Object.assign(new Error('google_token: signing key not found'), { statusCode: 401 })

  return jwt.verify(googleToken, cert, {
    algorithms: ['RS256'],
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com']
  })
}

// ── Commerce helpers ────────────────────────────────────────────────────

async function createCommerceCustomer (email, firstname, lastname, params, logger) {
  const mutation = `mutation CreateCustomer($input: CustomerCreateInput!) {
    createCustomerV2(input: $input) { customer { id firstname lastname email } }
  }`
  const input = { firstname: firstname || 'Guest', lastname: lastname || 'User', email, password: INTERNAL_CUSTOMER_PASSWORD }
  return commerceGraphQLRequest(params, mutation, { input }, logger)
}

async function generateCommerceToken (email, params, logger) {
  const mutation = `mutation GenerateToken($email: String!, $password: String!) {
    generateCustomerToken(email: $email, password: $password) { token }
  }`
  try {
    const resp = await graphQLRequest(params, mutation, { email, password: INTERNAL_CUSTOMER_PASSWORD }, logger)
    return resp?.data?.generateCustomerToken?.token || null
  } catch (e) {
    logger.debug?.('generateCustomerToken failed: ' + e.message)
    return null
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

exports.main = runAction('google-sso', APP_CONFIG_COLLECTION, async ({ params, logger, appConfig }) => {
  const googleToken = params.google_token
  if (!googleToken) return badRequest("missing parameter 'google_token'")

  if (!appConfig.google_sso_enabled) {
    return { statusCode: 200, body: { success: false, statusCode: 403, error: 'Google SSO is disabled', message: 'Google SSO is disabled' } }
  }

  const clientId = appConfig.google_client_id || params.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  if (!clientId) return serverError('GOOGLE_CLIENT_ID is not configured. Set it via Admin UI or environment variables.')

  // Verify Google token
  let googlePayload
  try {
    googlePayload = await verifyGoogleToken(googleToken, clientId)
  } catch (e) {
    return { statusCode: e.statusCode || 401, body: { error: e.message } }
  }

  const email = googlePayload.email
  if (!email?.includes('@')) return { statusCode: 200, body: { success: false, statusCode: 400, error: 'Google token does not contain a verified email address', message: 'Google token does not contain a verified email address' } }
  if (googlePayload.email_verified === false) return { statusCode: 200, body: { success: false, statusCode: 401, error: 'Google email address is not verified', message: 'Google email address is not verified' } }

  const normalizedEmail = email.trim().toLowerCase()
  const name = googlePayload.name || ''
  const firstname = googlePayload.given_name || name.split(' ')[0] || 'Guest'
  const lastname = googlePayload.family_name || name.split(' ').slice(1).join(' ') || 'User'

  // Customer status check via Commerce
  const customerStatus = await checkCustomerStatus(params, normalizedEmail, null, logger)

  if (customerStatus.isDisabled) {
    return { statusCode: 200, body: { success: false, statusCode: 403, error: 'Your account is disabled. Please contact support.', message: 'Your account is disabled. Please contact support.' } }
  }

  if (customerStatus.isCustomerExists) {
    const token = await generateCommerceToken(normalizedEmail, params, logger)
    if (!token) return { statusCode: 200, body: { success: false, statusCode: 404, error: 'user exists but not found in Commerce', message: 'user exists but not found in Commerce' } }

    const profile = await fetchCustomerProfile(params, token, logger).catch(() => null)
    return {
      statusCode: 200,
      body: {
        success: true, customer_token: token, message: 'login successful',
        customer: {
          customer_id: parseCustomerIdFromToken(token) || profile?.id || null,
          email: profile?.email || normalizedEmail,
          firstname: profile?.firstname || firstname,
          lastname: profile?.lastname || lastname,
          login_provider: 'google', login_type: 'email'
        }
      }
    }
  }

  // New user: create Commerce customer
  let createdCustomer = null
  try {
    const createResp = await createCommerceCustomer(normalizedEmail, firstname, lastname, params, logger)
    createdCustomer = createResp?.data?.createCustomerV2?.customer || null
  } catch (createErr) {
    const msg = String(createErr?.message || '')
    if (!msg.toLowerCase().includes('already exists')) return serverError(`registration failed: ${msg}`)
  }

  const token = await generateCommerceToken(normalizedEmail, params, logger)
  if (!token) return serverError('customer created but Commerce token generation failed')

  const customerId = resolveCustomerId(createdCustomer, token)

  return {
    statusCode: 200,
    body: {
      success: true, customer_token: token, message: 'registration successful',
      customer: {
        customer_id: customerId || createdCustomer?.id || null,
        email: createdCustomer?.email || normalizedEmail,
        firstname: createdCustomer?.firstname || firstname,
        lastname: createdCustomer?.lastname || lastname,
        login_provider: 'google', login_type: 'email'
      }
    }
  }
})
