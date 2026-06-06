/**
 * Post-deploy hook — runs automatically after `aio app deploy`.
 *
 * Seeds aio-lib-state with:
 *   1. IMS token (20h TTL — avoids ~1.2s IMS call on every invocation)
 *   2. app_config (5d TTL — avoids DB+IMS for config reads)
 *
 * Uses .env credentials (AIO_runtime_namespace, AIO_runtime_auth).
 * This is the SINGLE post-deploy hook — add all post-deployment seeding here.
 */

require('dotenv').config()

const { getCollection, closeDb, normalizeAppConfig, findOneOrNull, putConfigToState, APP_CONFIG_ID, APP_CONFIG_COLLECTION, APP_CONFIG_DEFAULTS } = require('../lib/db')
const { getAioDbToken } = require('../lib/imsHelper')

async function main () {
  let dbClient
  const results = []

  try {
    const params = {
      DB_TYPE: process.env.DB_TYPE,
      MYSQL_HOST: process.env.MYSQL_HOST,
      MYSQL_PORT: process.env.MYSQL_PORT,
      MYSQL_USER: process.env.MYSQL_USER,
      MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
      MYSQL_DATABASE: process.env.MYSQL_DATABASE,
      IMS_OAUTH_S2S_CLIENT_ID: process.env.IMS_OAUTH_S2S_CLIENT_ID,
      IMS_OAUTH_S2S_CLIENT_SECRET: process.env.IMS_OAUTH_S2S_CLIENT_SECRET,
      IMS_OAUTH_S2S_ORG_ID: process.env.IMS_OAUTH_S2S_ORG_ID,
      IMS_OAUTH_S2S_SCOPES: process.env.IMS_OAUTH_S2S_SCOPES,
      AIO_runtime_namespace: process.env.AIO_runtime_namespace,
      AIO_runtime_auth: process.env.AIO_runtime_auth,
      STATE_CONFIG_TTL_SECONDS: process.env.STATE_CONFIG_TTL_SECONDS,
      IMS_TOKEN_TTL_SECONDS: process.env.IMS_TOKEN_TTL_SECONDS
    }

    // 1. Seed IMS token in state (getAioDbToken caches automatically)
    const aioDbToken = await getAioDbToken(params)
    results.push('ims_token: cached')

    // 2. Seed app_config in state
    const { dbClient: connectedClient, collection } = await getCollection(
      { ...params, AIO_DB_TOKEN: aioDbToken },
      APP_CONFIG_COLLECTION
    )
    dbClient = connectedClient

    let config = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
    if (!config) {
      config = { _id: APP_CONFIG_ID, ...APP_CONFIG_DEFAULTS, updatedAt: Date.now() }
    }

    const normalized = normalizeAppConfig(config)
    await putConfigToState(normalized)
    results.push('app_config: cached')

    // 3. Warm up action containers (fire parallel pings to force cold starts now)
    const baseUrl = process.env.ACTION_URL_BASE || `https://${process.env.AIO_runtime_namespace}.adobeioruntime.net/api/v1/web/login-module`
    const fetch = require('node-fetch')

    // Ping the unified api action (warms the single container for all Mesh routes)
    // Also ping admin actions separately (they have their own containers)
    const pings = [
      fetch(`${baseUrl}/api/generate-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => `api:${r.status}`).catch(() => 'api:err'),
      fetch(`${baseUrl}/config`, { method: 'GET' }).then(r => `config:${r.status}`).catch(() => 'config:err'),
      fetch(`${baseUrl}/cleanup-otps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => `cleanup:${r.status}`).catch(() => 'cleanup:err')
    ]

    const warmResults = await Promise.allSettled(pings)
    const warmed = warmResults.map(r => r.value || r.reason).join(', ')
    results.push(`containers warmed (${warmed})`)

    console.log('[post-deploy] State seeded:', results.join(', '))
  } catch (err) {
    console.error('[post-deploy] Failed:', err.message, '| Completed:', results.join(', '))
  } finally {
    await closeDb(dbClient)
  }
}

main()
