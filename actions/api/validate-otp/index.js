/**
 * validateOtpAction
 *
 * Public endpoint: POST /validate-otp
 *
 * Accepts { otpReferenceId, otpValue }.
 * Validates the OTP, then based on the stored flowType:
 *   - 'login'    → look up user, generate Commerce token, return token
 *   - 'register' → create Commerce user, generate token, return token
 */

const { runAction } = require('../../../lib/actionRunner')
const { errorResponse } = require('../../../lib/http')
const { graphQLRequest, commerceGraphQLRequest } = require('../../../lib/graphql')
const {
  INTERNAL_CUSTOMER_PASSWORD,
  normalizeMobile,
  getSyntheticEmail,
  getCommerceMobileValue,
  parseCustomerIdFromToken
} = require('../../../lib/customer')
const { validateOtp } = require('../../../lib/otpService')
const { fetchCustomerProfile } = require('../../../lib/commerce')

// ── Commerce helpers ────────────────────────────────────────────────────

async function tryLogin (email, params, logger) {
  const mutation = `mutation generateCustomerToken($email: String!, $password: String!){ generateCustomerToken(email: $email, password: $password){ token } }`
  try {
    const resp = await graphQLRequest(params, mutation, { email, password: INTERNAL_CUSTOMER_PASSWORD }, logger)
    if (resp?.data?.generateCustomerToken?.token) return resp.data.generateCustomerToken.token
  } catch (e) {
    logger.debug?.('generateCustomerToken failed: ' + e.message)
  }
  return null
}

async function createUser (email, mobile, opts, params, logger) {
  const firstname = opts.firstname || 'Guest'
  const lastname = opts.lastname || 'User'
  const input = { firstname, lastname, email, password: INTERNAL_CUSTOMER_PASSWORD }

  if (mobile) {
    try {
      const mobileValue = getCommerceMobileValue(normalizeMobile(mobile))
      if (mobileValue) {
        input.vs_mobile_number = mobileValue
        input.custom_attributes = [{ attribute_code: 'mobile_number', value: mobileValue }]
      }
    } catch (err) {
      logger.debug?.('Skipping mobile attribute: ' + err.message)
    }
  }

  const mutation = `mutation createCustomerV2($input: CustomerCreateInput!){ createCustomerV2(input: $input){ customer{ id firstname lastname email } } }`
  return graphQLRequest(params, mutation, { input }, logger)
}

function extractCreateCustomerErrorMessage (err) {
  const message = String(err?.message || '').toLowerCase()
  if (message.includes('already exists')) return 'customer already exists in Commerce'
  if (message.includes('is invalid')) return 'invalid customer details for Commerce registration'
  return err?.message || 'customer creation failed in Commerce'
}

function resolveNormalizedMobile (value) {
  if (!value) return null
  try { return normalizeMobile(value) } catch { return value }
}

function extractProfileMobile (profile) {
  if (profile?.vs_mobile_number) return profile.vs_mobile_number
  const attrs = profile?.custom_attributes
  if (!Array.isArray(attrs)) return null
  const mobileAttr = attrs.find(a => {
    const code = String(a?.attribute_code || '').trim()
    return code === 'mobile_number' || code === 'vs_mobile_number'
  })
  return mobileAttr?.value || null
}

function toCustomerResponse (profile, record, fallbackEmail, createdCustomer = null, token = null) {
  let customerId = null
  const profileOrCreateId = profile?.id ?? createdCustomer?.id
  if (profileOrCreateId !== undefined && profileOrCreateId !== null && profileOrCreateId !== '') {
    const parsed = Number(profileOrCreateId)
    customerId = Number.isNaN(parsed) ? profileOrCreateId : parsed
  }
  // Fall back to extracting customer_id from JWT token
  if (!customerId && token) {
    customerId = parseCustomerIdFromToken(token)
  }

  const normalizedMobile = resolveNormalizedMobile(record?.mobile) || extractProfileMobile(profile) || null
  const email = profile?.email || createdCustomer?.email || fallbackEmail || null

  return {
    customer_id: customerId,
    firstname: profile?.firstname || createdCustomer?.firstname || record?.firstname || null,
    lastname: profile?.lastname || createdCustomer?.lastname || record?.lastname || null,
    email,
    mobile_number: normalizedMobile,
    login_type: record?.loginType || (email && normalizedMobile ? 'both' : normalizedMobile ? 'mobile' : 'email')
  }
}

function resolveEmail (record, logger) {
  if (record.loginType === 'mobile') {
    if (!record.mobile) throw Object.assign(new Error('mobile not present in OTP record'), { statusCode: 400 })
    let normalizedMobile = record.mobile
    try { normalizedMobile = normalizeMobile(record.mobile) } catch {}
    const email = record.email || getSyntheticEmail(normalizedMobile)
    return email
  }
  return record.email
}

// ── Main action ─────────────────────────────────────────────────────────

exports.main = runAction('validateOtp', 'otps', async ({ params, dbClient, logger }) => {
  if (!params.otpReferenceId || !params.otpValue) {
    return errorResponse(400, "missing parameter(s) 'otpReferenceId' and 'otpValue'", logger)
  }
  if (!/^otp_\d+_\d+$/.test(String(params.otpReferenceId))) {
    return errorResponse(400, 'invalid otpReferenceId format', logger)
  }
  if (!/^\d{4,8}$/.test(String(params.otpValue).trim())) {
    return errorResponse(400, 'invalid otpValue format', logger)
  }

  const record = await validateOtp(dbClient, params.otpReferenceId, params.otpValue, logger)

  if (record.is_disabled) {
    return errorResponse(403, 'Your account is disabled. Please contact support.', logger)
  }

  const emailToUse = resolveEmail(record, logger)

  if (record.flowType === 'login') {
    const token = await tryLogin(emailToUse, params, logger)
    if (!token) return errorResponse(404, 'user not found in Commerce', logger)

    return {
      statusCode: 200,
      body: { success: true, customer_token: token, message: 'login successful', customer: toCustomerResponse(null, record, emailToUse, null, token) }
    }
  }

  // ── flowType: update — apply pending email/mobile changes to Commerce ──
  if (record.flowType === 'update') {
    const customerToken = record.customer_token
    if (!customerToken) return errorResponse(500, 'update failed: missing customer_token in OTP record', logger)

    const input = {}
    if (record.pending_mobile) {
      const mobileValue = getCommerceMobileValue(record.pending_mobile)
      input.vs_mobile_number = mobileValue
      input.custom_attributes = [{ attribute_code: 'mobile_number', value: mobileValue }]
    }
    if (record.pending_firstname) input.firstname = record.pending_firstname
    if (record.pending_lastname) input.lastname = record.pending_lastname

    // Update profile (mobile/name) if any fields present
    if (Object.keys(input).length > 0) {
      const profileMutation = `mutation updateCustomerV2($input: CustomerUpdateInput!) { updateCustomerV2(input: $input) { customer { id firstname lastname email vs_mobile_number } } }`
      await commerceGraphQLRequest(params, profileMutation, { input }, logger, customerToken)
    }

    // Update email separately (revokes old token)
    let newToken = customerToken
    if (record.pending_email) {
      const emailMutation = `mutation UpdateCustomerEmail($email: String!, $password: String!) { updateCustomerEmail(email: $email, password: $password) { customer { email } } }`
      await commerceGraphQLRequest(params, emailMutation, { email: record.pending_email, password: INTERNAL_CUSTOMER_PASSWORD }, logger, customerToken)
      // Email change revokes token — generate new one
      newToken = await tryLogin(record.pending_email, params, logger)
      if (!newToken) newToken = customerToken
    }

    const customerId = record.customer_id || parseCustomerIdFromToken(customerToken)
    return {
      statusCode: 200,
      body: {
        success: true,
        customer_token: newToken,
        message: 'profile updated successfully',
        customer: {
          customer_id: customerId,
          email: record.pending_email || record.email || emailToUse,
          mobile_number: record.pending_mobile || record.mobile || null,
          firstname: record.pending_firstname || record.firstname || null,
          lastname: record.pending_lastname || record.lastname || null,
          login_type: (record.pending_email || record.email) && (record.pending_mobile || record.mobile) ? 'both' : (record.pending_mobile || record.mobile) ? 'mobile' : 'email',
          status: 'active'
        }
      }
    }
  }

  // flowType: register — use pre-checked flag from generate-otp
  if (record.is_customer_exists) {
    // User already exists (auto_register re-login) — skip createUser, go straight to login
    const token = await tryLogin(emailToUse, params, logger)
    if (!token) return errorResponse(404, 'user not found in Commerce', logger)

    return {
      statusCode: 200,
      body: { success: true, customer_token: token, message: 'login successful', customer: toCustomerResponse(null, record, emailToUse, null, token) }
    }
  }

  // New user — create then login
  let createdCustomer = null
  try {
    const createResp = await createUser(emailToUse, record.mobile, record, params, logger)
    createdCustomer = createResp?.data?.createCustomerV2?.customer || null
  } catch (createErr) {
    const msg = extractCreateCustomerErrorMessage(createErr)
    if (!msg.includes('already exists')) {
      return errorResponse(500, `registration failed: ${msg}`, logger)
    }
  }

  let token = await tryLogin(emailToUse, params, logger)
  // Retry once — Commerce may have propagation delay after createCustomerV2
  if (!token) {
    await new Promise(r => setTimeout(r, Number(process.env.TOKEN_RETRY_DELAY_MS) || 1000))
    token = await tryLogin(emailToUse, params, logger)
  }
  if (!token) return errorResponse(500, 'registration failed: customer created but token generation failed', logger)

  return {
    statusCode: 200,
    body: { success: true, customer_token: token, message: 'registration successful', customer: toCustomerResponse(null, record, emailToUse, createdCustomer) }
  }
})
