const { badRequest, unauthorized, forbidden, notFound, conflict, serverError } = require('../../lib/http')
const { findOneOrNull, isUniqueConstraintError, getAppConfig } = require('../../lib/db')
const { graphQLRequest } = require('../../lib/graphql')
const { hasValue } = require('../../lib/params')
const {
  normalizeMobile,
  normalizeEmailInput,
  extractCustomerId,
  extractCustomerToken,
  getCommerceMobileValue,
  buildLoginType,
  CUSTOMER_IDENTITY_COLLECTION,
  INTERNAL_CUSTOMER_PASSWORD
} = require('../../lib/customer')

// ── Input preparation ───────────────────────────────────────────────────

function getPreparedInput(params) {
  try {
    const mobileInput = hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null
    const hasMobile = !!mobileInput
    const normalizedMobile = hasMobile ? normalizeMobile(mobileInput) : null

    const hasEmail = hasValue(params.new_email)
    const resolvedEmail = hasEmail ? normalizeEmailInput(params.new_email) : null
    const password = hasEmail ? INTERNAL_CUSTOMER_PASSWORD : null

    const firstName = hasValue(params.firstName) ? String(params.firstName).trim()
      : (hasValue(params.firstname) ? String(params.firstname).trim() : null)
    const lastName = hasValue(params.lastName) ? String(params.lastName).trim()
      : (hasValue(params.lastname) ? String(params.lastname).trim() : null)

    if (!hasMobile && !hasEmail && !firstName && !lastName) {
      return { error: badRequest("provide at least one field: 'mobile_number', 'new_email', 'firstName', 'lastName'") }
    }

    if (hasEmail && !password) {
      return { error: badRequest("missing parameter(s) 'password' for email update") }
    }

    return { prepared: { hasMobile, hasEmail, normalizedMobile, resolvedEmail, password, firstName, lastName } }
  } catch (e) {
    return { error: badRequest(e.message || 'invalid input') }
  }
}

// ── Conflict checks ────────────────────────────────────────────────────

async function checkConflicts(collection, customerId, prepared) {
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
  return null
}

// ── Commerce update ─────────────────────────────────────────────────────

function isUnauthorizedCommerceError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes("current customer isn't authorized") || msg.includes('not authorized')
}

async function updateCommerceProfile(params, prepared, logger) {
  const customerToken = extractCustomerToken(params)
  logger.info('customerToken resolved:', customerToken ? `${customerToken.substring(0, 10)}...` : 'NULL/UNDEFINED')
  if (!customerToken) {
    throw new Error('customer token is required for Commerce profile update')
  }

  let emailResult = null
  let profileResult = null

  if (prepared.hasEmail) {
    const mutation = `
      mutation UpdateCustomerEmail($email: String!, $password: String!) {
        updateCustomerEmail(email: $email, password: $password) {
          customer { email }
        }
      }
    `
    emailResult = await graphQLRequest(params, mutation, { email: prepared.resolvedEmail, password: prepared.password }, logger, customerToken)
  }

  const hasProfileUpdate = prepared.hasMobile || !!prepared.firstName || !!prepared.lastName
  if (hasProfileUpdate) {
    const input = {}
    if (prepared.firstName) input.firstname = prepared.firstName
    if (prepared.lastName) input.lastname = prepared.lastName
    if (prepared.hasMobile) {
      input.custom_attributes = [{ attribute_code: 'mobile_number', value: getCommerceMobileValue(prepared.normalizedMobile) }]
    }

    const mutation = `
      mutation updateCustomerV2($input: CustomerUpdateInput!) {
        updateCustomerV2(input: $input) {
          customer {
            id firstname lastname email
            custom_attributes { code ...on AttributeValue { value } }
          }
        }
      }
    `
    profileResult = await graphQLRequest(params, mutation, { input }, logger, customerToken)
  }

  return {
    updateCustomerEmail: emailResult?.data?.updateCustomerEmail || null,
    updateCustomerV2: profileResult?.data?.updateCustomerV2 || null
  }
}

// ── Exported handler ────────────────────────────────────────────────────

module.exports = async function update(dbClient, params, logger) {
  try {
    const customerId = extractCustomerId(params)
    if (!customerId) return badRequest('authenticated customer_id not found in request context')

    const { error, prepared } = getPreparedInput(params)
    if (error) return error

    const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)

    const appConfig = await getAppConfig(dbClient)
    if (!appConfig.allow_key_info_update) return forbidden('key info updates are disabled')

    const conflictError = await checkConflicts(collection, customerId, prepared)
    if (conflictError) return conflictError

    const customerRecord = await findOneOrNull(collection, { customer_id: customerId })
    if (!customerRecord) return notFound('customer record not found')

    const previousState = {
      email: customerRecord.email || null,
      mobile_number: customerRecord.mobile_number || null,
      firstname: customerRecord.firstname || null,
      lastname: customerRecord.lastname || null,
      login_type: customerRecord.login_type || null
    }

    // Update identity document
    const nextEmail = prepared.hasEmail ? prepared.resolvedEmail : customerRecord.email || null
    const nextMobile = prepared.hasMobile ? prepared.normalizedMobile : customerRecord.mobile_number || null

    try {
      await collection.updateOne(
        { customer_id: customerId },
        {
          $set: {
            ...(prepared.hasEmail ? { email: prepared.resolvedEmail } : {}),
            ...(prepared.hasMobile ? { mobile_number: prepared.normalizedMobile } : {}),
            ...(prepared.firstName ? { firstname: prepared.firstName } : {}),
            ...(prepared.lastName ? { lastname: prepared.lastName } : {}),
            login_type: buildLoginType(nextEmail, nextMobile),
            updated_at: new Date()
          }
        }
      )
    } catch (updateError) {
      if (isUniqueConstraintError(updateError)) return conflict('email or mobile number already exists')
      throw updateError
    }

    // Sync to Commerce — rollback DB on failure
    try {
      const commerce = await updateCommerceProfile(params, prepared, logger)
      const updatedFirstname = commerce.updateCustomerV2?.customer?.firstname || prepared.firstName || customerRecord.firstname || null
      const updatedLastname = commerce.updateCustomerV2?.customer?.lastname || prepared.lastName || customerRecord.lastname || null

      return {
        statusCode: 200,
        body: {
          success: true,
          customer: {
            customer_id: customerId,
            mobile_number: nextMobile,
            email: nextEmail,
            firstname: updatedFirstname,
            lastname: updatedLastname
          }
        }
      }
    } catch (commerceError) {
      await collection.updateOne(
        { customer_id: customerId },
        {
          $set: {
            email: previousState.email,
            mobile_number: previousState.mobile_number,
            firstname: previousState.firstname,
            lastname: previousState.lastname,
            login_type: previousState.login_type,
            updated_at: new Date()
          }
        }
      )
      if (isUnauthorizedCommerceError(commerceError)) {
        return unauthorized('customer token is required/invalid for key info update')
      }
      logger.error(commerceError)
      return serverError(commerceError.message || 'failed to update key info in commerce')
    }
  } catch (error) {
    logger.error(error)
    return serverError(error.message || 'server error')
  }
}
