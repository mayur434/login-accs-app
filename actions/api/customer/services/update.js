const { badRequest, forbidden, notFound, conflict, serverError } = require('../../../../lib/http')
const { getAppConfig } = require('../../../../lib/db')
const { commerceGraphQLRequest, graphQLRequest } = require('../../../../lib/graphql')
const { hasValue } = require('../../../../lib/params')
const {
  normalizeMobile,
  normalizeEmailInput,
  extractCustomerId,
  extractCustomerToken,
  getCommerceMobileValue,
  getSyntheticEmail,
  INTERNAL_CUSTOMER_PASSWORD
} = require('../../../../lib/customer')
const { fetchCustomerProfile, checkCustomerStatus } = require('../../../../lib/commerce')
const { generateOtp } = require('../../../../lib/otpService')

// ── Helpers ─────────────────────────────────────────────────────────────

function isPatternEmail (email) {
  return /^\d+@email\.com$/i.test(String(email || ''))
}

function extractProfileMobile (profile) {
  // Check top-level vs_mobile_number first (Commerce custom attribute)
  if (profile?.vs_mobile_number) return profile.vs_mobile_number
  const attrs = profile?.custom_attributes
  if (!Array.isArray(attrs)) return null
  const mobileAttr = attrs.find((attr) => {
    const code = String(attr?.attribute_code || attr?.code || '').trim()
    return code === 'mobile_number' || code === 'vs_mobile_number'
  })
  return mobileAttr?.value || null
}

function resolveLoginType (email, mobile) {
  if (email && mobile) return 'both'
  if (mobile) return 'mobile'
  if (email) return 'email'
  return null
}

// ── Input preparation ───────────────────────────────────────────────────

function getPreparedInput (params) {
  try {
    const mobileInput = hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null
    const hasMobile = !!mobileInput
    const normalizedMobile = hasMobile ? normalizeMobile(mobileInput) : null

    let emailInput = null
    if (hasValue(params.new_email)) emailInput = params.new_email
    else if (hasValue(params.email)) emailInput = params.email
    const hasEmail = !!emailInput
    const resolvedEmail = hasEmail ? normalizeEmailInput(emailInput) : null

    let firstNameInput = null
    if (hasValue(params.firstname)) firstNameInput = String(params.firstname).trim()
    const hasFirstName = !!firstNameInput

    let lastNameInput = null
    if (hasValue(params.lastname)) lastNameInput = String(params.lastname).trim()
    const hasLastName = !!lastNameInput

    if (!hasMobile && !hasEmail && !hasFirstName && !hasLastName) {
      return { error: badRequest("provide at least one field: 'mobile_number', 'new_email', 'firstname', or 'lastname'") }
    }

    return {
      prepared: {
        hasMobile,
        hasEmail,
        hasFirstName,
        hasLastName,
        normalizedMobile,
        resolvedEmail,
        firstName: firstNameInput,
        lastName: lastNameInput
      }
    }
  } catch (e) {
    return { error: badRequest(e.message || 'invalid input') }
  }
}

// ── Uniqueness checks ───────────────────────────────────────────────────

async function getCustomerStatus (params, email, mobileNumber, logger) {
  const query = `query IsCustomerExists($email: String!, $mobile_number: String!) {
    isCustomerExists(email: $email, mobile_number: $mobile_number) {
      is_customer_exists
      is_disabled
    }
  }`

  const response = await graphQLRequest(params, query, {
    email: email || '',
    mobile_number: mobileNumber || ''
  }, logger)

  return {
    isCustomerExists: !!response?.data?.isCustomerExists?.is_customer_exists,
    isDisabled: !!response?.data?.isCustomerExists?.is_disabled
  }
}

function toConflictFromStatus (status, existsMessage, disabledMessage) {
  if (status.isDisabled) return conflict(disabledMessage)
  if (status.isCustomerExists) return conflict(existsMessage)
  return null
}

async function checkUniqueness (params, prepared, currentEmail, currentMobile, logger) {
  if (prepared.hasMobile && prepared.normalizedMobile !== currentMobile) {
    const mobileStatus = await getCustomerStatus(params, '', prepared.normalizedMobile, logger)
    const mobileConflict = toConflictFromStatus(
      mobileStatus,
      'mobile number already exists',
      'mobile number belongs to a disabled customer'
    )
    if (mobileConflict) return mobileConflict
  }

  if (prepared.hasEmail && prepared.resolvedEmail !== currentEmail) {
    const emailStatus = await getCustomerStatus(params, prepared.resolvedEmail, '', logger)
    const emailConflict = toConflictFromStatus(
      emailStatus,
      'email already exists',
      'email belongs to a disabled customer'
    )
    if (emailConflict) return emailConflict
  }

  if (prepared.hasMobile && !prepared.hasEmail && isPatternEmail(currentEmail)) {
    const newPatternEmail = getSyntheticEmail(prepared.normalizedMobile)
    if (newPatternEmail !== currentEmail) {
      const patternStatus = await getCustomerStatus(params, newPatternEmail, '', logger)
      const patternConflict = toConflictFromStatus(
        patternStatus,
        'email already exists (pattern email conflict for new mobile)',
        'email belongs to a disabled customer'
      )
      if (patternConflict) return patternConflict
    }
  }

  return null
}

// ── Commerce mutations ──────────────────────────────────────────────────

async function updateCommerceProfile (params, customerToken, prepared, currentEmail, logger) {
  const currentIsPattern = isPatternEmail(currentEmail)
  let profileResult = null
  let emailResult = null

  // 1. Profile update FIRST — does NOT invalidate token
  if (prepared.hasMobile || prepared.hasFirstName || prepared.hasLastName) {
    const input = {}
    if (prepared.hasMobile) {
      const mobileValue = getCommerceMobileValue(prepared.normalizedMobile)
      input.vs_mobile_number = mobileValue
      input.custom_attributes = [{ attribute_code: 'mobile_number', value: mobileValue }]
    }
    if (prepared.hasFirstName) input.firstname = prepared.firstName
    if (prepared.hasLastName) input.lastname = prepared.lastName

    const mutation = `
      mutation updateCustomerV2($input: CustomerUpdateInput!) {
        updateCustomerV2(input: $input) {
          customer { id firstname lastname email custom_attributes { code ...on AttributeValue { value } } }
        }
      }
    `
    profileResult = await commerceGraphQLRequest(params, mutation, { input }, logger, customerToken)
  }

  // 2. Email change LAST — INVALIDATES the customer token
  let newCommerceEmail = null
  if (prepared.hasEmail) {
    newCommerceEmail = prepared.resolvedEmail
  } else if (prepared.hasMobile && currentIsPattern) {
    newCommerceEmail = getSyntheticEmail(prepared.normalizedMobile)
  }

  if (newCommerceEmail && newCommerceEmail !== currentEmail) {
    const mutation = `
      mutation UpdateCustomerEmail($email: String!, $password: String!) {
        updateCustomerEmail(email: $email, password: $password) {
          customer { email }
        }
      }
    `
    emailResult = await commerceGraphQLRequest(
      params, mutation,
      { email: newCommerceEmail, password: INTERNAL_CUSTOMER_PASSWORD },
      logger, customerToken
    )
  }

  return {
    newCommerceEmail,
    emailResult: emailResult?.data?.updateCustomerEmail || null,
    profileResult: profileResult?.data?.updateCustomerV2 || null
  }
}

function buildUpdatedCustomerResponse (customerId, currentProfile, prepared, currentEmail, currentMobile) {
  let nextEmail = currentEmail
  if (prepared.hasEmail) {
    nextEmail = prepared.resolvedEmail
  } else if (prepared.hasMobile && isPatternEmail(currentEmail)) {
    nextEmail = getSyntheticEmail(prepared.normalizedMobile)
  }
  const nextMobile = prepared.hasMobile ? prepared.normalizedMobile : currentMobile
  const nextFirstName = prepared.hasFirstName ? prepared.firstName : (currentProfile.firstname || null)
  const nextLastName = prepared.hasLastName ? prepared.lastName : (currentProfile.lastname || null)

  return {
    customer_id: customerId,
    mobile_number: nextMobile,
    email: nextEmail,
    firstname: nextFirstName,
    lastname: nextLastName,
    login_type: resolveLoginType(isPatternEmail(nextEmail) ? null : nextEmail, nextMobile),
    status: 'active'
  }
}

async function runCommerceUpdate (params, customerToken, prepared, currentEmail, logger) {
  try {
    const commerceResult = await updateCommerceProfile(params, customerToken, prepared, currentEmail, logger)
    logger.debug('Commerce update result', commerceResult)
    return null
  } catch (commerceError) {
    logger.error(commerceError)
    return serverError(commerceError.message || 'failed to update in Commerce')
  }
}

// ── Exported handler ────────────────────────────────────────────────────

module.exports = async function update (dbClient, params, logger) {
  try {
    // 1. Get customer_id
    const customerId = extractCustomerId(params)
    if (!customerId) return badRequest('customer_id is required (pass in body or via customer_token)')

    // 2. customer_token is required for Commerce mutations
    const customerToken = extractCustomerToken(params)
    if (!customerToken) return badRequest('customer_token is required')

    // 3. Parse input — email/mobile/name fields
    const { error, prepared } = getPreparedInput(params)
    if (error) return error

    // 4. Check admin config — fail fast before expensive Commerce calls
    const appConfig = await getAppConfig(dbClient)
    if (!appConfig.allow_key_info_update) {
      if (prepared.hasMobile) return forbidden('mobile number updates are disabled')
    }

    // 5. Precheck: uniqueness of new email/mobile BEFORE fetching profile
    if (prepared.hasEmail || prepared.hasMobile) {
      const status = await checkCustomerStatus(params, prepared.resolvedEmail, prepared.normalizedMobile, logger)
      if (status.isCustomerExists) return conflict('email or mobile already registered to another account')
    }

    // 6. Look up current Commerce profile
    const currentProfile = await fetchCustomerProfile(params, customerToken, logger)
    if (!currentProfile) return notFound('customer not found in Commerce')

    const currentEmail = currentProfile.email || null
    const currentMobile = extractProfileMobile(currentProfile)

    // allow_key_info_update gate: check email restriction (needs profile to determine synthetic)
    if (!appConfig.allow_key_info_update) {
      const isSyntheticEmail = isPatternEmail(currentEmail)
      if (prepared.hasEmail && !isSyntheticEmail) return forbidden('email updates are disabled')
    }

    // 7. If email or mobile is being changed → require OTP verification on new identifier
    if (prepared.hasEmail || prepared.hasMobile) {
      const otpTarget = prepared.hasEmail ? prepared.resolvedEmail : prepared.normalizedMobile
      const loginType = prepared.hasEmail ? 'email' : 'mobile'

      const result = await generateOtp(dbClient, {
        flowType: 'update',
        loginType,
        mobile: prepared.hasMobile ? prepared.normalizedMobile : (currentMobile || null),
        email: prepared.hasEmail ? prepared.resolvedEmail : (currentEmail || null),
        firstname: prepared.hasFirstName ? prepared.firstName : (currentProfile.firstname || null),
        lastname: prepared.hasLastName ? prepared.lastName : (currentProfile.lastname || null),
        customer_id: customerId,
        customer_token: customerToken,
        // Store pending changes for validate-otp to apply
        pending_email: prepared.hasEmail ? prepared.resolvedEmail : null,
        pending_mobile: prepared.hasMobile ? prepared.normalizedMobile : null,
        pending_firstname: prepared.hasFirstName ? prepared.firstName : null,
        pending_lastname: prepared.hasLastName ? prepared.lastName : null,
        is_customer_exists: true,
        is_disabled: false
      }, logger, appConfig)

      return {
        statusCode: 200,
        body: {
          success: true,
          message: `OTP sent to ${otpTarget} for verification`,
          otpReferenceId: result.otpReferenceId,
          otpValue: result.otpValue || undefined
        }
      }
    }

    // 8. Name-only update — no OTP needed, update directly
    if (prepared.hasFirstName || prepared.hasLastName) {
      const input = {}
      if (prepared.hasFirstName) input.firstname = prepared.firstName
      if (prepared.hasLastName) input.lastname = prepared.lastName

      const mutation = `
        mutation updateCustomerV2($input: CustomerUpdateInput!) {
          updateCustomerV2(input: $input) {
            customer { id firstname lastname email }
          }
        }
      `
      await commerceGraphQLRequest(params, mutation, { input }, logger, customerToken)

      const updatedCustomer = buildUpdatedCustomerResponse(customerId, currentProfile, prepared, currentEmail, currentMobile)
      return { statusCode: 200, body: { success: true, customer: updatedCustomer } }
    }

    return badRequest('no changes to apply')
  } catch (error) {
    logger.error(error)
    return serverError(error.message || 'server error')
  }
}
