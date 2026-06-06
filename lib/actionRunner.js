/**
 * Shared action runner — eliminates boilerplate across all actions.
 *
 * Handles:
 *   - Logger creation
 *   - Param parsing + header normalization
 *   - IMS token generation (cached in state)
 *   - DB connection with traceId
 *   - Action start/end logging
 *   - DB close in finally
 *   - Error formatting
 *
 * Usage:
 *   const { runAction } = require('../../lib/actionRunner')
 *   exports.main = runAction('actionName', 'collectionName', handler, options)
 *
 *   handler receives: ({ params, dbClient, rawDb, traceId, logger, aioDbToken })
 *   handler returns:  { statusCode, body } (or throws with .statusCode)
 *
 * Options:
 *   - requireModule: true (default) — calls assertModuleEnabled, passes appConfig
 *   - parallelInit: async (params, logger) => result — runs in parallel with IMS token
 *   - skipDb: false (default) — set true to skip DB connection entirely
 */

const { Core } = require('@adobe/aio-sdk')
const { getRequestParams } = require('./params')
const { getCollection, closeDb, assertModuleEnabled, getConfigFromState } = require('./db')
const { getAioDbToken } = require('./imsHelper')
const { generateTraceId, actionStart, actionEnd } = require('./logger')
const { errorResponse } = require('./http')

function runAction (actionName, collectionName, handler, options = {}) {
  const { requireModule = true, skipDb = false } = options

  return async function main (params) {
    const logger = Core.Logger(actionName, { level: params.LOG_LEVEL || 'info' })
    let dbClient
    const traceId = generateTraceId()

    try {
      const inParams = getRequestParams(params)
      inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}

      const parallelInit = options.parallelInit
      let parallelResult = undefined
      let aioDbToken
      let appConfig = null

      if (skipDb) {
        if (parallelInit) {
          parallelResult = await parallelInit(inParams, logger)
        }
      } else {
        // ── Maximum parallelization: IMS + parallelInit + appConfig from state ──
        const promises = [getAioDbToken(inParams)]
        if (parallelInit) promises.push(parallelInit(inParams, logger))
        if (requireModule) promises.push(getConfigFromState())

        const results = await Promise.all(promises)
        aioDbToken = results[0]

        let idx = 1
        if (parallelInit) { parallelResult = results[idx++] }
        if (requireModule) { appConfig = results[idx] }

        // ── DB connect (reused on warm containers — near instant) ────
        const { dbClient: client } = await getCollection(
          { ...inParams, AIO_DB_TOKEN: aioDbToken },
          collectionName,
          { traceId }
        )
        dbClient = client
        const rawDb = dbClient._rawDbClient || dbClient
        actionStart(rawDb, traceId, actionName)

        // ── Module check: use pre-fetched state config, fallback to DB ──
        if (requireModule) {
          if (appConfig && appConfig.is_enabled) {
            // State cache hit — fast path, no DB read needed
          } else if (appConfig && !appConfig.is_enabled) {
            throw Object.assign(new Error('otp module is disabled'), { statusCode: 403 })
          } else {
            // State miss — fall back to full assertModuleEnabled (reads from DB)
            appConfig = await assertModuleEnabled(dbClient)
          }
        }
      }

      // ── Handler ───────────────────────────────────────────────────
      const rawDb = dbClient?._rawDbClient || dbClient
      const result = await handler({
        params: inParams,
        dbClient,
        rawDb,
        traceId,
        logger,
        aioDbToken,
        appConfig,
        parallelResult
      })

      if (rawDb) actionEnd(rawDb, traceId, actionName, { statusCode: result.statusCode || 200 })
      return result
    } catch (err) {
      const code = err.statusCode || 500
      if (code >= 500) logger.error(err)
      const rawDb = dbClient?._rawDbClient || dbClient
      if (rawDb && traceId) actionEnd(rawDb, traceId, actionName, { statusCode: code, error: err.message })
      return errorResponse(code, err.message || 'server error', logger)
    } finally {
      await closeDb(dbClient, logger)
    }
  }
}

module.exports = { runAction }
