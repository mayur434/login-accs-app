const { Core } = require('@adobe/aio-sdk')
const { stringParameters } = require('../utils')
const { serverError } = require('../lib/http')
const { getCollection, closeDb } = require('../lib/db')
const { CUSTOMER_IDENTITY_COLLECTION } = require('../lib/customer')

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

  try {
    logger.debug(stringParameters(params))

    const { dbClient: connectedClient, collection } = await getCollection(params, CUSTOMER_IDENTITY_COLLECTION)
    dbClient = connectedClient

    const indexes = await ensureIndexes(collection)

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
    return serverError('failed to initialize customer_mobile_identity collection')
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main