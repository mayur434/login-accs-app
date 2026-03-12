const { Core } = require('@adobe/aio-sdk')
const libDB = require('@adobe/aio-lib-db')
const { errorResponse, stringParameters } = require('../utils')

const COLLECTION_NAME = 'customer_mobile_identity'
const UNIQUE_INDEXES = [
  { field: 'mobile_number', name: 'uniq_mobile_number' },
  { field: 'email', name: 'uniq_email' },
  { field: 'customer_id', name: 'uniq_customer_id' }
]

async function getCollection (params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const db = await libDB.init({ region })
  const dbClient = await db.connect()
  const collection = await dbClient.collection(COLLECTION_NAME)
  return { dbClient, collection }
}

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
  const logger = Core.Logger('customer_mobile_identity_init', { level: params.LOG_LEVEL || 'info' })
  let dbClient

  try {
    logger.debug(stringParameters(params))

    const { dbClient: connectedClient, collection } = await getCollection(params)
    dbClient = connectedClient

    const indexes = await ensureIndexes(collection)

    return {
      statusCode: 200,
      body: {
        success: true,
        collection: COLLECTION_NAME,
        indexes
      }
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, 'failed to initialize customer_mobile_identity collection', logger)
  } finally {
    try {
      if (dbClient) await dbClient.close()
    } catch (closeError) {
      logger.debug && logger.debug('error closing DB client: ' + closeError.message)
    }
  }
}

exports.main = main