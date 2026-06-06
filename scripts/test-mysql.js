#!/usr/bin/env node

/**
 * Dual-Backend Integration Test Script
 *
 * Tests all action handlers against BOTH MySQL and DocDB backends.
 *
 * Usage:
 *   node scripts/test-mysql.js              # run both backends
 *   node scripts/test-mysql.js mysql        # MySQL only
 *   node scripts/test-mysql.js docdb        # DocDB only
 *
 * Requires:
 *   MySQL  — DB_TYPE, MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE in .env
 *   DocDB  — IMS_OAUTH_S2S_CLIENT_ID, IMS_OAUTH_S2S_CLIENT_SECRET, IMS_OAUTH_S2S_ORG_ID, IMS_OAUTH_S2S_SCOPES in .env
 */

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient

// Ensure __OW_NAMESPACE is available for @adobe/aio-lib-db
if (!process.env.__OW_NAMESPACE && process.env.AIO_runtime_namespace) {
  process.env.__OW_NAMESPACE = process.env.AIO_runtime_namespace
}

// ── Counters ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function assert (condition, label, detail) {
  if (condition) {
    console.log(`   ✓ ${label}`)
    passed++
  } else {
    console.log(`   ✗ ${label}` + (detail ? ` — ${detail}` : ''))
    failed++
    failures.push(label + (detail ? `: ${detail}` : ''))
  }
}

// ── Param builders ───────────────────────────────────────────────────────

function buildMysqlParams (overrides = {}) {
  return {
    DB_TYPE: 'mysql',
    MYSQL_HOST: process.env.MYSQL_HOST,
    MYSQL_PORT: process.env.MYSQL_PORT,
    MYSQL_USER: process.env.MYSQL_USER,
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
    MYSQL_DATABASE: process.env.MYSQL_DATABASE,
    LOG_LEVEL: 'error',
    __ow_method: 'get',
    __ow_headers: { host: 'localhost' },
    ...overrides
  }
}

function buildDocdbParams (token, overrides = {}) {
  return {
    DB_TYPE: 'docdb',
    AIO_DB_TOKEN: token,
    AIO_DB_REGION: process.env.AIO_DB_REGION || 'apac',
    AIO_runtime_namespace: process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE,
    LOG_LEVEL: 'error',
    __ow_method: 'get',
    __ow_headers: { host: 'localhost' },
    ...overrides
  }
}

// ── IMS token helper for DocDB ───────────────────────────────────────────

async function getImsToken () {
  const clientId = process.env.IMS_OAUTH_S2S_CLIENT_ID
  const clientSecret = process.env.IMS_OAUTH_S2S_CLIENT_SECRET
  const orgId = process.env.IMS_OAUTH_S2S_ORG_ID
  const rawScopes = process.env.IMS_OAUTH_S2S_SCOPES || '[]'

  if (!clientId || !clientSecret || !orgId) {
    throw new Error('Missing IMS_OAUTH_S2S credentials in .env for DocDB tests')
  }

  let scopes
  try { scopes = JSON.parse(rawScopes) } catch { scopes = rawScopes.split(',') }
  scopes = scopes.map(s => s.trim()).filter(Boolean)

  const tokenResponse = await generateAccessToken({ clientId, clientSecret, orgId, scopes })
  if (!tokenResponse?.access_token) throw new Error('Failed to generate IMS access token')
  return tokenResponse.access_token
}

// ── Raw DB client helper ─────────────────────────────────────────────────

async function getRawDbClient (backend, imsToken) {
  if (backend === 'mysql') {
    const adapter = require('../lib/db-adapters/mysql-adapter')
    return (await adapter.connect({})).dbClient
  }
  const adapter = require('../lib/db-adapters/docdb-adapter')
  return (await adapter.connect({ AIO_DB_TOKEN: imsToken })).dbClient
}

// ═══════════════════════════════════════════════════════════════════════════
//  TEST SUITES (parameterised by backend)
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Adapter Layer ─────────────────────────────────────────────────────

async function testAdapterLayer (backend, buildParams, imsToken) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`  1. [${backend}] Adapter Layer`)
  console.log(`══════════════════════════════════════════════════════`)

  let dbClient
  try {
    dbClient = await getRawDbClient(backend, imsToken)
    assert(!!dbClient, `${backend} adapter connects`)
  } catch (e) {
    assert(false, `${backend} adapter connects`, e.message)
    return
  }

  // List tables/collections
  try {
    const tables = await dbClient.listCollections()
    const names = tables.map(t => t.name || t)
    assert(names.includes('app_config'), `${backend} has app_config`)
    assert(names.includes('otps'), `${backend} has otps`)
    assert(names.includes('customer_mobile_identity'), `${backend} has customer_mobile_identity`)
  } catch (e) {
    assert(false, `${backend} listCollections`, e.message)
  }

  // findOne existing
  try {
    const col = dbClient.collection('app_config')
    const doc = await col.findOne({ _id: 'app_config' })
    assert(!!doc, `${backend} findOne returns seeded app_config`)
    assert(typeof doc.is_enabled === 'boolean', `${backend} is_enabled is boolean`)
  } catch (e) {
    assert(false, `${backend} findOne seeded app_config`, e.message)
  }

  // findOne non-existing → throws
  try {
    const col = dbClient.collection('app_config')
    await col.findOne({ _id: `nonexistent_${Date.now()}` })
    assert(false, `${backend} findOne non-existent throws`, 'did not throw')
  } catch (e) {
    assert(
      e.message.toLowerCase().includes('not found') || e.code === 'DOCUMENT_NOT_FOUND',
      `${backend} findOne non-existent → Document not found`
    )
  }

  // insertOne + findOne + updateOne + deleteOne on otps
  const testRef = `otp_${backend}_${Date.now()}`
  try {
    const col = dbClient.collection('otps')
    await col.insertOne({
      otpReferenceId: testRef,
      otp: '1234',
      operation: 'login',
      loginType: 'email',
      email: 'adapter@test.com',
      firstname: 'Adapter',
      lastname: 'Test',
      createdAt: Date.now(),
      expiresAt: Date.now() + 600000,
      otpExpirationValidityMinutes: 10,
      consumed: false
    })
    assert(true, `${backend} insertOne into otps`)

    const row = await col.findOne({ otpReferenceId: testRef })
    assert(row.otp === '1234', `${backend} findOne returns inserted row`)
    assert(row.consumed === false, `${backend} consumed=false after hydration`)
    assert(row.firstname === 'Adapter', `${backend} firstname stored`)
  } catch (e) {
    assert(false, `${backend} insertOne/findOne otps`, e.message)
  }

  // updateOne $set
  try {
    const col = dbClient.collection('otps')
    await col.updateOne(
      { otpReferenceId: testRef },
      { $set: { consumed: true, consumedAt: Date.now() } }
    )
    const updated = await col.findOne({ otpReferenceId: testRef })
    assert(updated.consumed === true, `${backend} updateOne consumed → true`)
    assert(updated.consumedAt != null, `${backend} updateOne consumedAt set`)
  } catch (e) {
    assert(false, `${backend} updateOne $set`, e.message)
  }

  // deleteOne
  try {
    const col = dbClient.collection('otps')
    await col.deleteOne({ otpReferenceId: testRef })
    let found = true
    try { await col.findOne({ otpReferenceId: testRef }) } catch { found = false }
    assert(!found, `${backend} deleteOne removes OTP`)
  } catch (e) {
    assert(false, `${backend} deleteOne`, e.message)
  }

  // upsert (insert path)
  const upsertId = `upsert_${backend}_${Date.now()}`
  try {
    const col = dbClient.collection('app_config')
    await col.updateOne(
      { _id: upsertId },
      {
        $setOnInsert: { is_enabled: true, otp_expiration_validity: 5 },
        $set: { otp_in_response: true, updatedAt: Date.now() }
      },
      { upsert: true }
    )
    const row = await col.findOne({ _id: upsertId })
    assert(row.is_enabled === true, `${backend} upsert insert: is_enabled`)
    assert(row.otp_in_response === true, `${backend} upsert insert: otp_in_response`)
    await col.deleteOne({ _id: upsertId })
    assert(true, `${backend} upsert cleanup`)
  } catch (e) {
    assert(false, `${backend} upsert insert path`, e.message)
  }

  // upsert (update path)
  try {
    const col = dbClient.collection('app_config')
    await col.updateOne(
      { _id: 'app_config' },
      { $set: { otp_in_response: true, updatedAt: Date.now() } },
      { upsert: true }
    )
    const row = await col.findOne({ _id: 'app_config' })
    assert(row.otp_in_response === true, `${backend} upsert update: toggled`)
    await col.updateOne(
      { _id: 'app_config' },
      { $set: { otp_in_response: false, updatedAt: Date.now() } }
    )
    assert(true, `${backend} upsert update: restored`)
  } catch (e) {
    assert(false, `${backend} upsert update path`, e.message)
  }

  // customer_mobile_identity: insert + unique + cleanup
  const testEmail = `test_${backend}_${Date.now()}@example.com`
  const testMobile = `+1${Date.now().toString().slice(-10)}`
  const testCustId = Math.floor(Math.random() * 100000) + 1
  try {
    const col = dbClient.collection('customer_mobile_identity')
    await col.insertOne({
      email: testEmail,
      mobile_number: testMobile,
      customer_id: testCustId,
      login_type: 'email',
      status: 'active',
      firstname: 'DB',
      lastname: 'Test',
      created_at: new Date(),
      updated_at: new Date()
    })
    assert(true, `${backend} insertOne identity`)

    const found = await col.findOne({ email: testEmail })
    assert(found.firstname === 'DB', `${backend} findOne identity by email`)
  } catch (e) {
    assert(false, `${backend} insertOne identity`, e.message)
  }

  // Unique constraint
  try {
    const col = dbClient.collection('customer_mobile_identity')
    await col.insertOne({
      email: testEmail,
      mobile_number: `+2${Date.now().toString().slice(-10)}`,
      customer_id: testCustId + 1,
      login_type: 'email',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    })
    assert(false, `${backend} unique constraint on email`, 'did not throw')
  } catch (e) {
    const { isUniqueConstraintError } = require('../lib/db')
    assert(isUniqueConstraintError(e), `${backend} unique constraint detected`)
  }

  // Clean up
  try {
    const col = dbClient.collection('customer_mobile_identity')
    await col.deleteOne({ email: testEmail })
    assert(true, `${backend} identity cleanup`)
  } catch (e) {
    assert(false, `${backend} identity cleanup`, e.message)
  }

  await dbClient.close()
}

// ── 2. db.js Facade ──────────────────────────────────────────────────────

async function testDbFacade (backend, buildParams) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`  2. [${backend}] db.js Facade Layer`)
  console.log(`══════════════════════════════════════════════════════`)

  const {
    getCollection, closeDb, getAppConfig, findOneOrNull,
    isDocumentNotFoundError, isUniqueConstraintError, isCollectionNotFoundError,
    normalizeAppConfig
  } = require('../lib/db')

  let dbClient
  try {
    const result = await getCollection(buildParams(), 'app_config')
    dbClient = result.dbClient
    assert(!!result.collection, `${backend} getCollection returns handle`)
  } catch (e) {
    assert(false, `${backend} getCollection`, e.message)
    return
  }

  // getAppConfig
  try {
    const config = await getAppConfig(dbClient)
    assert(typeof config.is_enabled === 'boolean', `${backend} getAppConfig: is_enabled boolean`)
    assert(Number.isInteger(config.otp_expiration_validity) && config.otp_expiration_validity > 0,
      `${backend} getAppConfig: otp_expiration_validity is positive integer`)
    assert(typeof config.otp_in_response === 'boolean', `${backend} getAppConfig: otp_in_response boolean`)
    assert(typeof config.auto_register === 'boolean', `${backend} getAppConfig: auto_register boolean`)
    assert(typeof config.allow_key_info_update === 'boolean', `${backend} getAppConfig: allow_key_info_update boolean`)
  } catch (e) {
    assert(false, `${backend} getAppConfig`, e.message)
  }

  // findOneOrNull — null for non-existent
  try {
    const col = dbClient.collection('app_config')
    const result = await findOneOrNull(col, { _id: `nope_${Date.now()}` })
    assert(result === null, `${backend} findOneOrNull → null for missing`)
  } catch (e) {
    assert(false, `${backend} findOneOrNull null`, e.message)
  }

  // findOneOrNull — returns existing
  try {
    const col = dbClient.collection('app_config')
    const result = await findOneOrNull(col, { _id: 'app_config' })
    assert(result !== null && result._id === 'app_config', `${backend} findOneOrNull → existing doc`)
  } catch (e) {
    assert(false, `${backend} findOneOrNull existing`, e.message)
  }

  // Error classifiers (static — same for both backends)
  assert(isDocumentNotFoundError({ message: 'Document not found' }), `${backend} isDocumentNotFoundError()`)
  assert(isUniqueConstraintError({ code: 'ER_DUP_ENTRY' }), `${backend} isUniqueConstraintError(ER_DUP_ENTRY)`)
  assert(isUniqueConstraintError({ code: 11000 }), `${backend} isUniqueConstraintError(11000)`)
  assert(isCollectionNotFoundError({ code: 'ER_NO_SUCH_TABLE' }), `${backend} isCollectionNotFoundError()`)

  const n = normalizeAppConfig(null)
  assert(n.is_enabled === false, `${backend} normalizeAppConfig(null) defaults`)

  await closeDb(dbClient)
}

// ── 3. Config Action ─────────────────────────────────────────────────────

async function testConfigAction (backend, buildParams) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`  3. [${backend}] Config Action (GET/POST/DELETE)`)
  console.log(`══════════════════════════════════════════════════════`)

  // Clear module cache so config action picks up new DB_TYPE
  clearActionCache()

  const configAction = require('../actions/config/index.js')

  // GET
  try {
    const result = await configAction.main(buildParams({ __ow_method: 'get' }))
    assert(result.statusCode === 200, `${backend} GET config → 200`)
    const body = parseBody(result.body)
    assert(typeof body.is_enabled === 'boolean', `${backend} GET: is_enabled boolean`)
    assert(typeof body.otp_expiration_validity === 'number', `${backend} GET: otp_expiration_validity number`)
    assert(typeof body.auto_register === 'boolean', `${backend} GET: auto_register boolean`)
  } catch (e) {
    assert(false, `${backend} GET config`, e.message)
  }

  // POST — single field
  try {
    const result = await configAction.main(buildParams({
      __ow_method: 'post', otp_in_response: true
    }))
    assert(result.statusCode === 200, `${backend} POST otp_in_response=true → 200`)
    const body = parseBody(result.body)
    assert(body.otp_in_response === true, `${backend} POST: otp_in_response updated`)
  } catch (e) {
    assert(false, `${backend} POST single field`, e.message)
  }

  // POST — multiple fields
  try {
    const result = await configAction.main(buildParams({
      __ow_method: 'post', otp_expiration_validity: 15, auto_register: true
    }))
    assert(result.statusCode === 200, `${backend} POST multi-field → 200`)
    const body = parseBody(result.body)
    assert(body.otp_expiration_validity === 15, `${backend} POST: validity → 15`)
    assert(body.auto_register === true, `${backend} POST: auto_register → true`)
  } catch (e) {
    assert(false, `${backend} POST multi-field`, e.message)
  }

  // POST — validation error
  try {
    const result = await configAction.main(buildParams({
      __ow_method: 'post', otp_expiration_validity: -5
    }))
    assert(result.statusCode === 400, `${backend} POST invalid → 400`)
  } catch (e) {
    assert(false, `${backend} POST invalid`, e.message)
  }

  // POST — empty body
  try {
    const result = await configAction.main(buildParams({ __ow_method: 'post' }))
    assert(result.statusCode === 400, `${backend} POST empty → 400`)
  } catch (e) {
    assert(false, `${backend} POST empty`, e.message)
  }

  // DELETE
  try {
    const result = await configAction.main(buildParams({ __ow_method: 'delete' }))
    assert(result.statusCode === 200, `${backend} DELETE config → 200`)
  } catch (e) {
    assert(false, `${backend} DELETE config`, e.message)
  }

  // GET after DELETE — auto-create
  try {
    const result = await configAction.main(buildParams({ __ow_method: 'get' }))
    assert(result.statusCode === 200, `${backend} GET after DELETE → 200`)
    const body = parseBody(result.body)
    assert(body.is_enabled === false, `${backend} GET after DELETE: defaults restored`)
  } catch (e) {
    assert(false, `${backend} GET after DELETE`, e.message)
  }

  // Restore for next tests
  await configAction.main(buildParams({
    __ow_method: 'post', otp_in_response: true, is_enabled: true
  }))
  assert(true, `${backend} config restored for OTP tests`)

  // Unsupported method
  try {
    const result = await configAction.main(buildParams({ __ow_method: 'OPTIONS' }))
    assert(result.statusCode === 405, `${backend} OPTIONS → 405`)
  } catch (e) {
    assert(false, `${backend} OPTIONS`, e.message)
  }

  // Backward compat: auto_login
  try {
    const result = await configAction.main(buildParams({
      __ow_method: 'post', auto_login: true
    }))
    assert(result.statusCode === 200, `${backend} auto_login backward compat → 200`)
    const body = parseBody(result.body)
    assert(body.auto_register === true, `${backend} auto_login mapped to auto_register`)
  } catch (e) {
    assert(false, `${backend} auto_login compat`, e.message)
  }

  // PUT / PATCH
  try {
    const r1 = await configAction.main(buildParams({
      __ow_method: 'put', allow_key_info_update: true
    }))
    assert(r1.statusCode === 200, `${backend} PUT → 200`)
    const r2 = await configAction.main(buildParams({
      __ow_method: 'patch', is_enabled: true
    }))
    assert(r2.statusCode === 200, `${backend} PATCH → 200`)
  } catch (e) {
    assert(false, `${backend} PUT/PATCH`, e.message)
  }

  // Restore to clean state
  await configAction.main(buildParams({
    __ow_method: 'post',
    is_enabled: true, otp_in_response: true, auto_register: false,
    allow_key_info_update: false, otp_expiration_validity: 10
  }))
}

// ── 4. OTP Service ───────────────────────────────────────────────────────

async function testOtpService (backend, buildParams, imsToken) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`  4. [${backend}] OTP Service (lib/otpService.js)`)
  console.log(`══════════════════════════════════════════════════════`)

  clearActionCache()

  const { getCollection, closeDb } = require('../lib/db')
  const { generateOtp, validateOtp } = require('../lib/otpService')
  const logger = Core.Logger('test', { level: 'error' })

  const p = buildParams()
  const { dbClient } = await getCollection(p, 'app_config')

  // Make sure config allows OTP
  const rawDb = await getRawDbClient(backend, imsToken)
  const configCol = rawDb.collection('app_config')
  await configCol.updateOne(
    { _id: 'app_config' },
    { $set: { is_enabled: true, otp_in_response: true, auto_register: false, updatedAt: Date.now() } }
  )

  // Generate OTP — email
  let otpRef, otpValue, otpEmail
  try {
    otpEmail = `otp-${backend}-${Date.now()}@example.com`
    const result = await generateOtp(dbClient, {
      flowType: 'register',
      loginType: 'email',
      email: otpEmail, firstname: 'OTP', lastname: 'Tester'
    }, logger)

    otpRef = result?.otpReferenceId
    otpValue = result?.otpValue
    assert(!!result, `${backend} OTP generate (email)`) 
    assert(!!otpRef, `${backend} OTP returns otpReferenceId`)
    assert(!!otpValue, `${backend} OTP returns otpValue (otp_in_response=true)`)
  } catch (e) {
    assert(false, `${backend} OTP generate (email)`, e.message)
  }

  // Verify persistence
  if (otpRef) {
    try {
      const otpCol = rawDb.collection('otps')
      const row = await otpCol.findOne({ otpReferenceId: otpRef })
      assert(row.otp === otpValue, `${backend} OTP persisted with correct value`)
      assert(row.email === otpEmail, `${backend} OTP persisted with correct email`)
      assert(row.consumed === false, `${backend} OTP persisted consumed=false`)
      assert(row.firstname === 'OTP', `${backend} OTP persisted firstname`)
      assert(row.flowType === 'register', `${backend} OTP persisted flowType=register`)
    } catch (e) {
      assert(false, `${backend} OTP persisted`, e.message)
    }
  }

  // Verify OTP — correct value
  if (otpRef && otpValue) {
    try {
      const result = await validateOtp(dbClient, otpRef, otpValue, logger)
      assert(result.flowType === 'register', `${backend} OTP verify returns flowType=register`)
      // Re-read to confirm consumed flag in DB
      const reRead = await rawDb.collection('otps').findOne({ otpReferenceId: otpRef })
      assert(reRead?.consumed === true, `${backend} OTP consumed=true in DB`)
    } catch (e) {
      assert(false, `${backend} OTP verify (correct)`, e.message)
    }
  }

  // Verify already-consumed
  if (otpRef) {
    try {
      await validateOtp(dbClient, otpRef, otpValue, logger)
      assert(false, `${backend} OTP verify (consumed) → 400`, 'did not throw')
    } catch (e) {
      assert(e.statusCode === 400, `${backend} OTP verify (consumed) → 400`)
    }
  }

  // Verify with wrong value
  try {
    const genResult = await generateOtp(dbClient, {
      flowType: 'register',
      loginType: 'email',
      email: `otp-wrong-${backend}-${Date.now()}@example.com`
    }, logger)
    const ref2 = genResult?.otpReferenceId
    if (ref2) {
      try {
        await validateOtp(dbClient, ref2, '0000', logger)
        assert(false, `${backend} OTP verify (wrong) → 401`, 'did not throw')
      } catch (e) {
        assert(e.statusCode === 401, `${backend} OTP verify (wrong) → 401`)
      }
      await rawDb.collection('otps').deleteOne({ otpReferenceId: ref2 })
    }
  } catch (e) {
    assert(false, `${backend} OTP verify wrong`, e.message)
  }

  // Invalid reference
  try {
    await validateOtp(dbClient, `otp_bad_${Date.now()}`, '1234', logger)
    assert(false, `${backend} OTP verify (bad ref) → 400`, 'did not throw')
  } catch (e) {
    assert(e.statusCode === 400, `${backend} OTP verify (bad ref) → 400`)
  }

  // Generate OTP — mobile
  try {
    const mob = `+1${Date.now().toString().slice(-10)}`
    const result = await generateOtp(dbClient, {
      flowType: 'register',
      loginType: 'mobile',
      mobile: mob, firstname: 'Mobile', lastname: 'User'
    }, logger)
    const ref = result?.otpReferenceId
    assert(!!result, `${backend} OTP generate (mobile)`) 
    if (ref) {
      const row = await rawDb.collection('otps').findOne({ otpReferenceId: ref })
      assert(row.mobile === mob, `${backend} OTP mobile stored`)
      assert(row.loginType === 'mobile', `${backend} OTP loginType=mobile`)
      assert(row.flowType === 'register', `${backend} OTP mobile flowType=register`)
      await rawDb.collection('otps').deleteOne({ otpReferenceId: ref })
    }
  } catch (e) {
    assert(false, `${backend} OTP generate (mobile)`, e.message)
  }

  // Regression: login flowType must persist so validateOtp follows login path.
  try {
    const loginEmail = `otp-login-${backend}-${Date.now()}@example.com`
    const loginGen = await generateOtp(dbClient, {
      flowType: 'login',
      loginType: 'email',
      email: loginEmail
    }, logger)
    const loginRef = loginGen?.otpReferenceId
    const loginCode = loginGen?.otpValue

    if (loginRef && loginCode) {
      const loginRecord = await validateOtp(dbClient, loginRef, loginCode, logger)
      assert(loginRecord.flowType === 'login', `${backend} regression: login OTP validates as flowType=login`)
      const raw = await rawDb.collection('otps').findOne({ otpReferenceId: loginRef })
      assert(raw.flowType === 'login', `${backend} regression: login flowType persisted in MySQL`)
      await rawDb.collection('otps').deleteOne({ otpReferenceId: loginRef })
    } else {
      assert(false, `${backend} regression: login OTP generated`, 'missing otpReferenceId/otpValue')
    }
  } catch (e) {
    assert(false, `${backend} regression: login flowType persistence`, e.message)
  }

  // Clean up consumed OTP
  if (otpRef) {
    try { await rawDb.collection('otps').deleteOne({ otpReferenceId: otpRef }) } catch {}
  }

  await closeDb(dbClient, logger)
  await rawDb.close()
}

// ── 5. Customer Identity DB ──────────────────────────────────────────────

async function testCustomerIdentity (backend, imsToken) {
  console.log(`\n══════════════════════════════════════════════════════`)
  console.log(`  5. [${backend}] Customer Identity DB Operations`)
  console.log(`══════════════════════════════════════════════════════`)

  const dbClient = await getRawDbClient(backend, imsToken)
  const col = dbClient.collection('customer_mobile_identity')

  const email = `id_${backend}_${Date.now()}@test.com`
  const mobile = `+1${Date.now().toString().slice(-10)}`
  const customerId = Math.floor(Math.random() * 100000) + 1

  // Insert
  try {
    await col.insertOne({
      email, mobile_number: mobile, customer_id: customerId,
      login_type: 'email', status: 'active',
      firstname: 'Identity', lastname: 'Test',
      resolvedEmail: email,
      created_at: new Date(), updated_at: new Date()
    })
    assert(true, `${backend} insert identity`)
  } catch (e) {
    assert(false, `${backend} insert identity`, e.message)
  }

  // Find by email / mobile / customer_id
  try {
    const r1 = await col.findOne({ email })
    assert(r1.mobile_number === mobile, `${backend} find identity by email`)
    assert(r1.customer_id === customerId, `${backend} customer_id matches`)
  } catch (e) {
    assert(false, `${backend} find identity by email`, e.message)
  }

  try {
    const r2 = await col.findOne({ mobile_number: mobile })
    assert(r2.email === email, `${backend} find identity by mobile`)
  } catch (e) {
    assert(false, `${backend} find identity by mobile`, e.message)
  }

  try {
    const r3 = await col.findOne({ customer_id: customerId })
    assert(r3.email === email, `${backend} find identity by customer_id`)
  } catch (e) {
    assert(false, `${backend} find identity by customer_id`, e.message)
  }

  // Update
  try {
    await col.updateOne({ email }, { $set: { firstname: 'Updated', lastname: 'Name', updated_at: new Date() } })
    const updated = await col.findOne({ email })
    assert(updated.firstname === 'Updated', `${backend} update firstname`)
    assert(updated.lastname === 'Name', `${backend} update lastname`)
  } catch (e) {
    assert(false, `${backend} update identity`, e.message)
  }

  // Upsert (update existing)
  try {
    await col.updateOne({ email }, { $set: { status: 'inactive', updated_at: new Date() } }, { upsert: true })
    const row = await col.findOne({ email })
    assert(row.status === 'inactive', `${backend} upsert update: status → inactive`)
  } catch (e) {
    assert(false, `${backend} upsert update`, e.message)
  }

  // Clean up
  try {
    await col.deleteOne({ email })
    assert(true, `${backend} identity cleanup`)
  } catch (e) {
    assert(false, `${backend} identity cleanup`, e.message)
  }

  await dbClient.close()
}

// ═══════════════════════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════════════════════

function parseBody (body) {
  return typeof body === 'string' ? JSON.parse(body) : body
}

/**
 * Clear Node require cache for action modules so each backend run gets
 * fresh require() with the correct DB_TYPE env var.
 */
function clearActionCache () {
  const actionsDir = path.resolve(__dirname, '..', 'actions')
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(actionsDir)) delete require.cache[key]
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Runner
// ═══════════════════════════════════════════════════════════════════════════

async function runBackend (backend, imsToken) {
  const buildParams = backend === 'mysql'
    ? (ov) => buildMysqlParams(ov)
    : (ov) => buildDocdbParams(imsToken, ov)

  // Set env for action code that reads process.env.DB_TYPE
  process.env.DB_TYPE = backend

  console.log(`\n${'╔' + '═'.repeat(54) + '╗'}`)
  console.log(`║  Running tests for: ${backend.toUpperCase()}${' '.repeat(34 - backend.length)}║`)
  console.log(`${'╚' + '═'.repeat(54) + '╝'}`)

  await testAdapterLayer(backend, buildParams, imsToken)
  await testDbFacade(backend, buildParams)
  await testConfigAction(backend, buildParams)
  await testOtpService(backend, buildParams, imsToken)
  await testCustomerIdentity(backend, imsToken)
}

async function main () {
  const arg = (process.argv[2] || '').toLowerCase().trim()
  const runMysql = !arg || arg === 'mysql'
  const runDocdb = !arg || arg === 'docdb'

  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║       Dual-Backend Integration Tests                 ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log(`Backends: ${[runMysql && 'MySQL', runDocdb && 'DocDB'].filter(Boolean).join(', ')}`)

  let imsToken = null

  try {
    // ── MySQL ──────────────────────────────────────────────────────
    if (runMysql) {
      await runBackend('mysql', null)
    }

    // ── DocDB ──────────────────────────────────────────────────────
    if (runDocdb) {
      console.log('\n\n   Generating IMS token for DocDB...')
      try {
        imsToken = await getImsToken()
        console.log('   ✓ IMS token obtained\n')
        await runBackend('docdb', imsToken)
      } catch (e) {
        console.log(`   ✗ IMS token failed: ${e.message}`)
        console.log('   ⚠ Skipping DocDB tests\n')
        failed++
        failures.push(`DocDB: IMS token generation failed: ${e.message}`)
      }
    }
  } catch (e) {
    console.error('\n\n   UNHANDLED ERROR:', e)
    failed++
    failures.push(`Unhandled: ${e.message}`)
  }

  console.log(`\n${'╔' + '═'.repeat(54) + '╗'}`)
  console.log(`║  TOTAL: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 36 - String(passed).length - String(failed).length))}║`)
  console.log(`${'╚' + '═'.repeat(54) + '╝'}`)

  if (failures.length) {
    console.log('\nFailures:')
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  }

  process.exit(failed > 0 ? 1 : 0)
}

main()
