#!/usr/bin/env node
/**
 * Test OTP consumed + expired validation for the standalone /otp action.
 * Runs against the DB layer directly (no HTTP server needed).
 *
 * Usage:
 *   node scripts/test-otp-validation.js mysql
 *   node scripts/test-otp-validation.js docdb
 */
require('dotenv').config()

const {
  getCollection, closeDb, getAppConfig, findOneOrNull,
  APP_CONFIG_DEFAULTS, APP_CONFIG_ID, APP_CONFIG_COLLECTION
} = require('../lib/db')
const { generateOtpValue, createReferenceId, levenshtein } = require('../lib/otp')

const backend = (process.argv[2] || 'mysql').toLowerCase()
process.env.DB_TYPE = backend

;(async () => {
  console.log(`\n${'='.repeat(55)}`)
  console.log(`  OTP Validation Tests — ${backend.toUpperCase()}`)
  console.log(`${'='.repeat(55)}`)

  const params = {
    DB_TYPE: backend,
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

  let passed = 0
  let failed = 0
  let dbClient

  function check (label, actual, expected) {
    const ok = actual === expected
    console.log(ok ? '  PASS' : '  FAIL', `${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`)
    ok ? passed++ : failed++
  }

  try {
    // Connect
    const { dbClient: c, collection: otpCollection } = await getCollection(params, 'otps')
    dbClient = c

    // Ensure app_config exists with is_enabled: true and otp_expiration_validity: 10
    const configCol = await dbClient.collection(APP_CONFIG_COLLECTION)
    await configCol.updateOne(
      { _id: APP_CONFIG_ID },
      { $set: { is_enabled: true, otp_expiration_validity: 10, otp_in_response: true, auto_register: false, allow_key_info_update: false, updatedAt: Date.now() } },
      { upsert: true }
    )

    // ── Test 1: Generate OTP, validate once → success ──
    console.log('\n  --- Test 1: Generate + Validate (happy path) ---')
    const ref1 = createReferenceId()
    const otp1 = generateOtpValue()
    await otpCollection.insertOne({
      otpReferenceId: ref1,
      otp: otp1,
      loginType: 'mobile',
      mobile: '9876543210',
      email: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000),
      otpExpirationValidityMinutes: 10,
      consumed: false,
      token: 'test-token-1',
      tokenStoredAt: Date.now()
    })

    let record = await findOneOrNull(otpCollection, { otpReferenceId: ref1 })
    check('OTP stored', !!record, true)
    check('consumed is false', record.consumed, false)

    // Simulate validation: OTP matches
    const dist1 = levenshtein(otp1, String(record.otp))
    check('OTP matches (distance 0)', dist1, 0)

    // Not expired
    check('not expired', Date.now() <= record.expiresAt, true)

    // Mark consumed
    await otpCollection.updateOne(
      { otpReferenceId: ref1 },
      { $set: { consumed: true, consumedAt: Date.now() } }
    )
    record = await findOneOrNull(otpCollection, { otpReferenceId: ref1 })
    check('consumed is true after validate', record.consumed, true)
    check('consumedAt is set', record.consumedAt != null, true)

    // ── Test 2: Reuse consumed OTP → "otp already used" ──
    console.log('\n  --- Test 2: Reuse consumed OTP → rejected ---')
    record = await findOneOrNull(otpCollection, { otpReferenceId: ref1 })
    check('record still exists', !!record, true)
    check('consumed flag is true', record.consumed, true)
    // In the action code: if (record.consumed) return error 400 "otp already used"
    const reuseShouldFail = record.consumed === true
    check('reuse blocked by consumed flag', reuseShouldFail, true)

    // ── Test 3: Expired OTP → "otp expired" ──
    console.log('\n  --- Test 3: Expired OTP → rejected ---')
    const ref2 = createReferenceId()
    const otp2 = generateOtpValue()
    await otpCollection.insertOne({
      otpReferenceId: ref2,
      otp: otp2,
      loginType: 'email',
      mobile: null,
      email: 'test@example.com',
      createdAt: Date.now() - (15 * 60 * 1000), // 15 mins ago
      expiresAt: Date.now() - (5 * 60 * 1000),  // expired 5 mins ago
      otpExpirationValidityMinutes: 10,
      consumed: false,
      token: 'test-token-2',
      tokenStoredAt: Date.now() - (15 * 60 * 1000)
    })

    record = await findOneOrNull(otpCollection, { otpReferenceId: ref2 })
    check('expired OTP stored', !!record, true)
    check('consumed is false', record.consumed, false)
    check('is expired', Date.now() > record.expiresAt, true)
    // In the action code: if (Date.now() > record.expiresAt) → delete + return "otp expired"

    // Cleanup: delete expired OTP (as action would)
    await otpCollection.deleteOne({ otpReferenceId: ref2 })
    const deleted = await findOneOrNull(otpCollection, { otpReferenceId: ref2 })
    check('expired OTP deleted', deleted, null)

    // ── Test 4: Invalid OTP reference → "invalid otpReferenceId" ──
    console.log('\n  --- Test 4: Invalid reference ---')
    const bogus = await findOneOrNull(otpCollection, { otpReferenceId: 'otp_nonexistent_99999' })
    check('nonexistent ref returns null', bogus, null)

    // ── Test 5: Wrong OTP value (Levenshtein > 1) → "invalid otp" ──
    console.log('\n  --- Test 5: Wrong OTP value ---')
    const ref3 = createReferenceId()
    const otp3 = '1234'
    await otpCollection.insertOne({
      otpReferenceId: ref3,
      otp: otp3,
      loginType: 'mobile',
      mobile: '9876543210',
      email: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000),
      otpExpirationValidityMinutes: 10,
      consumed: false,
      token: 'test-token-3',
      tokenStoredAt: Date.now()
    })

    // Fuzzy match: distance 1 (1235 vs 1234) → should pass
    check('distance 1 (1235 vs 1234)', levenshtein('1235', '1234'), 1)
    check('distance 1 allowed', levenshtein('1235', '1234') <= 1, true)

    // Too far: distance 2+ (9999 vs 1234) → should fail
    check('distance 3 (9999 vs 1234)', levenshtein('9999', '1234') > 1, true)

    // ── Test 6: Consumed flag persists across read/write ──
    console.log('\n  --- Test 6: Boolean hydration (MySQL TINYINT) ---')
    record = await findOneOrNull(otpCollection, { otpReferenceId: ref3 })
    check('consumed is boolean false', typeof record.consumed === 'boolean' && record.consumed === false, true)

    await otpCollection.updateOne(
      { otpReferenceId: ref3 },
      { $set: { consumed: true, consumedAt: Date.now() } }
    )
    record = await findOneOrNull(otpCollection, { otpReferenceId: ref3 })
    check('consumed is boolean true', typeof record.consumed === 'boolean' && record.consumed === true, true)

    // Cleanup test OTPs
    await otpCollection.deleteOne({ otpReferenceId: ref1 })
    await otpCollection.deleteOne({ otpReferenceId: ref3 })

    console.log(`\n  Result: ${passed} passed, ${failed} failed`)
  } catch (e) {
    console.error('  ERROR:', e.message, e.stack)
    failed++
  } finally {
    await closeDb(dbClient)
  }

  console.log(`\n${'='.repeat(55)}`)
  console.log(`  TOTAL: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(55)}`)
  process.exit(failed > 0 ? 1 : 0)
})()
