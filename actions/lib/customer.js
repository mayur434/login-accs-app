/**
 * Shared customer-identity helpers.
 */

const { normalizeMobile } = require('../utils')

const INTERNAL_CUSTOMER_PASSWORD = 'pass@123'
const CUSTOMER_IDENTITY_COLLECTION = 'customer_mobile_identity'

// ── ID parsing ──────────────────────────────────────────────────────────

function parseCustomerIdValue (value) {
  if (value === undefined || value === null || value === '') return null

  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }

  const text = String(value).trim()
  if (!text) return null

  const direct = Number(text)
  if (!Number.isNaN(direct) && direct > 0) return direct

  // Base-64 encoded id (e.g. Commerce GraphQL uid)
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim()
    const decodedNum = Number(decoded)
    if (!Number.isNaN(decodedNum) && decodedNum > 0) return decodedNum

    const trailing = decoded.match(/(\d+)$/)
    if (trailing) {
      const n = Number(trailing[1])
      if (!Number.isNaN(n) && n > 0) return n
    }
  } catch { /* ignore */ }

  // Trailing digits in raw value
  const trailingRaw = text.match(/(\d+)$/)
  if (trailingRaw) {
    const n = Number(trailingRaw[1])
    if (!Number.isNaN(n) && n > 0) return n
  }

  return null
}

function getCustomerId (createCustomerResponse) {
  const customer =
    createCustomerResponse?.data?.createCustomerV2?.customer ||
    createCustomerResponse?.data?.createCustomerWrapper?.customer
  if (!customer) return null

  for (const key of ['id', 'customer_id', 'customerId', 'entity_id', 'entityId', 'uid']) {
    const parsed = parseCustomerIdValue(customer[key])
    if (parsed) return parsed
  }
  return null
}

function parseCustomerIdFromToken (token) {
  if (!token || typeof token !== 'string') return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null

    const b64 = parts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=')

    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))

    for (const key of ['customer_id', 'customerId', 'user_id', 'uid', 'sub']) {
      const parsed = parseCustomerIdValue(payload[key])
      if (parsed) return parsed
    }
  } catch { /* ignore */ }

  return null
}

// ── Extraction from request params ──────────────────────────────────────

function extractCustomerId (params) {
  const candidates = [
    params.context?.customer_id,
    params.context?.customerId,
    params.customer_id,
    params.customerId,
    params.id,
    params.__ow_headers?.['x-customer-id'],
    params.__ow_headers?.['x-customerid']
  ]
  for (const c of candidates) {
    const parsed = parseCustomerIdValue(c)
    if (parsed) return parsed
  }
  return null
}

function extractCustomerToken (params) {
  const fromParams = params.customer_token || params.customerToken || params.token
  if (fromParams) return String(fromParams).trim()

  const auth = params.__ow_headers?.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.substring('Bearer '.length).trim()
  }
  return null
}

function extractBearerToken (params) {
  const h = params?.__ow_headers || {}
  const auth = h.authorization || h.Authorization || params.authorization || params.Authorization || ''
  const s = String(auth).trim()
  return s.toLowerCase().startsWith('bearer ') ? s.slice(7).trim() : (s || null)
}

// ── Mobile / email helpers ──────────────────────────────────────────────

function getSyntheticEmail (normalizedMobile) {
  return `${normalizedMobile.replaceAll(/\D/g, '')}@email.com`
}

function getCommerceMobileValue (mobileNumber) {
  if (!mobileNumber) return null
  const digits = String(mobileNumber).replaceAll(/\D/g, '')
  if (!digits) return null
  return digits.length > 10 ? digits.slice(-10) : digits
}

function buildLoginType (hasEmail, hasMobile) {
  if (hasEmail && hasMobile) return 'both'
  if (hasEmail) return 'email'
  if (hasMobile) return 'mobile'
  return null
}

function normalizeEmailInput (email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) throw new Error('invalid email')
  return normalized
}

module.exports = {
  INTERNAL_CUSTOMER_PASSWORD,
  CUSTOMER_IDENTITY_COLLECTION,
  parseCustomerIdValue,
  getCustomerId,
  parseCustomerIdFromToken,
  extractCustomerId,
  extractCustomerToken,
  extractBearerToken,
  getSyntheticEmail,
  getCommerceMobileValue,
  buildLoginType,
  normalizeEmailInput,
  normalizeMobile
}
