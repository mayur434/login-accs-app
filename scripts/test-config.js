#!/usr/bin/env node
/**
 * Quick test: verify config action field mapping for both MySQL and DocDB.
 * Ensures auto_login alias is present in normalizeAppConfig response.
 *
 * Usage:
 *   node scripts/test-config.js mysql        # DB layer test
 *   node scripts/test-config.js mysql action  # Full action handler test
 */
require('dotenv').config()

const {
  getCollection, closeDb, normalizeAppConfig, findOneOrNull,
  APP_CONFIG_ID, APP_CONFIG_COLLECTION, APP_CONFIG_DEFAULTS
} = require('../lib/db')

async function testBackend (dbType) {
  process.env.DB_TYPE = dbType
  // Clear adapter cache so factory re-evaluates DB_TYPE
  delete require.cache[require.resolve('../lib/db-adapters')]

  const params = {
    DB_TYPE: dbType,
    MYSQL_HOST: process.env.MYSQL_HOST || '172.171.225.184',
    MYSQL_PORT: process.env.MYSQL_PORT || 3307,
    MYSQL_USER: process.env.MYSQL_USER || 'root',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'rootpassword',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'mydb',
    AIO_runtime_namespace: process.env.AIO_runtime_namespace,
    IMS_OAUTH_S2S_CLIENT_ID: process.env.IMS_OAUTH_S2S_CLIENT_ID,
    IMS_OAUTH_S2S_CLIENT_SECRET: process.env.IMS_OAUTH_S2S_CLIENT_SECRET,
    IMS_OAUTH_S2S_ORG_ID: process.env.IMS_OAUTH_S2S_ORG_ID,
    IMS_OAUTH_S2S_SCOPES: process.env.IMS_OAUTH_S2S_SCOPES
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Testing: ${dbType.toUpperCase()}`)
  console.log(`${'='.repeat(50)}`)

  let dbClient
  let passed = 0
  let failed = 0

  function check (label, actual, expected) {
    const ok = actual === expected
    console.log(ok ? '  PASS' : '  FAIL', `${label}: ${actual} (expected ${expected})`)
    ok ? passed++ : failed++
  }

  try {
    const { dbClient: c, collection } = await getCollection(params, APP_CONFIG_COLLECTION)
    dbClient = c

    // 1. Read current
    let raw = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
    console.log('\n  Raw DB:', JSON.stringify(raw, null, 4).replace(/\n/g, '\n  '))

    // 2. Save with all fields enabled
    const saveFields = {
      is_enabled: true,
      otp_expiration_validity: 15,
      otp_in_response: true,
      auto_register: true,
      allow_key_info_update: true,
      updatedAt: Date.now()
    }
    await collection.updateOne({ _id: APP_CONFIG_ID }, { $set: saveFields }, { upsert: true })
    raw = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
    const norm = normalizeAppConfig(raw)

    console.log('\n  normalizeAppConfig response:')
    console.log('  ', JSON.stringify(norm, null, 4).replace(/\n/g, '\n  '))

    // 3. Verify all fields including auto_login alias
    check('is_enabled', norm.is_enabled, true)
    check('otp_expiration_validity', norm.otp_expiration_validity, 15)
    check('otp_in_response', norm.otp_in_response, true)
    check('auto_register', norm.auto_register, true)
    check('auto_login (alias)', norm.auto_login, true)
    check('allow_key_info_update', norm.allow_key_info_update, true)
    check('auto_login === auto_register', norm.auto_login === norm.auto_register, true)

    // 4. Test with all false
    const falseFields = { ...APP_CONFIG_DEFAULTS, updatedAt: Date.now() }
    await collection.updateOne({ _id: APP_CONFIG_ID }, { $set: falseFields }, { upsert: true })
    raw = await findOneOrNull(collection, { _id: APP_CONFIG_ID })
    const norm2 = normalizeAppConfig(raw)

    check('is_enabled (off)', norm2.is_enabled, false)
    check('auto_register (off)', norm2.auto_register, false)
    check('auto_login alias (off)', norm2.auto_login, false)
    check('otp_in_response (off)', norm2.otp_in_response, false)
    check('allow_key_info_update (off)', norm2.allow_key_info_update, false)

    console.log(`\n  Result: ${passed} passed, ${failed} failed`)
  } catch (e) {
    console.error('  ERROR:', e.message)
    failed++
  } finally {
    await closeDb(dbClient)
  }

  return { passed, failed }
}

async function testAction (dbType) {
  process.env.DB_TYPE = dbType
  delete require.cache[require.resolve('../lib/db-adapters')]
  // Clear config action module cache
  delete require.cache[require.resolve('../actions/config/index')]
  const { main } = require('../actions/config/index')

  console.log(`\n${'='.repeat(50)}`)
  console.log(`  Action Handler Test: ${dbType.toUpperCase()}`)
  console.log(`${'='.repeat(50)}`)

  const baseParams = {
    LOG_LEVEL: 'info',
    DB_TYPE: dbType,
    MYSQL_HOST: process.env.MYSQL_HOST || '172.171.225.184',
    MYSQL_PORT: process.env.MYSQL_PORT || 3307,
    MYSQL_USER: process.env.MYSQL_USER || 'root',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'rootpassword',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'mydb',
    __ow_headers: { host: 'localhost' }
  }

  let passed = 0
  let failed = 0

  function check (label, actual, expected) {
    const ok = actual === expected
    console.log(ok ? '  PASS' : '  FAIL', `${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`)
    ok ? passed++ : failed++
  }

  // GET
  let res = await main({ ...baseParams, __ow_method: 'GET' })
  check('GET status', res.statusCode, 200)
  check('GET has auto_login', 'auto_login' in res.body, true)
  console.log('  GET body:', JSON.stringify(res.body))

  // POST: enable all (UI sends auto_login)
  res = await main({
    ...baseParams,
    __ow_method: 'POST',
    __ow_body: JSON.stringify({
      is_enabled: true,
      auto_login: true,
      allow_key_info_update: true,
      otp_expiration_validity: 10,
      otp_in_response: true
    })
  })
  check('POST status', res.statusCode, 200)
  check('POST auto_login', res.body.auto_login, true)
  check('POST auto_register', res.body.auto_register, true)
  check('POST is_enabled', res.body.is_enabled, true)
  check('POST otp_in_response', res.body.otp_in_response, true)
  check('POST allow_key_info_update', res.body.allow_key_info_update, true)
  check('POST otp_expiration_validity', res.body.otp_expiration_validity, 10)
  console.log('  POST body:', JSON.stringify(res.body))

  // POST: disable all
  res = await main({
    ...baseParams,
    __ow_method: 'POST',
    __ow_body: JSON.stringify({
      is_enabled: false,
      auto_login: false,
      allow_key_info_update: false,
      otp_expiration_validity: 5,
      otp_in_response: false
    })
  })
  check('POST disable auto_login', res.body.auto_login, false)
  check('POST disable auto_register', res.body.auto_register, false)
  check('POST disable is_enabled', res.body.is_enabled, false)

  // DELETE
  res = await main({ ...baseParams, __ow_method: 'DELETE' })
  check('DELETE status', res.statusCode, 200)
  check('DELETE success', res.body.success, true)

  // GET after delete (should auto-create defaults)
  res = await main({ ...baseParams, __ow_method: 'GET' })
  check('GET after delete status', res.statusCode, 200)
  check('GET default auto_login', res.body.auto_login, false)
  check('GET default auto_register', res.body.auto_register, false)
  check('GET default is_enabled', res.body.is_enabled, false)

  console.log(`\n  Result: ${passed} passed, ${failed} failed`)
  return { passed, failed }
}

;(async () => {
  const backend = (process.argv[2] || 'mysql').toLowerCase()
  const mode = (process.argv[3] || 'all').toLowerCase()
  const backends = backend === 'both' ? ['mysql', 'docdb'] : [backend]

  let totalPassed = 0
  let totalFailed = 0

  for (const b of backends) {
    if (mode === 'all' || mode === 'db') {
      const { passed, failed } = await testBackend(b)
      totalPassed += passed
      totalFailed += failed
    }
    if (mode === 'all' || mode === 'action') {
      const { passed, failed } = await testAction(b)
      totalPassed += passed
      totalFailed += failed
    }
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed`)
  console.log(`${'='.repeat(50)}`)
  process.exit(totalFailed > 0 ? 1 : 0)
})()
