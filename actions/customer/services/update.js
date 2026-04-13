const { badRequest, forbidden, notFound, conflict, serverError } = require('../../lib/http')
const { findOneOrNull, isUniqueConstraintError, getAppConfig } = require('../../lib/db')
const { commerceGraphQLRequest } = require('../../lib/graphql')
const { hasValue } = require('../../lib/params')
const {
  normalizeMobile,
  normalizeEmailInput,
  extractCustomerId,
  getCommerceMobileValue,
  getSyntheticEmail,
  CUSTOMER_IDENTITY_COLLECTION,
  INTERNAL_CUSTOMER_PASSWORD
} = require('../../lib/customer')

// ── Helpers ─────────────────────────────────────────────────────────────

function isPatternEmail (email) {
  return /^\d+@email\.com$/i.test(String(email || ''))
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

async function checkUniqueness (collection, customerId, prepared, currentEmail) {
  if (prepared.hasMobile) {
    const existing = await findOneOrNull(collection, { mobile_number: prepared.normalizedMobile })
    if (existing && Number(existing.customer_id) !== customerId) {
      return conflict('mobile number already exists')
    }
  }
  if (prepared.hasEmail) {
    const existing = await findOneOrNull(collection, { email: prepared.resolvedEmail })
    if (existing && Number(existing.customer_id) !== customerId) {
      return conflict('email already exists')
    }
  }
  if (prepared.hasMobile && !prepared.hasEmail && isPatternEmail(currentEmail)) {
    const newPatternEmail = getSyntheticEmail(prepared.normalizedMobile)
    const existing = await findOneOrNull(collection, { email: newPatternEmail })
    if (existing && Number(existing.customer_id) !== customerId) {
      return conflict('email already exists (pattern email conflict for new mobile)')
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
      input.custom_attributes = [{ attribute_code: 'mobile_number', value: getCommerceMobileValue(prepared.normalizedMobile) }]
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

function buildDbUpdatePayload (prepared, currentEmail) {
  const dbUpdate = {}
  if (prepared.hasMobile) dbUpdate.mobile_number = prepared.normalizedMobile
  if (prepared.hasEmail) {
    dbUpdate.email = prepared.resolvedEmail
  } else if (prepared.hasMobile && isPatternEmail(currentEmail)) {
    dbUpdate.email = getSyntheticEmail(prepared.normalizedMobile)
  }
  if (prepared.hasFirstName) dbUpdate.firstname = prepared.firstName
  if (prepared.hasLastName) dbUpdate.lastname = prepared.lastName
  dbUpdate.updated_at = new Date()
  return dbUpdate
}

function buildUpdatedCustomerResponse (customerId, customerRecord, prepared, dbUpdate, currentEmail) {
  const nextEmail = dbUpdate.email || currentEmail
  const nextMobile = prepared.hasMobile ? prepared.normalizedMobile : (customerRecord.mobile_number || null)
  const nextFirstName = prepared.hasFirstName ? prepared.firstName : (customerRecord.firstname || null)
  const nextLastName = prepared.hasLastName ? prepared.lastName : (customerRecord.lastname || null)

  return {
    customer_id: customerId,
    mobile_number: nextMobile,
    email: nextEmail,
    firstname: nextFirstName,
    lastname: nextLastName,
    login_type: customerRecord.login_type || null,
    status: customerRecord.status || 'active'
  }
}

async function applyIdentityUpdate (collection, customerId, dbUpdate) {
  try {
    await collection.updateOne(
      { customer_id: customerId },
      { $set: dbUpdate }
    )
  } catch (updateError) {
    if (isUniqueConstraintError(updateError)) return conflict('email or mobile number already exists')
    throw updateError
  }
  return null
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

    // 5. Look up existing identity record
    const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)
    const customerRecord = await findOneOrNull(collection, { customer_id: customerId })
    if (!customerRecord) return notFound('customer identity not found')

    const currentEmail = customerRecord.email || null

    // 6. Check uniqueness in identity table
    const conflictError = await checkUniqueness(collection, customerId, prepared, currentEmail)
    if (conflictError) return conflictError

    // 7. Update Commerce — mobile FIRST, email LAST (email change revokes token)
    const commerceError = await runCommerceUpdate(params, customerToken, prepared, currentEmail, logger)
    if (commerceError) return commerceError

    // 8. Commerce succeeded → update App Builder DB (DocDB / MySQL)
    const dbUpdate = buildDbUpdatePayload(prepared, currentEmail)
    const dbConflict = await applyIdentityUpdate(collection, customerId, dbUpdate)
    if (dbConflict) return dbConflict

    const updatedCustomer = buildUpdatedCustomerResponse(customerId, customerRecord, prepared, dbUpdate, currentEmail)

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
