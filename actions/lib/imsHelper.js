// imsHelper.js
// Helper to get IMS token for DB access, supporting localhost (dev) and production

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient

/**
 * Get IMS token for DB access
 * @param {object} headers - HTTP headers (from __ow_headers)
 * @returns {Promise<string>} - IMS access token
 */
async function getAioDbToken(headers = {}) {
  const host = headers.host || headers.origin || ''
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')

  if (isLocalhost) {
    // Use .env credentials and generate token
    const imsCredentials = {
      clientId: process.env.IMS_OAUTH_S2S_CLIENT_ID,
      clientSecret: process.env.IMS_OAUTH_S2S_CLIENT_SECRET,
      orgId: process.env.IMS_OAUTH_S2S_ORG_ID,
      scopes: process.env.IMS_OAUTH_S2S_SCOPES
    }
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
  } else {
    // Fetch IMS token from header (e.g., authorization or x-ims-token)
    return headers['authorization']
      ? headers['authorization'].replace(/^Bearer\s+/i, '')
      : headers['x-ims-token'] || ''
  }
}

module.exports = { getAioDbToken }
