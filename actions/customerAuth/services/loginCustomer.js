const fetch = require('node-fetch')
const libDB = require('@adobe/aio-lib-db')
const { getLoginType, normalizeMobile } = require('../../utils')

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

function serverError(message = 'server error') {
  return {
    statusCode: 500,
    body: {
      error: message
    }
  }
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

async function graphQLRequest(params, query, variables, logger) {
  const endpoint = params.GRAPHQL_ENDPOINT || process.env.GRAPHQL_ENDPOINT
  if (!endpoint) {
    throw new Error('GRAPHQL_ENDPOINT not configured in params or env')
  }

  // const apiKey = params.GRAPHQL_API_KEY || process.env.GRAPHQL_API_KEY
  const headers = { 'Content-Type': 'application/json' }
  // if (apiKey) {
  //   headers.authorization = `Bearer ${apiKey}`
  // }

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

async function generateCustomerToken(params, email, password, logger) {
  const mutation = `
    mutation generateCustomerToken($email: String!, $password: String!) {
      generateCustomerToken(email: $email, password: $password) {
        token
      }
    }
  `

  const payload = await graphQLRequest(
    params,
    mutation,
    { email, password },
    logger
  )

  const token = payload?.data?.generateCustomerToken?.token
  if (!token) {
    throw new Error('token not present in generateCustomerToken response')
  }

  return token
}

async function resolveEmailForIdentifier(params, identifierType) {
  if (identifierType.type === 'email') {
    return { email: String(params.identifier).trim().toLowerCase() }
  }

  let normalizedMobile
  try {
    normalizedMobile = normalizeMobile(params.identifier)
  } catch (error) {
    return { error: badRequest(error.message || 'invalid indian mobile number') }
  }

  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const token = params.AIO_DB_TOKEN || process.env.AIO_DB_TOKEN

  if (!token) {
    return { error: serverError('database token missing (IMS credentials not available)') }
  }

  const db = await libDB.init({ region, token })
  const dbClient = await db.connect()

  try {
    const collection = await dbClient.collection(COLLECTION_NAME)
    const identity = await collection.findOne({ mobile_number: normalizedMobile, status: 'active' })

    if (!identity || !identity.email) {
      return { error: notFound('mobile number not found') }
    }

    return { email: identity.email }
  } finally {
    await dbClient.close()
  }
}

module.exports = async function loginCustomer(params, logger) {
  try {
    if (!hasValue(params.identifier)) {
      return badRequest("missing parameter(s) 'identifier'")
    }

    if (!hasValue(params.password)) {
      return badRequest("missing parameter(s) 'password'")
    }

    const identifierType = getLoginType(params.identifier)
    const resolved = await resolveEmailForIdentifier(params, identifierType)

    if (resolved.error) {
      return resolved.error
    }

    const token = await generateCustomerToken(
      params,
      resolved.email,
      String(params.password),
      logger
    )

    return {
      statusCode: 200,
      body: {
        token
      }
    }
  } catch (error) {
    logger.error(error)
    return serverError(error.message || 'login failed')
  }
}
