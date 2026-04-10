const { Core } = require('@adobe/aio-sdk')
const { stringParameters } = require('../utils')
const { serverError } = require('../lib/http')
const { getCollection, closeDb } = require('../lib/db')
const { CUSTOMER_IDENTITY_COLLECTION } = require('../lib/customer')
const { actionStart, actionEnd } = require('../lib/logger')

const UNIQUE_INDEXES = [
  { field: 'mobile_number', name: 'uniq_mobile_number' },
  { field: 'email', name: 'uniq_email' },
  { field: 'customer_id', name: 'uniq_customer_id' }
]

async function ensureIndexes (collection) {
  const indexNames = []
  for (const index of UNIQUE_INDEXES) {
    const indexName = await collection.createIndex(
      { [index.field]: 1 },
      { unique: true, name: index.name }
    )
    indexNames.push(indexName)
  }
  return indexNames
}

async function main (params) {
  const logger = Core.Logger('init-identity', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = actionStart(logger, 'init-identity')

  try {
    logger.debug(stringParameters(params))

    const { dbClient: connectedClient, collection } = await getCollection(params, CUSTOMER_IDENTITY_COLLECTION, { logger, traceId })
    dbClient = connectedClient

    const indexes = await ensureIndexes(collection)

    actionEnd(logger, traceId, 'init-identity', { statusCode: 200 })
    return {
      statusCode: 200,
      body: {
        success: true,
        collection: CUSTOMER_IDENTITY_COLLECTION,
        indexes
      }
    }
  } catch (error) {
    logger.error(error)
    actionEnd(logger, traceId, 'init-identity', { statusCode: 500, error: error.message })
    return serverError('failed to initialize customer_mobile_identity collection')
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main