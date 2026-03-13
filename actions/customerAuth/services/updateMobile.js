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
  const hasMobile = hasValue(params.mobile_number)
  const hasEmail = hasValue(params.email)

  if (!hasMobile && !hasEmail) {
    return { error: badRequest("missing parameter(s) 'mobile_number,email'") }
  }

  let normalizedMobile = null
  let resolvedEmail = null
  let password = null

  if (hasMobile) {
    try {
      normalizedMobile = normalizeMobile(params.mobile_number)
    } catch (error) {
      return { error: badRequest(error.message || 'invalid indian mobile number') }
    }
  }

  if (hasEmail) {
    try {
      resolvedEmail = normalizeEmailInput(params.email)
    } catch (error) {
      return { error: badRequest(error.message || 'invalid email') }
    }
    if (!hasValue(params.password)) {
      return { error: badRequest("missing parameter 'password' for email update") }
    }
    password = String(params.password).trim()
  }

  return {
    prepared: {
      hasMobile,
      hasEmail,
      normalizedMobile,
      resolvedEmail,
      password
    }
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

  const apiKey = params.GRAPHQL_API_KEY || process.env.GRAPHQL_API_KEY
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
  if (prepared.hasEmail && prepared.hasMobile) {
    const emailMutation = `
      mutation UpdateCustomerEmail($email: String!, $password: String!){
        updateCustomerEmail(email: $email, password: $password) {
          customer {
            email
          }
        }
      }
    `
    await graphQLRequest(
      params,
      emailMutation,
      { email: prepared.resolvedEmail, password: prepared.password },
      logger
    )

    const commerceMobile = getCommerceMobileValue(prepared.normalizedMobile)
    const mobileMutation = `
      mutation updateCustomerV2($mobile: String!) {
        updateCustomerV2(
          input: {
            custom_attributes: [
              {
                attribute_code: "mobile_number"
                value: $mobile
              }
            ]
          }
        ) {
          customer {
            id
            email
            custom_attributes {
              code
              ...on AttributeValue { value }
            }
          }
        }
      }
    `
    return graphQLRequest(params, mobileMutation, { mobile: commerceMobile }, logger)
  }

  if (prepared.hasEmail) {
    const mutation = `
      mutation UpdateCustomerEmail($email: String!, $password: String!){
        updateCustomerEmail(email: $email, password: $password) {
          customer {
            email
          }
        }
      }
    `

    return graphQLRequest(
      params,
      mutation,
      { email: prepared.resolvedEmail, password: prepared.password },
      logger
    )
  }

  const commerceMobile = getCommerceMobileValue(prepared.normalizedMobile)
  const mutation = `
    mutation updateCustomerV2($mobile: String!) {
      updateCustomerV2(
        input: {
          custom_attributes: [
            {
              attribute_code: "mobile_number"
              value: $mobile
            }
          ]
        }
      ) {
        customer {
          id
          email
          custom_attributes {
            code
            ...on AttributeValue {value}
          }
        }
      }
    }
  `

  return graphQLRequest(params, mutation, { mobile: commerceMobile }, logger)
}

module.exports = async function updateMobile(params, logger) {
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

      const updatedMobile = prepared.hasMobile ? prepared.normalizedMobile : customerRecord.mobile_number || null
      const updatedEmail = prepared.hasEmail ? prepared.resolvedEmail : customerRecord.email || null

      return {
        statusCode: 200,
        body: {
          success: true,
          customer_id: customerId,
          mobile_number: updatedMobile,
          email: updatedEmail,
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
