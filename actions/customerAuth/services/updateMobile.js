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

function isDocumentNotFoundError(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    error?.code === 404 ||
    message.includes('document not found') ||
    message.includes('not found') ||
    message.includes('does not exist')
  )
}

function normalizeEmailInput(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('invalid email')
  }
  return normalizedEmail
}

function parseCustomerIdValue(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null

  const s = String(value).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)

  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8').trim()
    if (/^\d+$/.test(decoded)) return Number(decoded)
    const trailing = decoded.match(/(\d+)$/)
    if (trailing) return Number(trailing[1])
  } catch (_) {}

  return null
}

function extractCustomerId(params) {
  const raw =
    params.customer_id ??
    params.customerId ??
    params.__ow_headers?.['x-customer-id'] ??
    params.__ow_headers?.['X-Customer-Id']

  return parseCustomerIdValue(raw)
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

function encodeCustomerId(customerId) {
  if (!Number.isInteger(customerId) || customerId <= 0) return null
  return Buffer.from(String(customerId), 'utf8').toString('base64')
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
  const config =
    await findOneOrNull(appConfigCollection, { _id: 'app_config' }) ||
    await findOneOrNull(appConfigCollection, {})
  return !!(config && config.allow_key_info_update)
}

async function validateAndLoadCustomerRecord(collection, customerId, prepared) {
  const encodedId = Buffer.from(String(customerId), 'utf8').toString('base64')

  const customerRecord = await findOneOrNull(collection, {
    $and: [
      { status: 'active' },
      {
        $or: [
          { customer_id: customerId },          // number
          { customer_id: String(customerId) },  // numeric string
          { customer_id: encodedId }            // base64 id
        ]
      }
    ]
  })

  if (!customerRecord) {
    return { error: notFound('customer record not found') }
  }

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
    if (!customerId) return badRequest("missing/invalid parameter 'customer_id'")

    const customerToken = extractCustomerToken(params)
    if (!customerToken) return unauthorized('missing customer token')

    const dbConn = await connectDb(params)
    dbClient = dbConn.dbClient
    const collection = dbConn.collection

    const allowed = await isKeyInfoUpdateAllowed(dbClient)
    if (!allowed) return conflict('key info update is disabled')

    const { error: prepError, prepared } = getPreparedUpdateInput(params)
    if (prepError) return prepError

    const { error: loadError, customerRecord } = await validateAndLoadCustomerRecord(collection, customerId, prepared)
    if (loadError) return loadError

    const previousState = {
      email: customerRecord.email || null,
      mobile_number: customerRecord.mobile_number || null,
      first_name: customerRecord.first_name || null,
      last_name: customerRecord.last_name || null,
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
      return {
        statusCode: 200,
        body: commerceResponse?.data || {}
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
      if (logger.debug) logger.debug('error closing DB client: ' + closeError.message)
    }
  }
}
