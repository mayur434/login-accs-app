const { runAction } = require('../../lib/actionRunner')
const { dbStart, dbEnd } = require('../../lib/logger')

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
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, { success: true, deletedCount: result.affectedRows, cutoffTimestamp })
      return result.affectedRows || 0
    } catch (err) {
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, { success: false, error: err.message, cutoffTimestamp })
      throw err
    }
  }

  const collection = await rawDb.collection(OTP_COLLECTION)
  if (typeof collection.deleteMany === 'function') {
    const dbTraceId = dbStart(rawDb, traceId, 'deleteMany', OTP_COLLECTION, { cutoffTimestamp })
    try {
      const result = await collection.deleteMany({ createdAt: { $lt: cutoffTimestamp } })
      const deletedCount = result?.deletedCount || 0
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, { success: true, deletedCount, cutoffTimestamp })
      return deletedCount
    } catch (err) {
      dbEnd(rawDb, dbTraceId, traceId, 'deleteMany', OTP_COLLECTION, { success: false, error: err.message, cutoffTimestamp })
      throw err
    }
  }

  throw Object.assign(new Error('OTP cleanup is not supported by the current DB adapter'), { statusCode: 500 })
}

exports.main = runAction('cleanupOtps', OTP_COLLECTION, async ({ params, dbClient, traceId, logger }) => {
  const retentionDays = getRetentionDays(params)
  const cutoffTimestamp = Date.now() - (retentionDays * 24 * 60 * 60 * 1000)

  const deletedCount = await deleteExpiredOtps(dbClient, cutoffTimestamp, traceId)
  logger.info(`Deleted ${deletedCount} OTP entries older than ${retentionDays} days`)

  return {
    statusCode: 200,
    body: { success: true, message: `Deleted ${deletedCount} OTP entries older than ${retentionDays} days`, deletedCount, retentionDays, cutoffTimestamp }
  }
}, { requireModule: false })