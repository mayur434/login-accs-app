const { runAction } = require('../../lib/actionRunner')
const { success, badRequest, methodNotAllowed, serverError } = require('../../lib/http')
const {
  normalizeAppConfig, findOneOrNull,
  APP_CONFIG_ID, APP_CONFIG_COLLECTION, APP_CONFIG_DEFAULTS, invalidateAppConfigCache,
  putConfigToState
} = require('../../lib/db')

// ── Validation ──────────────────────────────────────────────────────────

function validateUpdatePayload (params) {
  const autoRegisterValue = params.auto_register !== undefined ? params.auto_register : params.auto_login

  const fields = {
    is_enabled: { value: params.is_enabled, type: 'boolean' },
    otp_expiration_validity: { value: params.otp_expiration_validity, type: 'integer' },
    otp_in_response: { value: params.otp_in_response, type: 'boolean' },
    auto_register: { value: autoRegisterValue, type: 'boolean' },
    allow_key_info_update: { value: params.allow_key_info_update, type: 'boolean' },
    sms_api_host: { value: params.sms_api_host, type: 'string' },
    sms_endpoint: { value: params.sms_endpoint, type: 'string' },
    sms_api_key: { value: params.sms_api_key, type: 'string' },
    sms_sender_id: { value: params.sms_sender_id, type: 'string' },
    sms_type: { value: params.sms_type, type: 'string' },
    sms_fallback_enabled: { value: params.sms_fallback_enabled, type: 'boolean' },
    sms_ics_api_host: { value: params.sms_ics_api_host, type: 'string' },
    sms_ics_endpoint: { value: params.sms_ics_endpoint, type: 'string' },
    sms_ics_username: { value: params.sms_ics_username, type: 'string' },
    sms_ics_password: { value: params.sms_ics_password, type: 'string' },
    sms_ics_sender: { value: params.sms_ics_sender, type: 'string' },
    sms_ics_urlshortening: { value: params.sms_ics_urlshortening, type: 'string' },
    sms_template_enabled: { value: params.sms_template_enabled, type: 'boolean' },
    sms_template_id: { value: params.sms_template_id, type: 'string' },
    sms_template_string: { value: params.sms_template_string, type: 'string' },
    email_smtp_host: { value: params.email_smtp_host, type: 'string' },
    email_smtp_port: { value: params.email_smtp_port, type: 'integer' },
    email_smtp_user: { value: params.email_smtp_user, type: 'string' },
    email_smtp_password: { value: params.email_smtp_password, type: 'string' },
    email_from_address: { value: params.email_from_address, type: 'string' },
    email_from_name: { value: params.email_from_name, type: 'string' },
    email_subject: { value: params.email_subject, type: 'string' },
    email_template_enabled: { value: params.email_template_enabled, type: 'boolean' },
    email_template_id: { value: params.email_template_id, type: 'string' },
    email_template_string: { value: params.email_template_string, type: 'string' },
    google_sso_enabled: { value: params.google_sso_enabled, type: 'boolean' },
    google_client_id: { value: params.google_client_id, type: 'string' },
    google_client_secret: { value: params.google_client_secret, type: 'string' },
    perf_logging: { value: params.perf_logging, type: 'boolean' }
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
  if (Object.keys(provided).length === 0) return { error: badRequest('Provide at least one configuration field to update') }

  return { updateFields: { ...provided, updatedAt: Date.now() } }
}

function sanitizeConfigForResponse (config) {
  if (!config) return config
  const out = { ...config }
  out.sms_api_key_configured = !!out.sms_api_key
  out.sms_ics_password_configured = !!out.sms_ics_password
  out.email_smtp_password_configured = !!out.email_smtp_password
  out.google_client_secret_configured = !!out.google_client_secret
  out.sms_api_key = ''
  out.sms_ics_password = ''
  out.email_smtp_password = ''
  out.google_client_secret = ''
  return out
}

async function getDocDbConfig (collection) {
  let config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
  if (!config) return normalizeAppConfig(null)

  const patchFields = {}
  if (config.auto_login !== undefined && config.auto_register === undefined) {
    patchFields.auto_register = config.auto_login
  }
  for (const key of ['otp_in_response', 'auto_register', 'allow_key_info_update', 'sms_template_enabled', 'email_template_enabled', 'sms_fallback_enabled', 'google_sso_enabled']) {
    if (config[key] === undefined || config[key] === null) {
      patchFields[key] = APP_CONFIG_DEFAULTS[key]
    }
  }

  if (Object.keys(patchFields).length) {
    await collection.updateOne({ _id: APP_CONFIG_ID }, { $set: { ...patchFields, updatedAt: Date.now() } }, { upsert: true })
    config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
  }

  return normalizeAppConfig(config)
}

// ── Main ────────────────────────────────────────────────────────────────

exports.main = runAction('app_config', APP_CONFIG_COLLECTION, async ({ params, dbClient, logger }) => {
  const method = ((params.__ow_method || (params.__ow_headers || {})['x-http-method-override'] || 'GET') + '').toUpperCase()
  const collection = await dbClient.collection(APP_CONFIG_COLLECTION)

  if (method === 'GET') {
    return success(sanitizeConfigForResponse(await getDocDbConfig(collection)))
  }

  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    const { error, updateFields } = validateUpdatePayload(params)
    if (error) return error

    await collection.updateOne({ _id: APP_CONFIG_ID }, { $set: updateFields }, { upsert: true })
    invalidateAppConfigCache()

    const updatedConfig = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
    const normalized = normalizeAppConfig(updatedConfig)
    await putConfigToState(normalized)
    return success(sanitizeConfigForResponse(normalized))
  }

  if (method === 'DELETE') {
    await collection.deleteOne({ _id: APP_CONFIG_ID })
    invalidateAppConfigCache()
    return success({ success: true, message: 'app_config deleted' })
  }

  return methodNotAllowed(`method ${method} not allowed`)
}, { requireModule: false })
