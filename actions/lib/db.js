/**
 * Shared database connection and query helpers.
 *
 * The concrete database backend (DocDB or MySQL) is selected by the DB_TYPE
 * environment variable (default: 'docdb').  All consumers use the same
 * interface — the adapter layer handles translation.
 */

const { getAdapter } = require('./db-adapters')
const { dbStart, dbEnd } = require('./logger')

const APP_CONFIG_ID = 'app_config'
const APP_CONFIG_COLLECTION = 'app_config'

/**
 * Wrap a raw collection handle so every DB operation is logged with
 * start/end timestamps and a unique traceId.
 */
function wrapCollectionWithLogging (rawCollection, collectionName, logger, parentTraceId) {
  if (!logger || !parentTraceId) return rawCollection

  function wrap (opName) {
    return async function (...args) {
      const details = {}
      if (opName === 'findOne') details.query = args[0]
      if (opName === 'insertOne') details.document = Object.keys(args[0] || {})
      if (opName === 'updateOne') { details.filter = args[0]; details.update = args[1] ? Object.keys(args[1]) : undefined; details.options = args[2] }
      if (opName === 'deleteOne') details.filter = args[0]
      if (opName === 'createIndex') { details.fields = args[0]; details.options = args[1] }

      const dbTraceId = dbStart(logger, parentTraceId, opName, collectionName, details)
      try {
        const result = await rawCollection[opName](...args)
        dbEnd(logger, dbTraceId, parentTraceId, opName, collectionName, { success: true })
        return result
      } catch (err) {
        dbEnd(logger, dbTraceId, parentTraceId, opName, collectionName, { success: false, error: err.message })
        throw err
      }
    }
  }

  return {
    findOne: wrap('findOne'),
    insertOne: wrap('insertOne'),
    updateOne: wrap('updateOne'),
    deleteOne: wrap('deleteOne'),
    createIndex: rawCollection.createIndex ? wrap('createIndex') : undefined,
    getIndexes: rawCollection.getIndexes ? rawCollection.getIndexes.bind(rawCollection) : undefined
  }
}

/**
 * Wrap a dbClient so that every collection() call returns a logged collection.
 */
function wrapDbClientWithLogging (dbClient, logger, parentTraceId) {
  if (!logger || !parentTraceId) return dbClient

  const origCollection = dbClient.collection.bind(dbClient)
  return {
    ...dbClient,
    collection: (name) => {
      const raw = origCollection(name)
      return wrapCollectionWithLogging(raw, name, logger, parentTraceId)
    },
    close: dbClient.close ? dbClient.close.bind(dbClient) : () => {}
  }
}

/**
 * Opens a DB connection and returns { dbClient }.
 * Callers must close dbClient when done.
 *
 * The adapter is chosen by DB_TYPE env var ('docdb' | 'mysql').
 *
 * @param {object} params
 * @param {object} [opts]              – optional logging context
 * @param {object} [opts.logger]       – Core.Logger instance
 * @param {string} [opts.traceId]      – action-level traceId for correlation
 */
async function connectDb (params, opts = {}) {
  const adapter = getAdapter(params)
  let { dbClient } = await adapter.connect(params)
  if (opts.logger && opts.traceId) {
    dbClient = wrapDbClientWithLogging(dbClient, opts.logger, opts.traceId)
  }
  return { dbClient }
}

/**
 * Convenience: open connection + get one collection.
 *
 * @param {object} params
 * @param {string} collectionName
 * @param {object} [opts]              – optional logging context
 * @param {object} [opts.logger]       – Core.Logger instance
 * @param {string} [opts.traceId]      – action-level traceId for correlation
 */
async function getCollection (params, collectionName, opts = {}) {
  const { dbClient } = await connectDb(params, opts)
  const collection = await dbClient.collection(collectionName)
  return { dbClient, collection }
}

/**
 * Safely close a DB client, swallowing errors.
 */
async function closeDb (dbClient, logger) {
  try {
    if (dbClient) await dbClient.close()
  } catch (e) {
    if (logger && typeof logger.debug === 'function') {
      logger.debug('error closing DB client: ' + e.message)
    }
  }
}

// ── Error classification ────────────────────────────────────────────────

function isDocumentNotFoundError (error) {
  const message = String(error?.message ?? '').toLowerCase()
  return message.includes('document not found') || message.includes('not found')
}

function isCollectionNotFoundError (error) {
  const message = String(error?.message ?? '').toLowerCase()
  return (
    error?.code === 'ER_NO_SUCH_TABLE' ||
    error?.errno === 1146 ||
    message.includes('collection not found') ||
    message.includes('does not exist') ||
    message.includes("doesn't exist")
  )
}

function isUniqueConstraintError (error) {
  const message = String(error?.message ?? '').toLowerCase()
  return (
    error?.code === 11000 ||
    error?.code === 'ER_DUP_ENTRY' ||
    error?.errno === 1062 ||
    message.includes('duplicate key') ||
    message.includes('duplicate entry') ||
    message.includes('already exists') ||
    message.includes('unique')
  )
}

function isUnauthorizedDbError (error) {
  const status = error?.status || error?.response?.status
  return status === 401 || status === 403
}

// ── Query helpers ───────────────────────────────────────────────────────

async function findOneOrNull (collection, query, logger) {
  try {
    return await collection.findOne(query)
  } catch (error) {
    if (isDocumentNotFoundError(error)) return null

    if (logger) {
      logger.error('DB findOne failed', {
        status: error?.status || error?.response?.status || null,
        payload: error?.response?.data || error?.message || 'unknown error',
        query
      })
    }

    if (isUnauthorizedDbError(error)) {
      throw new Error(`DB unauthorized (${error?.status || error?.response?.status})`)
    }

    throw error
  }
}

// ── App config helpers ──────────────────────────────────────────────────

const APP_CONFIG_DEFAULTS = {
  is_enabled: false,
  otp_expiration_validity: 10,
  otp_in_response: false,
  auto_register: false,
  allow_key_info_update: false,
  // SMS communication
  sms_api_host: '',
  sms_endpoint: '',
  sms_api_key: '',
  sms_sender_id: '',
  sms_type: 'OTP',
  sms_fallback_enabled: false,
  sms_ics_api_host: 'https://sms.sendmsg.in',
  sms_ics_endpoint: '/smpp',
  sms_ics_username: '',
  sms_ics_password: '',
  sms_ics_sender: '',
  sms_ics_urlshortening: '1',
  sms_template_enabled: false,
  sms_template_id: '',
  sms_template_string: 'Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.',
  // Email communication
  email_smtp_host: '',
  email_smtp_port: 587,
  email_smtp_user: '',
  email_smtp_password: '',
  email_from_address: '',
  email_from_name: '',
  email_subject: 'Your OTP for Vijay Sales',
  email_template_enabled: false,
  email_template_id: '',
  email_template_string: 'Your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes.'
}

function normalizeAppConfig (config) {
  const autoRegister = typeof config?.auto_register === 'boolean'
    ? config.auto_register
    : APP_CONFIG_DEFAULTS.auto_register

  const str = (key) => (typeof config?.[key] === 'string' ? config[key] : APP_CONFIG_DEFAULTS[key])
  const bool = (key) => (typeof config?.[key] === 'boolean' ? config[key] : APP_CONFIG_DEFAULTS[key])
  const int = (key) => (Number.isInteger(config?.[key]) ? config[key] : APP_CONFIG_DEFAULTS[key])

  return {
    is_enabled: Boolean(config?.is_enabled),
    otp_expiration_validity: int('otp_expiration_validity'),
    otp_in_response: bool('otp_in_response'),
    auto_register: autoRegister,
    auto_login: autoRegister, // backward compat alias for Admin UI
    allow_key_info_update: bool('allow_key_info_update'),
    // SMS
    sms_api_host: str('sms_api_host'),
    sms_endpoint: str('sms_endpoint'),
    sms_api_key: str('sms_api_key'),
    sms_sender_id: str('sms_sender_id'),
    sms_type: str('sms_type'),
    sms_fallback_enabled: bool('sms_fallback_enabled'),
    sms_ics_api_host: str('sms_ics_api_host'),
    sms_ics_endpoint: str('sms_ics_endpoint'),
    sms_ics_username: str('sms_ics_username'),
    sms_ics_password: str('sms_ics_password'),
    sms_ics_sender: str('sms_ics_sender'),
    sms_ics_urlshortening: str('sms_ics_urlshortening'),
    sms_template_enabled: bool('sms_template_enabled'),
    sms_template_id: str('sms_template_id'),
    sms_template_string: str('sms_template_string'),
    // Email
    email_smtp_host: str('email_smtp_host'),
    email_smtp_port: int('email_smtp_port'),
    email_smtp_user: str('email_smtp_user'),
    email_smtp_password: str('email_smtp_password'),
    email_from_address: str('email_from_address'),
    email_from_name: str('email_from_name'),
    email_subject: str('email_subject'),
    email_template_enabled: bool('email_template_enabled'),
    email_template_id: str('email_template_id'),
    email_template_string: str('email_template_string')
  }
}

/**
 * Read app_config from a connected dbClient (creates collection handle internally).
 * Tables/collections must already exist — run `npm run setup-db` first.
 */
async function getAppConfig (dbClient) {
  const collection = await dbClient.collection(APP_CONFIG_COLLECTION)

  let config = null
  try {
    config = await collection.findOne({ _id: APP_CONFIG_ID })
  } catch (error) {
    if (!isDocumentNotFoundError(error)) throw error
  }

  if (!config) {
    const defaultConfig = {
      _id: APP_CONFIG_ID,
      ...APP_CONFIG_DEFAULTS,
      updatedAt: Date.now()
    }

    try {
      await collection.insertOne(defaultConfig)
      config = defaultConfig
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      config = await collection.findOne({ _id: APP_CONFIG_ID })
    }
  }

  return normalizeAppConfig(config)
}

/**
 * Throws a 403 error when the OTP module is disabled in app_config.
 */
async function assertModuleEnabled (dbClient) {
  const appConfig = await getAppConfig(dbClient)
  if (!appConfig.is_enabled) {
    throw Object.assign(new Error('otp module is disabled'), { statusCode: 403 })
  }
  return appConfig
}

module.exports = {
  connectDb,
  getCollection,
  closeDb,
  wrapCollectionWithLogging,
  wrapDbClientWithLogging,
  isDocumentNotFoundError,
  isCollectionNotFoundError,
  isUniqueConstraintError,
  isUnauthorizedDbError,
  findOneOrNull,
  getAppConfig,
  assertModuleEnabled,
  normalizeAppConfig,
  APP_CONFIG_ID,
  APP_CONFIG_COLLECTION,
  APP_CONFIG_DEFAULTS
}
