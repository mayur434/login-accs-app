const { Core } = require('@adobe/aio-sdk')
const libDB = require('@adobe/aio-lib-db')
const { errorResponse, stringParameters } = require('../utils')

const CONFIG_ID = 'app_config'
const COLLECTION_NAME = 'app_config'
const DEFAULT_OTP_EXPIRATION_VALIDITY = 5
const DEFAULT_OTP_IN_RESPONSE = false
const DEFAULT_AUTO_LOGIN = false

async function getCollection (params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const db = await libDB.init({ region })
  const dbClient = await db.connect()
  const collection = await dbClient.collection(COLLECTION_NAME)
  return { dbClient, collection }
}

function normalizeConfig (config) {
  return {
    is_enabled: Boolean(config && config.is_enabled),
    otp_expiration_validity: Number.isInteger(config && config.otp_expiration_validity)
      ? config.otp_expiration_validity
      : DEFAULT_OTP_EXPIRATION_VALIDITY,
    otp_in_response: typeof (config && config.otp_in_response) === 'boolean'
      ? config.otp_in_response
      : DEFAULT_OTP_IN_RESPONSE,
    auto_login: typeof (config && config.auto_login) === 'boolean'
      ? config.auto_login
      : DEFAULT_AUTO_LOGIN
  }
}

async function getDocDbConfig (collection) {
  let config = await collection.findOne({ _id: CONFIG_ID })
  if (config && typeof config.otp_in_response !== 'boolean') {
    await collection.updateOne(
      { _id: CONFIG_ID },
      { $set: { otp_in_response: DEFAULT_OTP_IN_RESPONSE, updatedAt: Date.now() } },
      { upsert: true }
    )
    config = await collection.findOne({ _id: CONFIG_ID })
  }
  if (config && typeof config.auto_login !== 'boolean') {
    await collection.updateOne(
      { _id: CONFIG_ID },
      { $set: { auto_login: DEFAULT_AUTO_LOGIN, updatedAt: Date.now() } },
      { upsert: true }
    )
    config = await collection.findOne({ _id: CONFIG_ID })
  }
  return normalizeConfig(config)
}

function validateUpdatePayload (params, logger) {
  const rawValue = params.is_enabled
  const rawOtpValidity = params.otp_expiration_validity
  const rawOtpInResponse = params.otp_in_response
  const rawAutoLogin = params.auto_login
  const hasIsEnabled = typeof rawValue === 'boolean'
  const hasOtpValidity = Number.isInteger(rawOtpValidity)
  const hasOtpInResponse = typeof rawOtpInResponse === 'boolean'
  const hasAutoLogin = typeof rawAutoLogin === 'boolean'

  if (!hasIsEnabled && !hasOtpValidity && !hasOtpInResponse && !hasAutoLogin) {
    return { error: errorResponse(400, 'Provide is_enabled (boolean) and/or otp_expiration_validity (integer minutes) and/or otp_in_response (boolean) and/or auto_login (boolean)', logger) }
  }

  if (rawValue !== undefined && typeof rawValue !== 'boolean') {
    return { error: errorResponse(400, 'is_enabled must be boolean true/false', logger) }
  }

  if (rawOtpValidity !== undefined && (!Number.isInteger(rawOtpValidity) || rawOtpValidity <= 0)) {
    return { error: errorResponse(400, 'otp_expiration_validity must be a positive integer (minutes)', logger) }
  }

  if (rawOtpInResponse !== undefined && typeof rawOtpInResponse !== 'boolean') {
    return { error: errorResponse(400, 'otp_in_response must be boolean true/false', logger) }
  }

  if (rawAutoLogin !== undefined && typeof rawAutoLogin !== 'boolean') {
    return { error: errorResponse(400, 'auto_login must be boolean true/false', logger) }
  }

  const updateFields = {
    updatedAt: Date.now()
  }

  if (!hasOtpInResponse) {
    updateFields.otp_in_response = DEFAULT_OTP_IN_RESPONSE
  }

  if (!hasAutoLogin) {
    updateFields.auto_login = DEFAULT_AUTO_LOGIN
  }

  if (hasIsEnabled) {
    updateFields.is_enabled = rawValue
  }

  if (hasOtpValidity) {
    updateFields.otp_expiration_validity = rawOtpValidity
  }

  if (hasOtpInResponse) {
    updateFields.otp_in_response = rawOtpInResponse
  }

  if (hasAutoLogin) {
    updateFields.auto_login = rawAutoLogin
  }

  return { updateFields }
}

async function main (params) {
  const logger = Core.Logger('app_config', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.info('app_config action called')
    logger.debug(stringParameters(params))

    const method = ((params.__ow_method || params.__ow_headers?.['x-http-method-override'] || 'GET') + '').toUpperCase()
    const { dbClient: connectedClient, collection } = await getCollection(params)
    dbClient = connectedClient

    if (method === 'GET') {
      const config = await getDocDbConfig(collection)
      return {
        statusCode: 200,
        body: config
      }
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const { error, updateFields } = validateUpdatePayload(params, logger)
      if (error) {
        return error
      }

      await collection.updateOne(
        { _id: CONFIG_ID },
        {
          $set: updateFields
        },
        { upsert: true }
      )

      const updatedConfig = await collection.findOne({ _id: CONFIG_ID })

      return {
        statusCode: 200,
        body: normalizeConfig(updatedConfig)
      }
    }

    if (method === 'DELETE') {
      await collection.deleteOne({ _id: CONFIG_ID })
      return {
        statusCode: 200,
        body: {
          success: true,
          message: 'app_config deleted'
        }
      }
    }

    return errorResponse(405, `method ${method} not allowed`, logger)
  } catch (error) {
    logger.error(error)
    return errorResponse(500, 'server error', logger)
  } finally {
    try {
      if (dbClient) await dbClient.close()
    } catch (e) {
      logger.debug && logger.debug('error closing DB client: ' + e.message)
    }
  }
}

exports.main = main
