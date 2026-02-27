const { Core } = require('@adobe/aio-sdk')
const libDB = require('@adobe/aio-lib-db')
const { errorResponse, stringParameters } = require('../utils')

const CONFIG_ID = 'app_config'
const COLLECTION_NAME = 'app_config'
const DEFAULT_OTP_EXPIRATION_VALIDITY = 5

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
      const config = await collection.findOne({ _id: CONFIG_ID })
      return {
        statusCode: 200,
        body: {
          is_enabled: Boolean(config && config.is_enabled),
          otp_expiration_validity: Number.isInteger(config && config.otp_expiration_validity)
            ? config.otp_expiration_validity
            : DEFAULT_OTP_EXPIRATION_VALIDITY
        }
      }
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const rawValue = params.is_enabled
      const rawOtpValidity = params.otp_expiration_validity
      const hasIsEnabled = typeof rawValue === 'boolean'
      const hasOtpValidity = Number.isInteger(rawOtpValidity)

      if (!hasIsEnabled && !hasOtpValidity) {
        return errorResponse(400, 'Provide is_enabled (boolean) and/or otp_expiration_validity (integer minutes)', logger)
      }

      if (rawValue !== undefined && typeof rawValue !== 'boolean') {
        return errorResponse(400, 'is_enabled must be boolean true/false', logger)
      }

      if (rawOtpValidity !== undefined && (!Number.isInteger(rawOtpValidity) || rawOtpValidity <= 0)) {
        return errorResponse(400, 'otp_expiration_validity must be a positive integer (minutes)', logger)
      }

      const updateFields = {
        updatedAt: Date.now()
      }

      if (hasIsEnabled) {
        updateFields.is_enabled = rawValue
      }

      if (hasOtpValidity) {
        updateFields.otp_expiration_validity = rawOtpValidity
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
            : DEFAULT_OTP_EXPIRATION_VALIDITY
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