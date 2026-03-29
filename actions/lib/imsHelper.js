// imsHelper.js
// Helper to get IMS token for DB access, supporting localhost (dev) and production

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient

/**
 * Get IMS token for DB access.
 * Priority: 1) header token (if present), 2) self-generate from env credentials.
 * This ensures the action works when called directly (with headers) AND
 * when called via API Mesh (no auth headers from consumer).
 *
 * @param {object} headers - HTTP headers (from __ow_headers)
 * @returns {Promise<string|null>} - IMS access token, or null for MySQL
 */
async function getAioDbToken(headers = {}) {
  // MySQL mode does not require IMS tokens for DB access
  const dbType = (process.env.DB_TYPE || 'docdb').toLowerCase().trim()
  if (dbType === 'mysql') return null

  // 1. Try extracting token from request headers (direct caller or mesh with operationHeaders)
  const headerToken = headers['authorization']
    ? headers['authorization'].replace(/^Bearer\s+/i, '')
    : headers['x-ims-token'] || null
  if (headerToken) return headerToken

  // 2. Fallback: generate from environment S2S credentials
  const clientId = process.env.IMS_OAUTH_S2S_CLIENT_ID
  const clientSecret = process.env.IMS_OAUTH_S2S_CLIENT_SECRET
  const orgId = process.env.IMS_OAUTH_S2S_ORG_ID
  if (!clientId || !clientSecret || !orgId) return ''

  const imsCredentials = { clientId, clientSecret, orgId }
  let rawScopes = process.env.IMS_OAUTH_S2S_SCOPES
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

module.exports = { getAioDbToken }
