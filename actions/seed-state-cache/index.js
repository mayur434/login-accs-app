/**
 * seed-state-cache action
 *
 * Seeds aio-lib-state with app_config and IMS token after deployment.
 * Ensures cold-start actions skip DB + IMS calls by reading from state.
 *
 * Can also be invoked manually: aio rt action invoke login-module/seed-state-cache --result
 */

const { Core } = require('@adobe/aio-sdk')
const { getCollection, closeDb, normalizeAppConfig, findOneOrNull, putConfigToState, APP_CONFIG_ID, APP_CONFIG_COLLECTION, APP_CONFIG_DEFAULTS } = require('../../lib/db')
const { getAioDbToken } = require('../../lib/imsHelper')

async function main (params) {
  const logger = Core.Logger('seed-state-cache', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const results = []

  try {
    // 1. Seed IMS token (getAioDbToken now caches in state automatically)
    const aioDbToken = await getAioDbToken(params)
    results.push('ims_token: cached')

    // 2. Seed app_config
    const { dbClient: connectedClient, collection } = await getCollection(
      { ...params, AIO_DB_TOKEN: aioDbToken },
      APP_CONFIG_COLLECTION
    )
    dbClient = connectedClient

    let config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })

    if (!config) {
      config = { _id: APP_CONFIG_ID, ...APP_CONFIG_DEFAULTS, updatedAt: Date.now() }
      try {
        await collection.insertOne(config)
      } catch (_) {
        config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
      }
    }

    const normalized = normalizeAppConfig(config)
    await putConfigToState(normalized)
    results.push('app_config: cached')

    logger.info('State cache seeded: ' + results.join(', '))
    return { statusCode: 200, body: { success: true, seeded: results } }
  } catch (error) {
    logger.error('Failed to seed state cache: ' + error.message)
    return { statusCode: 500, body: { error: error.message, seeded: results } }
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main
