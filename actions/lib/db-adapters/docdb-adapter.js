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

// Module-level cache — reused across warm container invocations
let cachedClient = null
let cachedNamespace = ''
let cachedRegion = ''
let lastConnectTime = 0
const MAX_CONNECTION_AGE_MS = 10 * 60 * 1000 // 10 minutes

async function connect (params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const namespace = params.AIO_runtime_namespace || process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE

  // Reuse cached connection if same namespace/region and not too old
  if (cachedClient && cachedNamespace === namespace && cachedRegion === region) {
    const age = Date.now() - lastConnectTime
    if (age < MAX_CONNECTION_AGE_MS) {
      const dbClient = {
        _rawDbClient: cachedClient,
        collection: (name) => cachedClient.collection(name),
        createCollection: (name) => cachedClient.createCollection(name),
        listCollections: () => cachedClient.listCollections(),
        close: () => {}
      }
      return { dbClient }
    }
    // Connection too old, recreate
    try { await cachedClient.close() } catch (_) {}
    cachedClient = null
  }

  let token = params.AIO_DB_TOKEN
  if (!token) {
    const tokenResponse = await generateAccessToken(params)
    token = tokenResponse.access_token
  }
  if (!token) throw new Error('database token missing (IMS credentials not available)')

  const db = await libDB.init({ region, token, ow: { namespace } })
  const rawClient = await db.connect()

  // Cache the connection
  cachedClient = rawClient
  cachedNamespace = namespace
  cachedRegion = region
  lastConnectTime = Date.now()

  const dbClient = {
    _rawDbClient: rawClient,
    collection: (name) => rawClient.collection(name),
    createCollection: (name) => rawClient.createCollection(name),
    listCollections: () => rawClient.listCollections(),
    close: () => {} // Don't close cached connection
  }

  return { dbClient }
}

module.exports = { connect }
