const { badRequest, forbidden, notFound, conflict, serverError } = require('../../lib/http')
const { getAppConfig } = require('../../lib/db')
const { commerceGraphQLRequest, graphQLRequest } = require('../../lib/graphql')
const { hasValue } = require('../../lib/params')
const {
  normalizeMobile,
  normalizeEmailInput,
  extractCustomerId,
  getCommerceMobileValue,
  getSyntheticEmail,
  INTERNAL_CUSTOMER_PASSWORD
} = require('../../lib/customer')
const { fetchCustomerProfile } = require('../../lib/commerce')

// ── Helpers ─────────────────────────────────────────────────────────────

function isPatternEmail (email) {
  return /^\d+@email\.com$/i.test(String(email || ''))
}

function extractProfileMobile (profile) {
  const attrs = profile?.custom_attributes
  if (!Array.isArray(attrs)) return null
  const mobileAttr = attrs.find((attr) => String(attr?.attribute_code || attr?.code || '').trim() === 'mobile_number')
  return mobileAttr?.value ? normalizeMobile(String(mobileAttr.value)) : null
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

    const dobInput = hasValue(params.dob) ? String(params.dob).trim() : null
    const doaInput = hasValue(params.doa) ? String(params.doa).trim() : null
    const genderInput = hasValue(params.gender) ? String(params.gender).trim() : null
                                                                                  
    if (!hasMobile && !hasEmail && !hasFirstName && !hasLastName && !dobInput && !doaInput && !genderInput) {
      return { error: badRequest("provide at least one field: 'mobile_number', 'new_email', 'firstname', 'lastname', 'dob', 'doa', or 'gender'") }
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
        lastName: lastNameInput,
        dob: dobInput,
        doa: doaInput,
        gender: genderInput
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
  if (prepared.hasMobile || prepared.hasFirstName || prepared.hasLastName || prepared.dob || prepared.doa || prepared.gender) {
    const input = {}
    if (prepared.hasMobile) {
      input.custom_attributes = [{ attribute_code: 'mobile_number', value: getCommerceMobileValue(prepared.normalizedMobile) }]
    }
    if (prepared.hasFirstName) input.firstname = prepared.firstName
    if (prepared.hasLastName) input.lastname = prepared.lastName
    if (prepared.dob) input.dob = prepared.dob
    if (prepared.doa) input.doa = prepared.doa
    if (prepared.gender) input.gender = prepared.gender

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
    mobile_number: nextMobile ? nextMobile.replace(/^\+91/, '') : null,
    email: nextEmail,
    firstname: nextFirstName,
    lastname: nextLastName,
    login_type: resolveLoginType(nextEmail, nextMobile),
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
    const customerToken = params.customer_token || params.customerToken || params.token
    if (!customerToken) return badRequest('customer_token is required')

    // 3. Parse input — email/mobile/name fields
    const { error, prepared } = getPreparedInput(params)
    if (error) return error

    // 4. Check admin config
    const appConfig = await getAppConfig(dbClient)
    if (!appConfig.allow_key_info_update) return forbidden('key info updates are disabled')

    // 5. Look up current Commerce profile
    const currentProfile = await fetchCustomerProfile(params, customerToken, logger)
    if (!currentProfile) return notFound('customer not found in Commerce')

    const currentEmail = currentProfile.email || null
    const currentMobile = extractProfileMobile(currentProfile)

    // 6. Check uniqueness with GraphQL customer existence query
    const conflictError = await checkUniqueness(params, prepared, currentEmail, currentMobile, logger)
    if (conflictError) return conflictError

    // 7. Update Commerce — mobile FIRST, email LAST (email change revokes token)
    const commerceError = await runCommerceUpdate(params, customerToken, prepared, currentEmail, logger)
    if (commerceError) return commerceError

    const updatedCustomer = buildUpdatedCustomerResponse(customerId, currentProfile, prepared, currentEmail, currentMobile)

    return {
      statusCode: 200,
      body: {
        success: true,
        customer: updatedCustomer
      }
    }
  } catch (error) {
    logger.error(error)
    return serverError(error.message || 'server error')
  }
}
