const { Core } = require('@adobe/aio-sdk')
const { getRequestParams } = require('../lib/params')
const { stringParameters } = require('../utils')
const { success, badRequest, methodNotAllowed, serverError } = require('../lib/http')
const { getAioDbToken } = require('../lib/imsHelper')
const {
  getCollection, closeDb, normalizeAppConfig, findOneOrNull,
  APP_CONFIG_ID, APP_CONFIG_COLLECTION, APP_CONFIG_DEFAULTS
} = require('../lib/db')

// ── Validation ──────────────────────────────────────────────────────────

function validateUpdatePayload (params) {
  // Backward compatibility: accept auto_login and map to auto_register
  const autoRegisterValue = params.auto_register !== undefined ? params.auto_register : params.auto_login

  const fields = {
    is_enabled: { value: params.is_enabled, type: 'boolean' },
    otp_expiration_validity: { value: params.otp_expiration_validity, type: 'integer' },
    otp_in_response: { value: params.otp_in_response, type: 'boolean' },
    auto_register: { value: autoRegisterValue, type: 'boolean' },
    allow_key_info_update: { value: params.allow_key_info_update, type: 'boolean' },
    // SMS communication
    sms_api_host: { value: params.sms_api_host, type: 'string' },
    sms_endpoint: { value: params.sms_endpoint, type: 'string' },
    sms_api_key: { value: params.sms_api_key, type: 'string' },
    sms_template_enabled: { value: params.sms_template_enabled, type: 'boolean' },
    sms_template_id: { value: params.sms_template_id, type: 'string' },
    sms_template_string: { value: params.sms_template_string, type: 'string' },
    // Email communication
    email_smtp_host: { value: params.email_smtp_host, type: 'string' },
    email_smtp_port: { value: params.email_smtp_port, type: 'integer' },
    email_smtp_user: { value: params.email_smtp_user, type: 'string' },
    email_smtp_password: { value: params.email_smtp_password, type: 'string' },
    email_from_address: { value: params.email_from_address, type: 'string' },
    email_from_name: { value: params.email_from_name, type: 'string' },
    email_template_enabled: { value: params.email_template_enabled, type: 'boolean' },
    email_template_id: { value: params.email_template_id, type: 'string' },
    email_template_string: { value: params.email_template_string, type: 'string' }
  }

  const provided = {}
  const errors = []

  for (const [key, { value, type }] of Object.entries(fields)) {
    if (value === undefined) continue

    if (type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`${key} must be boolean true/false`)
    } else if (type === 'integer' && (!Number.isInteger(value) || value <= 0)) {
      errors.push(`${key} must be a positive integer`)
    } else if (type === 'string' && typeof value !== 'string') {
      errors.push(`${key} must be a string`)
    } else {
      provided[key] = value
    }
  }

  if (errors.length) return { error: badRequest(errors.join('; ')) }

  if (Object.keys(provided).length === 0) {
    return {
      error: badRequest('Provide at least one configuration field to update')
    }
  }

  const updateFields = {
    ...provided,
    updatedAt: Date.now()
  }

  return { updateFields }
}

// ── Migrate legacy docs that may be missing newer boolean fields ────────

async function getDocDbConfig (collection) {
  let config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })

  if (!config) return normalizeAppConfig(null)

  const patchFields = {}
  // Normalize: migrate legacy auto_login field to auto_register
  if (config.auto_login !== undefined && config.auto_register === undefined) {
    patchFields.auto_register = config.auto_login
  }

  for (const key of ['otp_in_response', 'auto_register', 'allow_key_info_update', 'sms_template_enabled', 'email_template_enabled']) {
    if (typeof config[key] !== 'boolean') {
      patchFields[key] = APP_CONFIG_DEFAULTS[key]
    }
  }

  if (Object.keys(patchFields).length) {
    await collection.updateOne(
      { _id: APP_CONFIG_ID },
      { $set: { ...patchFields, updatedAt: Date.now() } },
      { upsert: true }
    )
    config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
  }

  return normalizeAppConfig(config)
}

// ── Main ────────────────────────────────────────────────────────────────

async function main (params) {
  const logger = Core.Logger('app_config', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.info('app_config action called')
    logger.debug(stringParameters(params))
    const inParams = getRequestParams(params)
    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}
    const headers = inParams.__ow_headers || {}
    const aioDbToken = await getAioDbToken(inParams)

    const method = ((params.__ow_method || headers['x-http-method-override'] || 'GET') + '').toUpperCase()
    const { dbClient: connectedClient, collection } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      APP_CONFIG_COLLECTION
    )
    dbClient = connectedClient

    if (method === 'GET') {
      return success(await getDocDbConfig(collection))
    }

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const { error, updateFields } = validateUpdatePayload(inParams)
      if (error) return error

      await collection.updateOne(
        { _id: APP_CONFIG_ID },
        { $set: updateFields },
        { upsert: true }
      )

      const updatedConfig = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
      return success(normalizeAppConfig(updatedConfig))
    }

    if (method === 'DELETE') {
      await collection.deleteOne({ _id: APP_CONFIG_ID })
      return success({ success: true, message: 'app_config deleted' })
    }

    return methodNotAllowed(`method ${method} not allowed`)
  } catch (error) {
    logger.error(error)
    return serverError()
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
