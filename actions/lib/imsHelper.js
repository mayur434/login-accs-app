// imsHelper.js
// Helper to get IMS token for DB access.
// Actions are publicly accessible — tokens are ALWAYS self-generated
// from S2S credentials injected via include-ims-credentials annotation.

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient

/**
 * Generate IMS access token from S2S credentials.
 * Reads from action params first, falls back to process.env (local dev).
 * @param {object} params - action params (may contain IMS_OAUTH_S2S_* keys)
 * @returns {Promise<string>} access token, or empty string if credentials missing
 */
async function generateSelfToken(params = {}) {
  const clientId = params.IMS_OAUTH_S2S_CLIENT_ID || process.env.IMS_OAUTH_S2S_CLIENT_ID
  const clientSecret = params.IMS_OAUTH_S2S_CLIENT_SECRET || process.env.IMS_OAUTH_S2S_CLIENT_SECRET
  const orgId = params.IMS_OAUTH_S2S_ORG_ID || process.env.IMS_OAUTH_S2S_ORG_ID
  if (!clientId || !clientSecret || !orgId) return ''

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
  return tokenResponse.access_token
}

/**
 * Get IMS token for DB access.
 * Always self-generates from S2S credentials. No header auth required.
 *
 * @param {object} params - action params (contains IMS_OAUTH_S2S_* and DB_TYPE)
 * @returns {Promise<string|null>} - IMS access token, or null for MySQL
 */
async function getAioDbToken(params = {}) {
  const dbType = (params.DB_TYPE || process.env.DB_TYPE || 'docdb').toLowerCase().trim()
  if (dbType === 'mysql') return null

  return generateSelfToken(params)
}

module.exports = { getAioDbToken }
