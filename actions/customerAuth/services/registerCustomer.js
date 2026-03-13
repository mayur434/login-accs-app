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

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function buildLoginType(hasEmail, hasMobile) {
  if (hasEmail && hasMobile) return 'both'
  if (hasEmail) return 'email'
  return 'mobile'
}

function isUniqueConstraintError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase()
  return error?.code === 11000 || message.includes('duplicate key') || message.includes('already exists') || message.includes('unique')
}

function isDocumentNotFoundError(error) {
  const status = error?.status || error?.response?.status
  if (status === 404) return true

  const message = String(error && error.message ? error.message : '').toLowerCase()
  return message.includes('document not found') || message.includes('not found')
}

function isUnauthorizedDbError(error) {
  const status = error?.status || error?.response?.status
  return status === 401 || status === 403
}

function maskToken(token) {
  if (!token) return 'missing'
  const t = String(token)
  return `len=${t.length}, tail=${t.slice(-6)}`
}

function getErrorStatus(error) {
  return error?.status || error?.response?.status || null
}

function getErrorPayload(error) {
  return error?.response?.data || error?.message || 'unknown error'
}

async function findOneOrNull(collection, query, logger) {
  try {
    return await collection.findOne(query)
  } catch (error) {
    if (isDocumentNotFoundError(error)) return null

    logger.error('Doc DB findOne failed', {
      status: getErrorStatus(error),
      payload: getErrorPayload(error),
      query
    })

    if (isUnauthorizedDbError(error)) {
      throw new Error(`Doc DB unauthorized (${getErrorStatus(error)})`)
    }

    throw error
  }
}

function getSyntheticEmail(normalizedMobile) {
  return `${normalizedMobile.replaceAll(/\D/g, '')}@email.com`
}

function getCommerceMobileValue(mobileNumber) {
  if (!mobileNumber) return null

  const digitsOnly = String(mobileNumber).replaceAll(/\D/g, '')
  if (!digitsOnly) return null

  return digitsOnly.length > 10
    ? digitsOnly.slice(-10)
    : digitsOnly
}

function getCustomerId(createCustomerResponse) {
  const customer = createCustomerResponse?.data?.createCustomerV2?.customer
  if (!customer) {
    return null
  }

  const idCandidates = [
    customer.id,
    customer.customer_id,
    customer.customerId,
    customer.entity_id,
    customer.entityId,
    customer.uid
  ]

  for (const value of idCandidates) {
    const parsedId = parseCustomerIdValue(value)
    if (parsedId) return parsedId
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

function parseCustomerIdFromToken(token) {
  if (!token || typeof token !== 'string') return null

  try {
    const tokenParts = token.split('.')
    if (tokenParts.length < 2) return null

    const payloadBase64 = tokenParts[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(Math.ceil(tokenParts[1].length / 4) * 4, '=')
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'))

    const idCandidates = [
      payload.customer_id,
      payload.customerId,
      payload.user_id,
      payload.uid,
      payload.sub
    ]

    for (const value of idCandidates) {
      const parsedId = parseCustomerIdValue(value)
      if (parsedId) return parsedId
    }
  } catch {
    return null
  }

  return null
}

async function generateCustomerToken(params, email, password, logger) {
  const mutation = `
    mutation generateCustomerToken($email: String!, $password: String!) {
      generateCustomerToken(email: $email, password: $password) {
        token
      }
    }
  `

  const response = await graphQLRequest(
    params,
    mutation,
    { email, password },
    logger
  )

  return response?.data?.generateCustomerToken?.token || null
}

async function resolveCustomerId(params, createCustomerResponse, prepared, logger) {
  const customerIdFromCreate = getCustomerId(createCustomerResponse)
  if (customerIdFromCreate) {
    return customerIdFromCreate
  }

  const token = await generateCustomerToken(
    params,
    prepared.resolvedEmail,
    prepared.password,
    logger
  )
  return parseCustomerIdFromToken(token)
}

function validateAndPrepareInput(params) {
  const hasEmail = hasValue(params.email)
  const hasMobile = hasValue(params.mobile_number)
  const hasPassword = hasValue(params.password)

  if (!hasPassword) {
    return { error: badRequest("missing parameter(s) 'password'") }
  }

  if (!hasEmail && !hasMobile) {
    return { error: badRequest("missing parameter(s) 'email,mobile_number'") }
  }

  let normalizedMobile = null
  if (hasMobile) {
    try {
      normalizedMobile = normalizeMobile(params.mobile_number)
    } catch (error) {
      return { error: badRequest(error.message || 'invalid indian mobile number') }
    }
  }

  const loginType = buildLoginType(hasEmail, hasMobile)
  const resolvedEmail = hasEmail
    ? String(params.email).trim().toLowerCase()
    : getSyntheticEmail(normalizedMobile)

  return {
    prepared: {
      resolvedEmail,
      normalizedMobile,
      loginType,
      password: String(params.password)
    }
  }
}

async function graphQLRequest(params, query, variables, logger) {
  const endpoint = params.GRAPHQL_ENDPOINT || process.env.GRAPHQL_ENDPOINT
  if (!endpoint) {
    throw new Error('GRAPHQL_ENDPOINT not configured in params or env')
  }

  const headers = { 'Content-Type': 'application/json' }
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

async function createCommerceCustomer(params, email, password, mobileNumber, logger) {
  const firstname = params.firstname || params.firstName || email.split('@')[0] || 'Customer'
  const lastname = params.lastname || params.lastName || (mobileNumber ? mobileNumber.replaceAll(/\D/g, '') : 'User')
  const commerceMobile = getCommerceMobileValue(mobileNumber)

  if (commerceMobile) {
    const mutationWithMobile = `
      mutation createCustomerV2(
        $firstname: String!
        $lastname: String!
        $email: String!
        $password: String!
        $mobile: String!
      ) {
        createCustomerV2(
          input: {
            firstname: $firstname
            lastname: $lastname
            email: $email
            password: $password
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
            firstname
            lastname
            email
          }
        }
      }
    `

    return graphQLRequest(
      params,
      mutationWithMobile,
      { firstname, lastname, email, password, mobile: commerceMobile },
      logger
    )
  }

  const mutation = `
    mutation createCustomerV2($firstname: String!, $lastname: String!, $email: String!, $password: String!) {
      createCustomerV2(
        input: {
          firstname: $firstname
          lastname: $lastname
          email: $email
          password: $password
        }
      ) {
        customer {
          id
          firstname
          lastname
          email
        }
      }
    }
  `

  return graphQLRequest(
    params,
    mutation,
    { firstname, lastname, email, password },
    logger
  )
}

async function upsertIdentityDocument(collection, filter, doc) {
  const { created_at: createdAt, ...restDoc } = doc

  return collection.updateOne(
    filter,
    {
      $set: {
        ...restDoc,
        updated_at: new Date()
      },
      $setOnInsert: {
        created_at: createdAt || new Date()
      }
    },
    { upsert: true }
  )
}

async function findExistingIdentity(collection, prepared, logger) {
  if (prepared.normalizedMobile) {
    const existingByMobile = await findOneOrNull(collection, {
      mobile_number: prepared.normalizedMobile,
      status: 'active'
    }, logger)
    if (existingByMobile) {
      return {
        reason: 'mobile_number',
        record: existingByMobile
      }
    }
  }

  const existingByEmail = await findOneOrNull(collection, {
    email: prepared.resolvedEmail,
    status: 'active'
  }, logger)
  if (existingByEmail) {
    return {
      reason: 'email',
      record: existingByEmail
    }
  }

  return null
}

async function createCommerceAndSyncIdentity(params, logger, collection, prepared) {
  const createCustomerResponse = await createCommerceCustomer(
    params,
    prepared.resolvedEmail,
    prepared.password,
    prepared.normalizedMobile,
    logger
  )

  const customerId = await resolveCustomerId(params, createCustomerResponse, prepared, logger)
  if (!customerId) {
    throw new Error('customer id missing in createCustomerV2 response')
  }

  const now = new Date()
  const doc = {
    email: prepared.resolvedEmail,
    mobile_number: prepared.normalizedMobile,
    login_type: prepared.loginType,
    customer_id: customerId,
    status: 'active',
    created_at: now,
    updated_at: now
  }

  try {
    await upsertIdentityDocument(
      collection,
      { customer_id: customerId },
      doc
    )
  } catch (dbError) {
    if (isUniqueConstraintError(dbError)) {
      const existingIdentity = await findExistingIdentity(collection, prepared)
      if (existingIdentity) {
        return conflict(`${existingIdentity.reason} already exists`)
      }
      return conflict('email, mobile_number, or customer_id already exists')
    }
    throw dbError
  }

  return {
    statusCode: 200,
    body: createCustomerResponse.data.createCustomerV2
  }
}

async function connectDb(params, logger) {
  const region = 'apac'
  const rawToken = params.AIO_DB_TOKEN || process.env.AIO_DB_TOKEN

  const token = typeof rawToken === 'string' ? rawToken : rawToken?.access_token

  logger.info('DB context', {
    region,
    owNamespace: process.env.__OW_NAMESPACE,
    token: maskToken(token)
  })

  if (!token) {
    throw new Error('database token missing (IMS credentials not available)')
  }

  const db = await libDB.init({ region, token: token })
  const dbClient = await db.connect()
  const collection = await dbClient.collection(COLLECTION_NAME)

  return { dbClient, collection }
}

module.exports = async function registerCustomer(params, logger) {
  let dbClient

  try {
    const { error, prepared } = validateAndPrepareInput(params)
    if (error) return error

    const db = await connectDb(params, logger);
    dbClient = db.dbClient
    const collection = db.collection

    const existingIdentity = await findExistingIdentity(collection, prepared, logger)
    if (existingIdentity) {
      return conflict(`${existingIdentity.reason} already exists`)
    }

    try {
      return await createCommerceAndSyncIdentity(params, logger, collection, prepared)
    } catch (commerceError) {
      logger.error(commerceError)
      return serverError(commerceError.message || 'registration failed')
    }
  } catch (error) {
    logger.error('registerCustomer failed', {
      status: getErrorStatus(error),
      payload: getErrorPayload(error),
      message: error?.message
    })
    return serverError(error?.message || 'server error')
    
  } finally {
    try {
      if (dbClient) await dbClient.close()
    } catch (closeError) {
      logger.debug && logger.debug('error closing DB client: ' + closeError.message)
    }
  }
}
