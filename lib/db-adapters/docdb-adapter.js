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
 *
 * 401 Retry: If a cached IMS token is stale, DocDB returns 401.
 * The adapter invalidates the token cache, regenerates, reconnects, and retries once.
 */

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const libDB = require('@adobe/aio-lib-db')
const { invalidateImsTokenCache, credentialFingerprint, getAioDbToken } = require('../imsHelper')

function is401Error (error) {
  const status = error?.status || error?.response?.status || error?.response?.data?.status
  const code = error?.response?.data?.error_code
  return status === 401 || code === 401013
}

function isNetworkError (error) {
  const code = error?.code || ''
  const msg = String(error?.message || '').toLowerCase()
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'EAI_AGAIN' ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  )
}

// ── Connection pool (reuse across warm invocations) ─────────────────────
let _cachedConnection = null
let _cachedConnectionKey = null

function connectionKey (token, namespace, region) {
  // Token changes on refresh; key ensures we don't reuse stale connections
  return `${region}:${namespace}:${(token || '').slice(-8)}`
}

async function connect (params) {
  const region = params.AIO_DB_REGION || process.env.AIO_DB_REGION || 'apac'
  const namespace = params.AIO_runtime_namespace || process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE

  let token = params.AIO_DB_TOKEN
  if (!token) {
    const tokenResponse = await generateAccessToken(params)
    token = tokenResponse.access_token
  }
  if (!token) throw new Error('database token missing (IMS credentials not available)')

  const key = connectionKey(token, namespace, region)

  // Reuse existing connection on warm container (same token)
  if (_cachedConnection && _cachedConnectionKey === key) {
    return { dbClient: _cachedConnection }
  }

  const db = await libDB.init({ region, token, ow: { namespace } })
  const rawClient = await db.connect()

  const MAX_TOKEN_RETRIES = Number(process.env.MAX_TOKEN_RETRIES) || 2

  /**
   * Wrap a collection method with 401 retry (max 2 attempts total).
   * On 401: invalidate token cache → get fresh token → reconnect → retry ONCE.
   * If second attempt also fails → throw immediately (no recursion).
   */
  function wrapWithRetry (collectionName, methodName, method) {
    return async function (...args) {
      let lastError
      for (let attempt = 1; attempt <= MAX_TOKEN_RETRIES; attempt++) {
        try {
          if (attempt === 1) {
            return await method(...args)
          }
          // Attempt 2: fresh token, fresh connection
          const clientId = params.IMS_OAUTH_S2S_CLIENT_ID || process.env.IMS_OAUTH_S2S_CLIENT_ID
          const clientSecret = params.IMS_OAUTH_S2S_CLIENT_SECRET || process.env.IMS_OAUTH_S2S_CLIENT_SECRET
          const orgId = params.IMS_OAUTH_S2S_ORG_ID || process.env.IMS_OAUTH_S2S_ORG_ID
          const fingerprint = credentialFingerprint(clientId, clientSecret, orgId)
          await invalidateImsTokenCache(fingerprint)

          const freshToken = await getAioDbToken(params)
          const freshDb = await libDB.init({ region, token: freshToken, ow: { namespace } })
          const freshClient = await freshDb.connect()
          // Invalidate cached connection since token changed
          _cachedConnection = null
          _cachedConnectionKey = null
          const freshCol = freshClient.collection(collectionName)
          return await freshCol[methodName](...args)
        } catch (error) {
          lastError = error
          // Stale cached connection (network error) → invalidate and retry
          if (isNetworkError(error) && attempt === 1) {
            _cachedConnection = null
            _cachedConnectionKey = null
            // Fall through to attempt 2 (fresh connection)
          } else if (!is401Error(error) || attempt === MAX_TOKEN_RETRIES) {
            throw error
          }
          // 401 or network error on attempt 1 → will retry
        }
      }
      throw lastError
    }
  }

  function wrapCollection (name) {
    const col = rawClient.collection(name)
    return {
      findOne: wrapWithRetry(name, 'findOne', col.findOne.bind(col)),
      insertOne: wrapWithRetry(name, 'insertOne', col.insertOne.bind(col)),
      updateOne: wrapWithRetry(name, 'updateOne', col.updateOne.bind(col)),
      deleteOne: wrapWithRetry(name, 'deleteOne', col.deleteOne.bind(col)),
      createIndex: col.createIndex ? wrapWithRetry(name, 'createIndex', col.createIndex.bind(col)) : undefined,
      getIndexes: col.getIndexes ? col.getIndexes.bind(col) : undefined,
      deleteMany: col.deleteMany ? wrapWithRetry(name, 'deleteMany', col.deleteMany.bind(col)) : undefined
    }
  }

  const dbClient = {
    collection: (name) => wrapCollection(name),
    createCollection: (name) => rawClient.createCollection(name),
    listCollections: () => rawClient.listCollections(),
    close: () => { /* no-op: connection reused across warm invocations */ }
  }

  _cachedConnection = dbClient
  _cachedConnectionKey = key

  return { dbClient }
}

module.exports = { connect }
