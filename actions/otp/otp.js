const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const { stringParameters, checkMissingRequestInputs } = require('../utils')
const { errorResponse } = require('../lib/http')
const { getCollection, closeDb, getAppConfig, APP_CONFIG_DEFAULTS } = require('../lib/db')
const { graphQLRequest } = require('../lib/graphql')
const { generateOtpValue, createReferenceId, levenshtein } = require('../lib/otp')
const { getRequestParams } = require('../lib/params')
const { INTERNAL_CUSTOMER_PASSWORD } = require('../lib/customer')

// ── Commerce helpers ────────────────────────────────────────────────────

async function tryLogin (email, password, params, logger) {
  const mutation = `mutation generateCustomerToken($email: String!){ generateCustomerToken(email: $email, password: "${INTERNAL_CUSTOMER_PASSWORD}"){ token } }`
  try {
    const resp = await graphQLRequest(params, mutation, { email }, logger)
    if (resp?.data?.generateCustomerToken?.token) return resp.data.generateCustomerToken.token
  } catch (e) {
    logger.debug && logger.debug('generateCustomerToken attempt failed: ' + e.message)
  }
  return null
}

async function createUser (email, password, mobile, params, logger) {
  const firstname = params.firstname || params.firstName || (typeof email === 'string' ? email.split('@')[0] : 'Customer')
  const lastname = params.lastname || params.lastName || (mobile ? String(mobile) : 'User')
  const mutation = `mutation createCustomerV2($email: String!, $firstname: String!, $lastname: String!){ createCustomerV2(input:{ firstname: $firstname, lastname: $lastname, email: $email, password: "${INTERNAL_CUSTOMER_PASSWORD}" }){ customer{ firstname lastname email } } }`
  return graphQLRequest(params, mutation, { email, firstname, lastname }, logger)
}

// ── Main action ─────────────────────────────────────────────────────────

async function main (params) {
  const logger = Core.Logger('otp', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.info('OTP action called')
    const imsCredentials = {
      clientId: process.env.IMS_OAUTH_S2S_CLIENT_ID,
      clientSecret: process.env.IMS_OAUTH_S2S_CLIENT_SECRET,
      orgId: process.env.IMS_OAUTH_S2S_ORG_ID,
      scopes: process.env.IMS_OAUTH_S2S_SCOPES
    }

    let rawScopes = process.env.IMS_OAUTH_S2S_SCOPES

    if (Array.isArray(rawScopes)) {
      imsCredentials.scopes = rawScopes
    } else if (typeof rawScopes === 'string') {
      const trimmed = rawScopes.trim()
      try {
        const parsed = JSON.parse(trimmed)
        imsCredentials.scopes = Array.isArray(parsed)
          ? parsed.map(s => String(s).trim()).filter(Boolean)
          : []
      } catch (e) {
        imsCredentials.scopes = trimmed
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      }
    } else {
      imsCredentials.scopes = []
    }

    const tokenResponse = await generateAccessToken(imsCredentials)

    logger.debug('Access token obtained successfully')
    logger.debug(`Token response: ${JSON.stringify({
      accessTokenPresent: !!tokenResponse.access_token,
      tokenType: tokenResponse.token_type,
      expiresIn: tokenResponse.expires_in
    })}`);


    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

    const dbResult = await getCollection(
      { ...inParams, AIO_DB_TOKEN: tokenResponse.access_token },
      'otps'
    )
    dbClient = dbResult.dbClient
    const otpCollection = dbResult.collection

    const appConfig = await getAppConfig(dbClient)

    if (!appConfig.is_enabled) {
      return errorResponse(403, 'otp module is disabled', logger)
    }

    const isValidate = inParams.otpValue && inParams.otpReferenceId

    if (!isValidate) {
      // ── Generate OTP ──────────────────────────────────────────────
      const requiredParams = ['loginType']
      const errorMessage = checkMissingRequestInputs(inParams, requiredParams, [])
      if (errorMessage) return errorResponse(400, errorMessage, logger)

      if (inParams.loginType === 'mobile') {
        const missing = checkMissingRequestInputs(inParams, ['mobile'], [])
        if (missing) return errorResponse(400, missing, logger)
      } else if (inParams.loginType === 'email') {
        const missing = checkMissingRequestInputs(inParams, ['email'], [])
        if (missing) return errorResponse(400, missing, logger)
      } else {
        return errorResponse(400, 'invalid loginType', logger)
      }

      let emailForLogin = inParams.email
      if (inParams.loginType === 'mobile') {
        emailForLogin = `${inParams.mobile}@email.com`
      }

      let token = null
      try {
        token = await tryLogin(emailForLogin, '', inParams, logger)
      } catch (e) {
        logger.debug && logger.debug('initial tryLogin failed: ' + e.message)
      }

      const autoLogin = !!appConfig.auto_login
      const registerFlag = (typeof inParams.register === 'string')
        ? inParams.register.toLowerCase() === 'true'
        : Boolean(inParams.register)

      if (!token) {
        if (!autoLogin && !registerFlag) {
          return errorResponse(404, 'user is not registered, kindly register first', logger)
        }

        try {
          await createUser(emailForLogin, INTERNAL_CUSTOMER_PASSWORD, inParams.mobile, inParams, logger)
          token = await tryLogin(emailForLogin, INTERNAL_CUSTOMER_PASSWORD, inParams, logger)
        } catch (e) {
          logger.error && logger.error('user creation/login failed: ' + e.message)
          return errorResponse(500, 'unable to create/login user', logger)
        }

        if (!token) {
          return errorResponse(500, 'unable to obtain token after user creation', logger)
        }
      }

      const otpValue = generateOtpValue()
      const ref = createReferenceId()
      const otpValidityMinutes = (Number.isInteger(appConfig.otp_expiration_validity) && appConfig.otp_expiration_validity > 0)
        ? appConfig.otp_expiration_validity
        : APP_CONFIG_DEFAULTS.otp_expiration_validity
      const otpInResponse = typeof appConfig.otp_in_response === 'boolean'
        ? appConfig.otp_in_response
        : APP_CONFIG_DEFAULTS.otp_in_response

      await otpCollection.insertOne({
        otpReferenceId: ref,
        otp: otpValue,
        loginType: inParams.loginType,
        mobile: inParams.mobile,
        email: inParams.email,
        createdAt: Date.now(),
        expiresAt: Date.now() + (otpValidityMinutes * 60 * 1000),
        otpExpirationValidityMinutes: otpValidityMinutes,
        token,
        tokenStoredAt: Date.now()
      })

      return {
        statusCode: 200,
        body: otpInResponse
          ? { otpReferenceId: ref, otpValue }
          : { otpReferenceId: ref }
      }
    }

    // ── Validate OTP ──────────────────────────────────────────────────
    const missing = checkMissingRequestInputs(inParams, ['otpReferenceId', 'otpValue', 'loginType'], [])
    if (missing) return errorResponse(400, missing, logger)

    const record = await otpCollection.findOne({ otpReferenceId: inParams.otpReferenceId })
    if (!record) return errorResponse(400, 'invalid otpReferenceId', logger)

    if (Date.now() > record.expiresAt) {
      await otpCollection.deleteOne({ otpReferenceId: inParams.otpReferenceId })
      return errorResponse(400, 'otp expired', logger)
    }

    const distance = levenshtein(String(inParams.otpValue), String(record.otp))
    if (distance > 1) return errorResponse(401, 'invalid otp', logger)

    let emailToUse = record.email
    if (inParams.loginType === 'mobile') {
      if (!record.mobile) return errorResponse(400, 'mobile not present for this reference', logger)
      emailToUse = `${record.mobile}@email.com`
    }

    // Try login
    try {
      const token = await tryLogin(emailToUse, INTERNAL_CUSTOMER_PASSWORD, inParams, logger)
      if (token) {
        await otpCollection.updateOne({ otpReferenceId: inParams.otpReferenceId }, { $set: { token, tokenStoredAt: Date.now() } })
        return { statusCode: 200, body: { success: true, token, message: 'otp matched' } }
      }
    } catch (err) {
      logger.info('login attempt failed: ' + err.message)
    }

    const autoLogin = !!appConfig.auto_login
    const registerFlag = (typeof inParams.register === 'string')
      ? inParams.register.toLowerCase() === 'true'
      : Boolean(inParams.register)

    if (!autoLogin && !registerFlag) {
      return errorResponse(404, 'user is not present in commerce', logger)
    }

    // Auto-create user and login
    try {
      await createUser(emailToUse, INTERNAL_CUSTOMER_PASSWORD, record.mobile, inParams, logger)
      const tokenAfterCreate = await tryLogin(emailToUse, INTERNAL_CUSTOMER_PASSWORD, inParams, logger)
      if (tokenAfterCreate) {
        await otpCollection.updateOne({ otpReferenceId: inParams.otpReferenceId }, { $set: { token: tokenAfterCreate, tokenStoredAt: Date.now() } })
        return { statusCode: 200, body: { success: true, token: tokenAfterCreate, message: 'otp matched' } }
      }
      return errorResponse(500, 'unable to obtain token after user creation', logger)
    } catch (err) {
      logger.error(err)
      return errorResponse(500, 'server error during user creation/login', logger)
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'server error', logger)
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main