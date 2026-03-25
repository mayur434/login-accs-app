const { badRequest, conflict, serverError } = require('../../lib/http')
const { findOneOrNull, isUniqueConstraintError } = require('../../lib/db')
const { graphQLRequest } = require('../../lib/graphql')
const { hasValue } = require('../../lib/params')
const {
  normalizeMobile,
  getCustomerId,
  parseCustomerIdFromToken,
  getSyntheticEmail,
  getCommerceMobileValue,
  buildLoginType,
  CUSTOMER_IDENTITY_COLLECTION
} = require('../../lib/customer')
const { generateCustomerToken } = require('../../lib/commerce')

// ── Input validation ────────────────────────────────────────────────────

function validateAndPrepare (params) {
  const hasEmail = hasValue(params.email)
  const hasMobile = hasValue(params.mobile_number)
  const hasPassword = hasValue(params.password)

  if (!hasPassword) return { error: badRequest("missing parameter(s) 'password'") }
  if (!hasEmail && !hasMobile) return { error: badRequest("missing parameter(s) 'email,mobile_number'") }

  let normalizedMobile = null
  if (hasMobile) {
    try {
      normalizedMobile = normalizeMobile(params.mobile_number)
    } catch (e) {
      return { error: badRequest(e.message || 'invalid mobile number') }
    }
  }

  const loginType = buildLoginType(hasEmail, hasMobile)
  const resolvedEmail = hasEmail
    ? String(params.email).trim().toLowerCase()
    : getSyntheticEmail(normalizedMobile)

  return {
    prepared: { resolvedEmail, normalizedMobile, loginType, password: String(params.password) }
  }
}

// ── Commerce: create customer + generate token in single mutation ────────

async function createCommerceCustomerAndToken (params, prepared, logger) {
  const firstname = params.firstname || params.firstName || prepared.resolvedEmail.split('@')[0] || 'Customer'
  const lastname = params.lastname || params.lastName || 'User'
  const commerceMobile = getCommerceMobileValue(prepared.normalizedMobile)

  const mutation = commerceMobile
    ? `mutation CreateAndLogin(
        $firstname: String!, $lastname: String!, $email: String!, $password: String!, $mobile: String!
      ) {
        createCustomerWrapper: createCustomerV2(input: {
          firstname: $firstname, lastname: $lastname, email: $email, password: $password,
          custom_attributes: [{ attribute_code: "mobile_number", value: $mobile }]
        }) { customer { id firstname lastname email } }
        generateCustomerToken: generateCustomerToken(email: $email, password: $password) { token }
      }`
    : `mutation CreateAndLogin(
        $firstname: String!, $lastname: String!, $email: String!, $password: String!
      ) {
        createCustomerWrapper: createCustomerV2(input: {
          firstname: $firstname, lastname: $lastname, email: $email, password: $password
        }) { customer { id firstname lastname email } }
        generateCustomerToken: generateCustomerToken(email: $email, password: $password) { token }
      }`

  const variables = commerceMobile
    ? { firstname, lastname, email: prepared.resolvedEmail, password: prepared.password, mobile: commerceMobile }
    : { firstname, lastname, email: prepared.resolvedEmail, password: prepared.password }

  return graphQLRequest(params, mutation, variables, logger)
}

// ── Customer ID resolution ──────────────────────────────────────────────

async function resolveCustomerId (params, createResponse, prepared, logger) {
  const idFromCreate = getCustomerId(createResponse)
  if (idFromCreate) return idFromCreate

  const token = await generateCustomerToken(params, prepared.resolvedEmail, prepared.password, logger)
  return parseCustomerIdFromToken(token)
}

// ── Exported handler ────────────────────────────────────────────────────

module.exports = async function register (dbClient, params, logger) {
  try {
    const { error, prepared } = validateAndPrepare(params)
    if (error) return error

    const collection = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)

    // Check for existing identity
    const byMobile = prepared.normalizedMobile
      ? await findOneOrNull(collection, { mobile_number: prepared.normalizedMobile, status: 'active' })
      : null
    if (byMobile) return conflict('mobile_number already exists')

    const byEmail = await findOneOrNull(collection, { email: prepared.resolvedEmail, status: 'active' })
    if (byEmail) return conflict('email already exists')

    // log request email, and db email
    logger.debug('Registering customer with email:', {
      requestEmail: params.email,
      resolvedEmail: prepared.resolvedEmail,
      mobile: prepared.normalizedMobile
    });
    

    // Create Commerce customer + token
    const response = await createCommerceCustomerAndToken(params, prepared, logger)
    const customerData = response?.data?.createCustomerWrapper?.customer
    const customerToken = response?.data?.generateCustomerToken?.token || null

    const customerId = await resolveCustomerId(
      params,
      { data: { createCustomerV2: { customer: customerData } } },
      prepared,
      logger
    )
    if (!customerId) throw new Error('customer id missing in createCustomer response')

    // Persist identity document
    const now = new Date()
    const doc = {
      email: prepared.resolvedEmail,
      mobile_number: prepared.normalizedMobile,
      login_type: prepared.loginType,
      customer_id: customerId,
      firstname: customerData?.firstname,
      lastname: customerData?.lastname,
      status: 'active',
      updated_at: now
    }

    try {
      await collection.updateOne(
        { customer_id: customerId },
        { $set: doc, $setOnInsert: { created_at: now } },
        { upsert: true }
      )
    } catch (dbError) {
      if (isUniqueConstraintError(dbError)) {
        return conflict('email, mobile_number, or customer_id already exists')
      }
      throw dbError
    }

    return {
      statusCode: 200,
      body: {
        customer_id: customerId,
        customer_token: customerToken,
        login_type: prepared.loginType,
        customer: {
          firstname: customerData?.firstname,
          lastname: customerData?.lastname,
          email: customerData?.email,
          mobile_number: prepared.normalizedMobile || null
        }
      }
    }
  } catch (error) {
    logger.error('register failed', {
      status: error?.status || error?.response?.status || null,
      payload: error?.response?.data || error?.message || 'unknown error',
      message: error?.message
    })
    return serverError(error?.message || 'registration failed')
  }
}
