const fetch = require('node-fetch')
const { Core } = require('@adobe/aio-sdk')
const { errorResponse, stringParameters, checkMissingRequestInputs } = require('../utils')

// Simple in-memory OTP store. Note: not persistent across cold starts.
const otpStore = new Map()

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
  // Generic login mutation. Adapt to your GraphQL schema if different.
  const loginMutation = `mutation Login($email:String!, $password:String!){ login(email:$email,password:$password){ token } }`
  const resp = await graphQLRequest(params, loginMutation, { email, password }, logger)
  if (resp && resp.data && resp.data.login && resp.data.login.token) return resp.data.login.token
  return null
}

async function createUser (email, password, mobile, params, logger) {
  // Generic create user mutation. Adapt input type to your schema.
  const createUserMutation = `mutation CreateUser($input: CreateUserInput!){ createUser(input:$input){ user{ id email } } }`
  const input = { email, password }
  if (mobile) input.mobile = mobile
  const resp = await graphQLRequest(params, createUserMutation, { input }, logger)
  return resp
}

// main action
async function main (params) {
  const logger = Core.Logger('otp', { level: params.LOG_LEVEL || 'info' })
  try {
    logger.info('OTP action called')
    logger.debug(stringParameters(params))

    // decide mode: generate (no otpValue) vs validate (has otpValue & otpReferenceId)
    const isValidate = params.otpValue && params.otpReferenceId

    if (!isValidate) {
      // generation mode: require loginType and either mobile or email
      const requiredParams = ['loginType']
      const errorMessage = checkMissingRequestInputs(params, requiredParams, [])
      if (errorMessage) return errorResponse(400, errorMessage, logger)

      if (params.loginType === 'mobile') {
        const missing = checkMissingRequestInputs(params, ['mobile'], [])
        if (missing) return errorResponse(400, missing, logger)
      } else {
        const missing = checkMissingRequestInputs(params, ['email'], [])
        if (missing) return errorResponse(400, missing, logger)
      }

      const otpValue = generateOtpValue()
      const ref = createReferenceId()
      otpStore.set(ref, {
        otp: otpValue,
        loginType: params.loginType,
        mobile: params.mobile,
        email: params.email,
        createdAt: Date.now(),
        expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
      })

      // NOTE: in production you should send OTP via SMS/email here instead
      return {
        statusCode: 200,
        body: {
          otpReferenceId: ref,
          otpValue // returned for testing/demo purposes
        }
      }
    }

    // validation mode
    const missing = checkMissingRequestInputs(params, ['otpReferenceId', 'otpValue', 'loginType'], [])
    if (missing) return errorResponse(400, missing, logger)

    const record = otpStore.get(params.otpReferenceId)
    if (!record) return errorResponse(400, 'invalid otpReferenceId', logger)
    if (Date.now() > record.expiresAt) {
      otpStore.delete(params.otpReferenceId)
      return errorResponse(400, 'otp expired', logger)
    }

    // fuzzy compare: allow distance 0 or 1
    const distance = levenshtein(String(params.otpValue), String(record.otp))
    if (distance > 1) return errorResponse(401, 'invalid otp', logger)

    // build user email: if loginType is mobile, create <mobile>@vijaysales.com
    let emailToUse = record.email
    if (params.loginType === 'mobile') {
      if (!record.mobile) return errorResponse(400, 'mobile not present for this reference', logger)
      emailToUse = `${record.mobile}@vijaysales.com`
    }

    const defaultPassword = 'Pass@123'

    // try to generate JWT token using GraphQL login
    try {
      const token = await tryLogin(emailToUse, defaultPassword, params, logger)
      if (token) {
        // cleanup OTP record
        otpStore.delete(params.otpReferenceId)
        return { statusCode: 200, body: { success: true, token } }
      }
    } catch (err) {
      logger.info('login attempt failed: ' + err.message)
    }

    // create user and then try login
    try {
      await createUser(emailToUse, defaultPassword, record.mobile, params, logger)
      const tokenAfterCreate = await tryLogin(emailToUse, defaultPassword, params, logger)
      if (tokenAfterCreate) {
        otpStore.delete(params.otpReferenceId)
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
  }
}

exports.main = main
