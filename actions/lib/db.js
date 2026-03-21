/**
 * Shared database connection and query helpers for Adobe Doc DB.
 */

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const libDB = require('@adobe/aio-lib-db')

const APP_CONFIG_ID = 'app_config'
const APP_CONFIG_COLLECTION = 'app_config'

/**
 * Opens a DB connection and returns { dbClient, db }.
 * Callers must close dbClient when done.
 *
 * Token resolution order:
 *   1. params.AIO_DB_TOKEN  (pre-generated IMS token)
 *   2. generateAccessToken(params)  (IMS OAuth S2S)
 */
async function connectDb (params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'

  let token = params.AIO_DB_TOKEN
  if (!token) {
    const tokenResponse = await generateAccessToken(params)
    token = tokenResponse.access_token
  }
  if (!token) throw new Error('database token missing (IMS credentials not available)')

  const db = await libDB.init({ region, token })
  const dbClient = await db.connect()
  return { dbClient }
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

function isUniqueConstraintError (error) {
  const message = String(error?.message ?? '').toLowerCase()
  return (
    error?.code === 11000 ||
    message.includes('duplicate key') ||
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
      logger.error('Doc DB findOne failed', {
        status: error?.status || error?.response?.status || null,
        payload: error?.response?.data || error?.message || 'unknown error',
        query
      })
    }

    if (isUnauthorizedDbError(error)) {
      throw new Error(`Doc DB unauthorized (${error?.status || error?.response?.status})`)
    }

    throw error
  }
}

// ── App config helpers ──────────────────────────────────────────────────

const APP_CONFIG_DEFAULTS = {
  is_enabled: false,
  otp_expiration_validity: 5,
  otp_in_response: false,
  auto_login: false,
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
    auto_login: typeof config?.auto_login === 'boolean'
      ? config.auto_login
      : APP_CONFIG_DEFAULTS.auto_login,
    allow_key_info_update: typeof config?.allow_key_info_update === 'boolean'
      ? config.allow_key_info_update
      : APP_CONFIG_DEFAULTS.allow_key_info_update
  }
}

/**
 * Read app_config from a connected dbClient (creates collection handle internally).
 */
async function getAppConfig (dbClient) {
  const collection = await dbClient.collection(APP_CONFIG_COLLECTION)
  const config = await collection.findOne({ _id: APP_CONFIG_ID })
  return normalizeAppConfig(config)
}

module.exports = {
  connectDb,
  getCollection,
  closeDb,
  isDocumentNotFoundError,
  isUniqueConstraintError,
  isUnauthorizedDbError,
  findOneOrNull,
  getAppConfig,
  normalizeAppConfig,
  APP_CONFIG_ID,
  APP_CONFIG_COLLECTION,
  APP_CONFIG_DEFAULTS
}
