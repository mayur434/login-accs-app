const fetch = require('node-fetch')
const { Core } = require('@adobe/aio-sdk')
const libDB = require('@adobe/aio-lib-db')
const { errorResponse, stringParameters, checkMissingRequestInputs } = require('../utils')
const DEFAULT_OTP_EXPIRATION_VALIDITY_MINUTES = 5
const DEFAULT_OTP_IN_RESPONSE = true

// OTPs persisted to Adobe DB collection 'otps'

function generateOtpValue () {
  return (Math.floor(1000 + Math.random() * 9000)).toString()
}

function createReferenceId () {
  return `otp_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function levenshtein (a, b) {
  if (!a) return b ? b.length : 0
  if (!b) return a.length
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[m][n]
}

async function graphQLRequest (params, query, variables = {}, logger) {
  const endpoint = (params.GRAPHQL_ENDPOINT || process.env.GRAPHQL_ENDPOINT)
  if (!endpoint) throw new Error('GRAPHQL_ENDPOINT not configured in params or env')

  const headers = { 'Content-Type': 'application/json' }
  if (params.__ow_headers && params.__ow_headers.authorization) {
    headers.authorization = params.__ow_headers.authorization
  } else if (process.env.GRAPHQL_API_KEY) {
    headers.authorization = `Bearer ${process.env.GRAPHQL_API_KEY}`
  }

  logger.info(`calling GraphQL ${endpoint}`)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  })
  const json = await res.json()
  return json
}

async function tryLogin (email, password, params, logger) {
  // First try generateCustomerToken mutation (some schemas expose this)
  const genTokenMutation = `mutation generateCustomerToken($email: String!){ generateCustomerToken(email: $email, password: "${password}"){ token } }`
  try {
    const genResp = await graphQLRequest(params, genTokenMutation, { email }, logger)
    if (genResp && genResp.data && genResp.data.generateCustomerToken && genResp.data.generateCustomerToken.token) {
      return genResp.data.generateCustomerToken.token
    }
  } catch (e) {
    logger.debug && logger.debug('generateCustomerToken attempt failed: ' + e.message)
  }

  // Fallback to generic login mutation. Adapt to your GraphQL schema if different.
  const loginMutation = `mutation Login($email:String!, $password:String!){ login(email:$email,password:$password){ token } }`
  const resp = await graphQLRequest(params, loginMutation, { email, password }, logger)
  if (resp && resp.data && resp.data.login && resp.data.login.token) return resp.data.login.token
  return null
}

async function createUser (email, password, mobile, params, logger) {
  // Use createCustomerV2 for commerce; derive firstname/lastname if missing
  const firstname = params.firstname || params.firstName || (typeof email === 'string' ? email.split('@')[0] : 'Customer')
  const lastname = params.lastname || params.lastName || (mobile ? String(mobile) : 'User')
  const createCustomerMutation = `mutation createCustomerV2($email: String!, $firstname: String!, $lastname: String!){ createCustomerV2(input:{ firstname: $firstname, lastname: $lastname, email: $email, password: "${password}" }){ customer{ firstname lastname email } } }`
  try {
    const resp = await graphQLRequest(params, createCustomerMutation, { email, firstname, lastname }, logger)
    return resp
  } catch (e) {
    logger.error && logger.error('createCustomerV2 attempt failed: ' + e.message)
    throw e
  }
}

// main action
async function main (params) {
  const logger = Core.Logger('otp', { level: params.LOG_LEVEL || 'info' })
  try {
    logger.info('OTP action called')
    logger.debug(stringParameters(params))

    // normalize input: accept JSON object in `params` or raw body
    let req = params
    if (params.params && typeof params.params === 'object') {
      req = params.params
    } else if (params.body) {
      try { req = (typeof params.body === 'string') ? JSON.parse(params.body) : params.body } catch (e) {}
    } else if (params.__ow_body) {
      try { req = (typeof params.__ow_body === 'string') ? JSON.parse(params.__ow_body) : params.__ow_body } catch (e) {}
    }
    // carry headers
    req.__ow_headers = params.__ow_headers || req.__ow_headers
    const inParams = { ...params, ...req }

    // initialize Adobe DB client and collection for OTPs
    const region = inParams.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
    const db = await libDB.init({ region })
    const dbClient = await db.connect()
    const otpCollection = await dbClient.collection('otps')
    const appConfigCollection = await dbClient.collection('app_config')
    const appConfig = await appConfigCollection.findOne({ _id: 'app_config' })

    if (!(appConfig && appConfig.is_enabled)) {
      return errorResponse(403, 'otp module is disabled', logger)
    }

    // decide mode: generate (no otpValue) vs validate (has otpValue & otpReferenceId)
    const isValidate = inParams.otpValue && inParams.otpReferenceId

    if (!isValidate) {
      // generation mode: require loginType and either mobile or email
      const requiredParams = ['loginType']
      const errorMessage = checkMissingRequestInputs(inParams, requiredParams, [])
      if (errorMessage) return errorResponse(400, errorMessage, logger)

      if (inParams.loginType === 'mobile') {
        const missing = checkMissingRequestInputs(inParams, ['mobile'], [])
        if (missing) return errorResponse(400, missing, logger)
      } else {
        const missing = checkMissingRequestInputs(inParams, ['email'], [])
        if (missing) return errorResponse(400, missing, logger)
      }

        const otpValue = generateOtpValue()
        const ref = createReferenceId()
        const otpValidityMinutes = Number.isInteger(appConfig && appConfig.otp_expiration_validity) && appConfig.otp_expiration_validity > 0
          ? appConfig.otp_expiration_validity
          : DEFAULT_OTP_EXPIRATION_VALIDITY_MINUTES
        const otpInResponse = typeof (appConfig && appConfig.otp_in_response) === 'boolean'
          ? appConfig.otp_in_response
          : DEFAULT_OTP_IN_RESPONSE
        await otpCollection.insertOne({
          otpReferenceId: ref,
          otp: otpValue,
          loginType: inParams.loginType,
          mobile: inParams.mobile,
          email: inParams.email,
          createdAt: Date.now(),
          expiresAt: Date.now() + (otpValidityMinutes * 60 * 1000),
          otpExpirationValidityMinutes: otpValidityMinutes
        })

      // NOTE: in production you should send OTP via SMS/email here instead
      return {
        statusCode: 200,
        body: otpInResponse
          ? {
              otpReferenceId: ref,
              otpValue
            }
          : {
              otpReferenceId: ref
            }
      }
    }

    // validation mode
    const missing = checkMissingRequestInputs(inParams, ['otpReferenceId', 'otpValue', 'loginType'], [])
    if (missing) return errorResponse(400, missing, logger)

    const record = await otpCollection.findOne({ otpReferenceId: inParams.otpReferenceId })
    if (!record) return errorResponse(400, 'invalid otpReferenceId', logger)
    if (Date.now() > record.expiresAt) {
      await otpCollection.deleteOne({ otpReferenceId: inParams.otpReferenceId })
      return errorResponse(400, 'otp expired', logger)
    }

    // fuzzy compare: allow distance 0 or 1
    const distance = levenshtein(String(inParams.otpValue), String(record.otp))
    if (distance > 1) return errorResponse(401, 'invalid otp', logger)

    // build user email: if loginType is mobile, create <mobile>@vijaysales.com
    let emailToUse = record.email
    if (inParams.loginType === 'mobile') {
      if (!record.mobile) return errorResponse(400, 'mobile not present for this reference', logger)
      emailToUse = `${record.mobile}@vijaysales.com`
    }

    const defaultPassword = 'Pass@123'

    // try to generate JWT token using GraphQL login
    try {
      const token = await tryLogin(emailToUse, defaultPassword, inParams, logger)
      if (token) {
        // cleanup OTP record
        await otpCollection.deleteOne({ otpReferenceId: inParams.otpReferenceId })
        await dbClient.close()
        return { statusCode: 200, body: { success: true, token } }
      }
    } catch (err) {
      logger.info('login attempt failed: ' + err.message)
    }

    // create user and then try login
    try {
      await createUser(emailToUse, defaultPassword, record.mobile, inParams, logger)
      const tokenAfterCreate = await tryLogin(emailToUse, defaultPassword, inParams, logger)
      if (tokenAfterCreate) {
        await otpCollection.deleteOne({ otpReferenceId: inParams.otpReferenceId })
        await dbClient.close()
        return { statusCode: 200, body: { success: true, token: tokenAfterCreate } }
      }
      return errorResponse(500, 'unable to obtain token after user creation', logger)
    } catch (err) {
      logger.error(err)
      return errorResponse(500, 'server error during user creation/login', logger)
    }
    } catch (error) {
      logger.error(error)
      return errorResponse(500, 'server error', logger)
    } finally {
      // ensure DB client is closed if still open
      try {
        if (typeof dbClient !== 'undefined' && dbClient) await dbClient.close()
      } catch (e) {
        logger.debug && logger.debug('error closing DB client: ' + e.message)
      }
    }
}

exports.main = main
