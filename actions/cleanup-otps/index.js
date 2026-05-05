const { Core } = require('@adobe/aio-sdk')
const { getCollection, closeDb } = require('../lib/db')
const { getRequestParams } = require('../lib/params')
const { getAioDbToken } = require('../lib/imsHelper')
const { generateTraceId, actionStart, actionEnd, dbStart, dbEnd } = require('../lib/logger')

const OTP_COLLECTION = 'otps'
const DEFAULT_RETENTION_DAYS = 7

function getRetentionDays (params) {
  const rawValue = params.OTP_RETENTION_DAYS ?? params.retentionDays ?? DEFAULT_RETENTION_DAYS
  const retentionDays = Number(rawValue)
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw Object.assign(new Error('OTP_RETENTION_DAYS must be a positive integer'), { statusCode: 400 })
  }
  return retentionDays
}

async function deleteExpiredOtps (dbClient, cutoffTimestamp, traceId) {
  const rawDb = dbClient?._rawDbClient || dbClient

  if (rawDb?._pool) {
    const dbTraceId = dbStart(rawDb, traceId, 'deleteMany', OTP_COLLECTION, { cutoffTimestamp })
    try {
      const [result] = await rawDb._pool.execute(
        'DELETE FROM `otps` WHERE `createdAt` < ?',
        [cutoffTimestamp]
      )
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, {
        success: true,
        deletedCount: result.affectedRows,
        cutoffTimestamp
      })
      return result.affectedRows || 0
    } catch (err) {
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, {
        success: false,
        error: err.message,
        cutoffTimestamp
      })
      throw err
    }
  }

  const collection = await rawDb.collection(OTP_COLLECTION)
  if (typeof collection.deleteMany === 'function') {
    const dbTraceId = dbStart(rawDb, traceId, 'deleteMany', OTP_COLLECTION, { cutoffTimestamp })
    try {
      const result = await collection.deleteMany({ createdAt: { $lt: cutoffTimestamp } })
      const deletedCount = result?.deletedCount || 0
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, {
        success: true,
        deletedCount,
        cutoffTimestamp
      })
      return deletedCount
    } catch (err) {
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, {
        success: false,
        error: err.message,
        cutoffTimestamp
      })
      throw err
    }
  }

  throw Object.assign(new Error('OTP cleanup is not supported by the current DB adapter'), { statusCode: 500 })
}

async function main (params) {
  const logger = Core.Logger('cleanupOtps', { level: params.LOG_LEVEL || 'info' })
  let dbClient
  const traceId = generateTraceId()

  try {
    const inParams = getRequestParams(params)
    const retentionDays = getRetentionDays(inParams)
    const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000)
    const invokedBy = inParams.__ow_trigger || 'manual'

    inParams.__ow_headers = params.__ow_headers || inParams.__ow_headers || {}
    const aioDbToken = await getAioDbToken(inParams).catch((err) => {
      logger.warn(`Unable to generate IMS token for DB: ${err.message}`)
      return null
    })

    const { dbClient: client } = await getCollection(
      { ...inParams, AIO_DB_TOKEN: aioDbToken },
      OTP_COLLECTION,
      { traceId }
    )
    dbClient = client
    const rawDb = dbClient._rawDbClient || dbClient
    actionStart(rawDb, traceId, 'cleanupOtps', { retentionDays, cutoffTimestamp, invokedBy })

    const deletedCount = await deleteExpiredOtps(dbClient, cutoffTimestamp, traceId)

    logger.info(`Deleted ${deletedCount} OTP entries older than ${retentionDays} days`)
    actionEnd(rawDb, traceId, 'cleanupOtps', {
      statusCode: 200,
      retentionDays,
      cutoffTimestamp,
      deletedCount,
      invokedBy
    })

    return {
      statusCode: 200,
      body: {
        success: true,
        message: `Deleted ${deletedCount} OTP entries older than ${retentionDays} days`,
        deletedCount,
        retentionDays,
        cutoffTimestamp
      }
    }
  } catch (err) {
    const code = err.statusCode || 500
    const rawDb = dbClient?._rawDbClient || dbClient
    if (rawDb && traceId) {
      actionEnd(rawDb, traceId, 'cleanupOtps', {
        statusCode: code,
        error: err.message
      })
    }
    if (code >= 500) logger.error(err)
    return {
      statusCode: code,
      body: { error: err.message || 'server error' }
    }
  } finally {
    await closeDb(dbClient, logger)
  }
}

exports.main = main