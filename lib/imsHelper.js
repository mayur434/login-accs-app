// imsHelper.js
// Helper to get IMS token for DB access.
// Actions are publicly accessible — tokens are ALWAYS self-generated
// from S2S credentials injected via include-ims-credentials annotation.
//
// Token caching: S2S tokens last 24h. We cache in aio-lib-state with 23h TTL
// so subsequent invocations (even on different containers) skip the ~1.2s IMS call.

const crypto = require('node:crypto')
const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient

const IMS_TOKEN_STATE_KEY_PREFIX = 'ims_token_'
const IMS_TOKEN_TTL_SECONDS = Number(process.env.IMS_TOKEN_TTL_SECONDS) || 72000 // 20h (token lasts 24h, 4h safety margin)

// In-process cache for current invocation (avoids redundant state calls within same request)
let _cachedToken = null
let _cachedTokenFingerprint = null

/**
 * Derive a short fingerprint from credentials so that a secret rotation
 * automatically invalidates the cached token.
 */
function credentialFingerprint (clientId, clientSecret, orgId) {
  const input = `${clientId}:${clientSecret}:${orgId}`
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)
}

/**
 * Get state client (lazy singleton — same as db.js).
 */
let _stateClient = null
async function getStateClient () {
  if (!_stateClient) {
    const { State } = require('@adobe/aio-sdk')
    _stateClient = await State.init()
  }
  return _stateClient
}

/**
 * Try to read IMS token from aio-lib-state.
 */
async function getTokenFromState (fingerprint) {
  try {
    const state = await getStateClient()
    const res = await state.get(IMS_TOKEN_STATE_KEY_PREFIX + fingerprint)
    if (res && res.value && res.value.token) return res.value.token
  } catch (_) { /* fallback to fresh generation */ }
  return null
}

/**
 * Cache IMS token in aio-lib-state.
 */
async function putTokenToState (fingerprint, token) {
  try {
    const state = await getStateClient()
    await state.put(IMS_TOKEN_STATE_KEY_PREFIX + fingerprint, { token }, { ttl: IMS_TOKEN_TTL_SECONDS })
  } catch (_) { /* non-critical */ }
}

/**
 * Invalidate cached IMS token (call on 401 from DocDB).
 */
async function invalidateImsTokenCache (fingerprint) {
  _cachedToken = null
  _cachedTokenFingerprint = null
  try {
    const state = await getStateClient()
    await state.delete(IMS_TOKEN_STATE_KEY_PREFIX + fingerprint)
  } catch (_) { /* ignore */ }
}

/**
 * Generate IMS access token from S2S credentials.
 * Checks state cache first, falls back to IMS call, then warms cache.
 */
async function generateSelfToken(params = {}) {
  const clientId = params.IMS_OAUTH_S2S_CLIENT_ID || process.env.IMS_OAUTH_S2S_CLIENT_ID
  const clientSecret = params.IMS_OAUTH_S2S_CLIENT_SECRET || process.env.IMS_OAUTH_S2S_CLIENT_SECRET
  const orgId = params.IMS_OAUTH_S2S_ORG_ID || process.env.IMS_OAUTH_S2S_ORG_ID
  if (!clientId || !clientSecret || !orgId) return ''

  const fingerprint = credentialFingerprint(clientId, clientSecret, orgId)

  // 1. In-process cache (same invocation)
  if (_cachedToken && _cachedTokenFingerprint === fingerprint) {
    return _cachedToken
  }

  // 2. aio-lib-state cache (cross-container, survives cold starts)
  const stateToken = await getTokenFromState(fingerprint)
  if (stateToken) {
    _cachedToken = stateToken
    _cachedTokenFingerprint = fingerprint
    return stateToken
  }

  // 3. Fresh IMS call (miss on both caches)
  const imsCredentials = { clientId, clientSecret, orgId }
  let rawScopes = params.IMS_OAUTH_S2S_SCOPES || process.env.IMS_OAUTH_S2S_SCOPES
  if (Array.isArray(rawScopes)) {
    imsCredentials.scopes = rawScopes
  } else if (typeof rawScopes === 'string') {
    const trimmed = rawScopes.trim()
    try {
      const parsed = JSON.parse(trimmed)
      imsCredentials.scopes = Array.isArray(parsed)
        ? parsed.map(s => String(s).trim()).filter(Boolean)
        : []
    } catch (e) {
      imsCredentials.scopes = trimmed
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    }
  } else {
    imsCredentials.scopes = []
  }

  const tokenResponse = await generateAccessToken(imsCredentials)
  const token = tokenResponse.access_token

  // Warm caches
  _cachedToken = token
  _cachedTokenFingerprint = fingerprint
  await putTokenToState(fingerprint, token)

  return token
}

/**
 * Get IMS token for DB access.
 * Uses state cache (23h TTL) to avoid ~1.2s IMS call on every invocation.
 *
 * @param {object} params - action params (contains IMS_OAUTH_S2S_* and DB_TYPE)
 * @returns {Promise<string|null>} - IMS access token, or null for MySQL
 */
async function getAioDbToken(params = {}) {
  const dbType = (params.DB_TYPE || process.env.DB_TYPE || 'docdb').toLowerCase().trim()
  if (dbType === 'mysql') return null

  return generateSelfToken(params)
}

module.exports = { getAioDbToken, invalidateImsTokenCache, credentialFingerprint }
