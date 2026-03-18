const fetch = require('node-fetch')
const libDB = require('@adobe/aio-lib-db')
const { normalizeMobile } = require('../../utils')

const COLLECTION_NAME = 'customer_mobile_identity'

function badRequest(message) {
  return {
    statusCode: 400,
    body: {
      error: message
    }
  }
}

function notFound(message) {
  return {
    statusCode: 404,
    body: {
      error: message
    }
  }
}

function conflict(message) {
  return {
    statusCode: 409,
    body: {
      error: message
    }
  }
}

function serverError(message = 'server error') {
  return {
    statusCode: 500,
    body: {
      error: message
    }
  }
}

function unauthorized(message) {
  return {
    statusCode: 401,
    body: {
      error: message
    }
  }
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function normalizeEmailInput(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('invalid email')
  }
  return normalizedEmail
}

function extractCustomerId(params) {
  const candidates = [
    params.context?.customer_id ??
    params.context?.customerId ??
    params.customer_id ??
    params.customerId ??
    params.id ??
    params.__ow_headers?.['x-customer-id'] ??
    params.__ow_headers?.['x-customerid']
  ]

  for (const candidate of candidates) {
    const parsed = parseCustomerIdValue(candidate)
    if (parsed) return parsed
  }

  return null
}

function extractCustomerToken(params) {
  const tokenFromParams = params.customer_token || params.customerToken || params.token
  if (tokenFromParams) {
    return String(tokenFromParams).trim()
  }

  const authHeader = params.__ow_headers?.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring('Bearer '.length).trim()
  }

  return null
}

function parseCustomerIdValue(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null
  }

  const textValue = String(value).trim()
  if (!textValue) return null

  const directNumber = Number(textValue)
  if (!Number.isNaN(directNumber) && directNumber > 0) {
    return directNumber
  }

  const trailingDigits = textValue.match(/(\d+)$/)
  if (trailingDigits) {
    const trailingNumber = Number(trailingDigits[1])
    if (!Number.isNaN(trailingNumber) && trailingNumber > 0) {
      return trailingNumber
    }
  }

  try {
    const decoded = Buffer.from(textValue, 'base64').toString('utf8').trim()
    const decodedNumber = Number(decoded)
    if (!Number.isNaN(decodedNumber) && decodedNumber > 0) {
      return decodedNumber
    }
  } catch {
    return null
  }

  return null
}

function isDocumentNotFoundError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase()
  return message.includes('document not found')
}

async function findOneOrNull(collection, query) {
  try {
    return await collection.findOne(query)
  } catch (error) {
    if (isDocumentNotFoundError(error)) {
      return null
    }
    throw error
  }
}

function isUniqueConstraintError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase()
  return error?.code === 11000 || message.includes('duplicate key') || message.includes('already exists') || message.includes('unique')
}

function getPreparedUpdateInput(params) {
  try {
    const mobileInput = hasValue(params.mobile_number) ? String(params.mobile_number).trim() : null
    const hasMobile = !!mobileInput
    const normalizedMobile = hasMobile ? normalizeMobile(mobileInput) : null

    const hasEmail = hasValue(params.new_email)
    const resolvedEmail = hasEmail ? normalizeEmailInput(params.new_email) : null
    const password = hasEmail ? String(params.password || '').trim() : null

    const firstName = hasValue(params.firstName)
      ? String(params.firstName).trim()
      : (hasValue(params.firstname) ? String(params.firstname).trim() : null)

    const lastName = hasValue(params.lastName)
      ? String(params.lastName).trim()
      : (hasValue(params.lastname) ? String(params.lastname).trim() : null)

    if (!hasMobile && !hasEmail && !firstName && !lastName) {
      return {
        error: badRequest("provide at least one field: 'mobile_number', 'new_email', 'firstName', 'lastName'")
      }
    }

    if (hasEmail && !password) {
      return { error: badRequest("missing parameter(s) 'password' for email update") }
    }

    return {
      prepared: {
        hasMobile,
        hasEmail,
        normalizedMobile,
        resolvedEmail,
        password,
        firstName,
        lastName
      }
    }
  } catch (e) {
    if (e && e.statusCode === 400) return { error: e }
    return { error: badRequest(e.message || 'invalid input') }
  }
}

function buildLoginType(email, mobile) {
  if (email && mobile) return 'both'
  if (email) return 'email'
  if (mobile) return 'mobile'
  return null
}

function getCommerceMobileValue(mobileNumber) {
  if (!mobileNumber) return null

  const digitsOnly = String(mobileNumber).replaceAll(/\D/g, '')
  if (!digitsOnly) return null

  return digitsOnly.length > 10
    ? digitsOnly.slice(-10)
    : digitsOnly
}

async function connectDb(params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const token = params.AIO_DB_TOKEN || process.env.AIO_DB_TOKEN
  if (!token) {
    throw new Error('database token missing (IMS credentials not available)')
  }

  const db = await libDB.init({ region, token })
  const dbClient = await db.connect()
  const collection = await dbClient.collection(COLLECTION_NAME)
  return { dbClient, collection }
}

async function isKeyInfoUpdateAllowed(dbClient) {
  const appConfigCollection = await dbClient.collection('app_config')
  const config = await appConfigCollection.findOne({ _id: 'app_config' })
  return !!(config && config.allow_key_info_update)
}

async function validateAndLoadCustomerRecord(collection, customerId, prepared) {
  if (prepared.hasMobile) {
    const existingByMobile = await findOneOrNull(collection, { mobile_number: prepared.normalizedMobile })
    if (existingByMobile && Number(existingByMobile.customer_id) !== customerId) {
      return { error: conflict('mobile number already exists') }
    }
  }

  if (prepared.hasEmail) {
    const existingByEmail = await findOneOrNull(collection, { email: prepared.resolvedEmail })
    if (existingByEmail && Number(existingByEmail.customer_id) !== customerId) {
      return { error: conflict('email already exists') }
    }
  }

  const customerRecord = await findOneOrNull(collection, { customer_id: customerId })
  if (!customerRecord) {
    return { error: notFound('customer record not found') }
  }

  return { customerRecord }
}

async function updateDocDbKeyInfo(collection, customerId, prepared, customerRecord) {
  const nextEmail = prepared.hasEmail ? prepared.resolvedEmail : customerRecord.email || null
  const nextMobile = prepared.hasMobile ? prepared.normalizedMobile : customerRecord.mobile_number || null

  await collection.updateOne(
    { customer_id: customerId },
    {
      $set: {
        ...(prepared.hasEmail ? { email: prepared.resolvedEmail } : {}),
        ...(prepared.hasMobile ? { mobile_number: prepared.normalizedMobile } : {}),
        ...(prepared.firstName ? { first_name: prepared.firstName } : {}),
        ...(prepared.lastName ? { last_name: prepared.lastName } : {}),
        login_type: buildLoginType(nextEmail, nextMobile),
        updated_at: new Date()
      }
    }
  )
}

async function rollbackDocDbKeyInfo(collection, customerId, previousState) {
  await collection.updateOne(
    { customer_id: customerId },
    {
      $set: {
        email: previousState.email,
        mobile_number: previousState.mobile_number,
        first_name: previousState.first_name,
        last_name: previousState.last_name,
        login_type: previousState.login_type,
        updated_at: new Date()
      }
    }
  )
}

async function graphQLRequest(params, query, variables, logger) {
  const endpoint = params.GRAPHQL_ENDPOINT || process.env.GRAPHQL_ENDPOINT
  if (!endpoint) {
    throw new Error('GRAPHQL_ENDPOINT not configured in params or env')
  }

  const customerToken = extractCustomerToken(params)
  const headers = { 'Content-Type': 'application/json' }
  // updateCustomerV2 requires a customer context token; prefer it when present.
  if (customerToken) {
    headers.authorization = `Bearer ${customerToken}`
  }

  logger.info(`calling GraphQL ${endpoint}`)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  })

  const payload = await response.json()

  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || `graphql request failed with status ${response.status}`)
  }

  if (payload?.errors?.length) {
    throw new Error(payload.errors.map(e => e.message).join('; '))
  }

  return payload
}

function isUnauthorizedCommerceError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes("current customer isn't authorized") || message.includes('not authorized')
}

async function updateCommerceKeyInfo(params, customerId, prepared, logger) {
  let emailResponse = null
  let profileResponse = null

  // 1) email update (requires password)
  if (prepared.hasEmail) {
    const emailMutation = `
      mutation UpdateCustomerEmail($email: String!, $password: String!){
        updateCustomerEmail(email: $email, password: $password) {
          customer { email }
        }
      }
    `
    emailResponse = await graphQLRequest(
      params,
      emailMutation,
      { email: prepared.resolvedEmail, password: prepared.password },
      logger
    )
  }

  // 2) profile/mobile update (works for name-only, mobile-only, or both)
  const shouldUpdateProfile = prepared.hasMobile || !!prepared.firstName || !!prepared.lastName
  if (shouldUpdateProfile) {
    const input = {}
    if (prepared.firstName) input.firstname = prepared.firstName
    if (prepared.lastName) input.lastname = prepared.lastName

    if (prepared.hasMobile) {
      const commerceMobile = getCommerceMobileValue(prepared.normalizedMobile)
      input.custom_attributes = [
        { attribute_code: 'mobile_number', value: commerceMobile }
      ]
    }

    const profileMutation = `
      mutation updateCustomerV2($input: CustomerUpdateInput!) {
        updateCustomerV2(input: $input) {
          customer {
            id
            firstname
            lastname
            email
            custom_attributes {
              code
              ...on AttributeValue { value }
            }
          }
        }
      }
    `
    profileResponse = await graphQLRequest(params, profileMutation, { input }, logger)
  }

  return {
    data: {
      updateCustomerEmail: emailResponse?.data?.updateCustomerEmail || null,
      updateCustomerV2: profileResponse?.data?.updateCustomerV2 || null
    }
  }
}

module.exports = async function updateCustomerDetails(params, logger) {
  let dbClient
  try {
    const customerId = extractCustomerId(params)
    if (!customerId) {
      return badRequest('authenticated customer_id not found in request context')
    }

    const { error: inputError, prepared } = getPreparedUpdateInput(params)
    if (inputError) return inputError

    const dbConnection = await connectDb(params)
    dbClient = dbConnection.dbClient
    const collection = dbConnection.collection

    const allowKeyInfoUpdate = await isKeyInfoUpdateAllowed(dbClient)
    if (!allowKeyInfoUpdate) {
      return {
        statusCode: 403,
        body: {
          error: 'key info updates are disabled'
        }
      }
    }

    const loaded = await validateAndLoadCustomerRecord(collection, customerId, prepared)
    if (loaded.error) return loaded.error

    const customerRecord = loaded.customerRecord

    const previousState = {
      email: customerRecord.email || null,
      mobile_number: customerRecord.mobile_number || null,
      first_name: customerRecord.first_name || null, // added
      last_name: customerRecord.last_name || null,   // added
      login_type: customerRecord.login_type || null
    }

    try {
      await updateDocDbKeyInfo(collection, customerId, prepared, customerRecord)
    } catch (updateError) {
      if (isUniqueConstraintError(updateError)) {
        return conflict('email or mobile number already exists')
      }
      throw updateError
    }

    try {
      const commerceResponse = await updateCommerceKeyInfo(params, customerId, prepared, logger)

      const updatedMobile = prepared.hasMobile ? prepared.normalizedMobile : (customerRecord.mobile_number || null)
      const updatedEmail = prepared.hasEmail ? prepared.resolvedEmail : (customerRecord.email || null)

      return {
        statusCode: 200,
        body: {
          success: true,
          customer_id: customerId,
          mobile_number: updatedMobile,
          email: updatedEmail,
          firstName: commerceResponse.data.updateCustomerV2?.customer?.firstname || prepared.firstName || customerRecord.first_name || null,
          lastName: commerceResponse.data.updateCustomerV2?.customer?.lastname || prepared.lastName || customerRecord.last_name || null,
          commerce: commerceResponse.data.updateCustomerV2 || commerceResponse.data.updateCustomerEmail
        }
      }
    } catch (commerceError) {
      await rollbackDocDbKeyInfo(collection, customerId, previousState)

      if (isUnauthorizedCommerceError(commerceError)) {
        return unauthorized('customer token is required/invalid for key info update')
      }

      logger.error(commerceError)
      return serverError(commerceError.message || 'failed to update key info in commerce')
    }
  } catch (error) {
    logger.error(error)
    return serverError(error.message || 'server error')
  } finally {
    try {
      if (dbClient) await dbClient.close()
    } catch (closeError) {
      logger.debug && logger.debug('error closing DB client: ' + closeError.message)
    }
  }
}
