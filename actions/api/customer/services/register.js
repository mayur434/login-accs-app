const { badRequest, conflict, serverError, success } = require('../../../../lib/http')
const { isUniqueConstraintError } = require('../../../../lib/db')
const { commerceGraphQLRequest, graphQLRequest } = require('../../../../lib/graphql')
const { hasValue } = require('../../../../lib/params')
const {
  normalizeMobile,
  getCustomerId,
  parseCustomerIdFromToken,
  getSyntheticEmail,
  getCommerceMobileValue,
  buildLoginType
} = require('../../../../lib/customer')
const { generateCustomerToken } = require('../../../../lib/commerce')

// ── Input validation ────────────────────────────────────────────────────

function validateAndPrepare(params) {
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

async function createCommerceCustomerAndToken(params, prepared, logger) {
  const firstname =
  params.firstname?.trim() ||
  params.firstName?.trim() ||
  'Guest'

const lastname =
  params.lastname?.trim() ||
  params.lastName?.trim() ||
  'User'
  const commerceMobile = getCommerceMobileValue(prepared.normalizedMobile)

  const mutation = commerceMobile
    ? `mutation CreateAndLogin(
        $firstname: String!, $lastname: String!, $email: String!, $password: String!, $mobile: String!
      ) {
        createCustomerWrapper: createCustomerV2(input: {
          firstname: $firstname, lastname: $lastname, email: $email, password: $password,
          vs_mobile_number: $mobile
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

  return commerceGraphQLRequest(params, mutation, variables, logger)
}

// ── Customer ID resolution ──────────────────────────────────────────────

async function resolveCustomerId(params, createResponse, prepared, logger, existingToken) {
  const idFromCreate = getCustomerId(createResponse)
  if (idFromCreate) return idFromCreate

  // Try parsing ID from the token already obtained during registration
  if (existingToken) {
    const fromToken = parseCustomerIdFromToken(existingToken)
    if (fromToken) return fromToken
  }

  // Last resort: generate a fresh token to extract the ID
  const token = await generateCustomerToken(params, prepared.resolvedEmail, prepared.password, logger)
  return parseCustomerIdFromToken(token)
}

async function getCustomerStatus (params, prepared, logger) {
  const query = `query IsCustomerExists($email: String!, $mobile_number: String!) {
    isCustomerExists(email: $email, mobile_number: $mobile_number) {
      is_customer_exists
      is_disabled
    }
  }`

  const response = await graphQLRequest(params, query, {
    email: prepared.resolvedEmail || '',
    mobile_number: prepared.normalizedMobile || ''
  }, logger)

  return {
    isCustomerExists: !!response?.data?.isCustomerExists?.is_customer_exists,
    isDisabled: !!response?.data?.isCustomerExists?.is_disabled
  }
}

// ── Exported handler ────────────────────────────────────────────────────

module.exports = async function register(dbClient, params, logger) {
  try {
    const { error, prepared } = validateAndPrepare(params)
    if (error) return error

    const customerStatus = await getCustomerStatus(params, prepared, logger)
    if (customerStatus.isDisabled) return conflict('customer is disabled')
    if (customerStatus.isCustomerExists) return conflict('customer already exists')

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
    const firstName = customerData?.firstname || params.firstname || params.firstName || null
    const lastName = customerData?.lastname || params.lastname || params.lastName || null

    const customerId = await resolveCustomerId(
      params,
      { data: { createCustomerV2: { customer: customerData } } },
      prepared,
      logger,
      customerToken
    )
    if (!customerId) throw new Error('customer id missing in createCustomer response')

    return {
      statusCode: 200,
      body: {
        success: true,
        customer_token: customerToken,
        customer: {
          customer_id: customerId,
          firstname: firstName,
          lastname: lastName,
          email: customerData?.email,
          mobile_number: prepared.normalizedMobile || null,
          login_type: prepared.loginType
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
