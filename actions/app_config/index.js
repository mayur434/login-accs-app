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
      return {
        statusCode: 200,
        body: {
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
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const rawValue = params.is_enabled
      const rawOtpValidity = params.otp_expiration_validity
      const rawOtpInResponse = params.otp_in_response
      const rawAutoLogin = params.auto_login
      const hasIsEnabled = typeof rawValue === 'boolean'
      const hasOtpValidity = Number.isInteger(rawOtpValidity)
      const hasOtpInResponse = typeof rawOtpInResponse === 'boolean'
      const hasAutoLogin = typeof rawAutoLogin === 'boolean'

      if (!hasIsEnabled && !hasOtpValidity && !hasOtpInResponse && !hasAutoLogin) {
        return errorResponse(400, 'Provide is_enabled (boolean) and/or otp_expiration_validity (integer minutes) and/or otp_in_response (boolean) and/or auto_login (boolean)', logger)
      }

      if (rawValue !== undefined && typeof rawValue !== 'boolean') {
        return errorResponse(400, 'is_enabled must be boolean true/false', logger)
      }

      if (rawOtpValidity !== undefined && (!Number.isInteger(rawOtpValidity) || rawOtpValidity <= 0)) {
        return errorResponse(400, 'otp_expiration_validity must be a positive integer (minutes)', logger)
      }

      if (rawOtpInResponse !== undefined && typeof rawOtpInResponse !== 'boolean') {
        return errorResponse(400, 'otp_in_response must be boolean true/false', logger)
      }

      if (rawAutoLogin !== undefined && typeof rawAutoLogin !== 'boolean') {
        return errorResponse(400, 'auto_login must be boolean true/false', logger)
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
        body: {
          is_enabled: Boolean(updatedConfig && updatedConfig.is_enabled),
          otp_expiration_validity: Number.isInteger(updatedConfig && updatedConfig.otp_expiration_validity)
            ? updatedConfig.otp_expiration_validity
            : DEFAULT_OTP_EXPIRATION_VALIDITY,
          otp_in_response: typeof (updatedConfig && updatedConfig.otp_in_response) === 'boolean'
            ? updatedConfig.otp_in_response
            : DEFAULT_OTP_IN_RESPONSE,
          auto_login: typeof (updatedConfig && updatedConfig.auto_login) === 'boolean'
            ? updatedConfig.auto_login
            : DEFAULT_AUTO_LOGIN
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