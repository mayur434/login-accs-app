const libDB = require('@adobe/aio-lib-db')

module.exports = async function rollbackDocDb (collectionName, documentId) {
  if (!collectionName || !documentId) {
    return { success: false, deletedCount: 0 }
  }

  const region = process.env.AIO_DB_REGION || 'apac'
  const db = await libDB.init({ region })
  const dbClient = await db.connect()

  try {
    const collection = await dbClient.collection(collectionName)
    const result = await collection.deleteOne({ _id: documentId })

    return {
      success: !!(result && result.deletedCount > 0),
      deletedCount: result ? result.deletedCount : 0
    }
  } finally {
    await dbClient.close()
  }
}