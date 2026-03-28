/**
 * Shared database connection and query helpers.
 *
 * The concrete database backend (DocDB or MySQL) is selected by the DB_TYPE
 * environment variable (default: 'docdb').  All consumers use the same
 * interface — the adapter layer handles translation.
 */

const { getAdapter } = require('./db-adapters')

const APP_CONFIG_ID = 'app_config'
const APP_CONFIG_COLLECTION = 'app_config'

/**
 * Opens a DB connection and returns { dbClient }.
 * Callers must close dbClient when done.
 *
 * The adapter is chosen by DB_TYPE env var ('docdb' | 'mysql').
 */
async function connectDb (params) {
  const adapter = getAdapter(params)
  return adapter.connect(params)
}

/**
 * Convenience: open connection + get one collection.
 */
async function getCollection (params, collectionName) {
  const { dbClient } = await connectDb(params)
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
  allow_key_info_update: false
}

function normalizeAppConfig (config) {
  return {
    is_enabled: Boolean(config?.is_enabled),
    otp_expiration_validity: Number.isInteger(config?.otp_expiration_validity)
      ? config.otp_expiration_validity
      : APP_CONFIG_DEFAULTS.otp_expiration_validity,
    otp_in_response: typeof config?.otp_in_response === 'boolean'
      ? config.otp_in_response
      : APP_CONFIG_DEFAULTS.otp_in_response,
    auto_register: typeof config?.auto_register === 'boolean'
      ? config.auto_register
      : APP_CONFIG_DEFAULTS.auto_register,
    allow_key_info_update: typeof config?.allow_key_info_update === 'boolean'
      ? config.allow_key_info_update
      : APP_CONFIG_DEFAULTS.allow_key_info_update
  }
}

/**
 * Read app_config from a connected dbClient (creates collection handle internally).
 */
async function getAppConfig (dbClient) {
  let collection
  try {
    collection = await dbClient.collection(APP_CONFIG_COLLECTION)
  } catch (error) {
    if (!isCollectionNotFoundError(error)) throw error
    await dbClient.createCollection(APP_CONFIG_COLLECTION)
    collection = await dbClient.collection(APP_CONFIG_COLLECTION)
  }

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

module.exports = {
  connectDb,
  getCollection,
  closeDb,
  isDocumentNotFoundError,
  isCollectionNotFoundError,
  isUniqueConstraintError,
  isUnauthorizedDbError,
  findOneOrNull,
  getAppConfig,
  normalizeAppConfig,
  APP_CONFIG_ID,
  APP_CONFIG_COLLECTION,
  APP_CONFIG_DEFAULTS
}
