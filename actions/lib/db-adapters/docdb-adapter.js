/**
 * DocDB adapter — wraps @adobe/aio-lib-db to expose the unified DB interface.
 *
 * Interface contract (same for every adapter):
 *   connect(params)  → { dbClient }
 *   dbClient.collection(name)        → collection handle
 *   dbClient.createCollection(name)  → void
 *   dbClient.listCollections()       → [{ name }]
 *   dbClient.close()                 → void
 *
 *   collection.findOne(query)
 *   collection.insertOne(doc)
 *   collection.updateOne(filter, update, options)
 *   collection.deleteOne(filter)
 *   collection.createIndex(fields, options)
 *   collection.getIndexes()
 */

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const libDB = require('@adobe/aio-lib-db')

async function connect (params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const namespace = params.AIO_runtime_namespace || process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE

  let token = params.AIO_DB_TOKEN
  if (!token) {
    const tokenResponse = await generateAccessToken(params)
    token = tokenResponse.access_token
  }
  if (!token) throw new Error('database token missing (IMS credentials not available)')

  const db = await libDB.init({ region, token, namespace })
  const rawClient = await db.connect()

  // Wrap so that the public surface is uniform
  const dbClient = {
    collection: (name) => rawClient.collection(name),
    createCollection: (name) => rawClient.createCollection(name),
    listCollections: () => rawClient.listCollections(),
    close: () => rawClient.close()
  }

  return { dbClient }
}

module.exports = { connect }
