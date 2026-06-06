#!/usr/bin/env node
/**
 * Test: identity upsert on OTP validation.
 * Verifies customer_mobile_identity is created/updated after OTP validation.
 */
require('dotenv').config()
process.env.DB_TYPE = 'mysql'

const { getCollection, closeDb, findOneOrNull, isUniqueConstraintError } = require('../lib/db')
const { generateOtpValue, createReferenceId } = require('../lib/otp')
const { CUSTOMER_IDENTITY_COLLECTION, parseCustomerIdFromToken, normalizeMobile, buildLoginType, getSyntheticEmail } = require('../lib/customer')

;(async () => {
  console.log('\n' + '='.repeat(55))
  console.log('  Identity Upsert on OTP Validation — MYSQL')
  console.log('='.repeat(55))

  const params = {
    DB_TYPE: 'mysql',
    MYSQL_HOST: process.env.MYSQL_HOST || '172.171.225.184',
    MYSQL_PORT: process.env.MYSQL_PORT || 3307,
    MYSQL_USER: process.env.MYSQL_USER || 'root',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'rootpassword',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'mydb'
  }

  let passed = 0, failed = 0, dbClient

  function check (label, actual, expected) {
    const ok = actual === expected
    console.log(ok ? '  PASS' : '  FAIL', `${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`)
    ok ? passed++ : failed++
  }

  try {
    const { dbClient: c, collection: otpCol } = await getCollection(params, 'otps')
    dbClient = c
    const identityCol = await dbClient.collection(CUSTOMER_IDENTITY_COLLECTION)

    // Clean test data
    const testEmail = `test_identity_${Date.now()}@example.com`
    const testMobile = '+919876500001'

    // ── Test 1: Simulate OTP validate → identity upsert (mobile login) ──
    console.log('\n  --- Test 1: Identity upsert after OTP validation (mobile) ---')

    const ref1 = createReferenceId()
    const otp1 = generateOtpValue()
    await otpCol.insertOne({
      otpReferenceId: ref1, otp: otp1, loginType: 'mobile',
      mobile: '9876500001', email: testEmail,
      firstname: 'Test', lastname: 'User',
      createdAt: Date.now(), expiresAt: Date.now() + 600000,
      otpExpirationValidityMinutes: 10, consumed: false,
      token: null, tokenStoredAt: null
    })

    // Simulate: OTP validated, token obtained, now upsert identity
    const fakeToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJjdXN0b21lcl9pZCI6NDJ9.stub'
    const record = await otpCol.findOne({ otpReferenceId: ref1 })

    let normalizedMobile = null
    try { normalizedMobile = normalizeMobile(record.mobile) } catch (_) { normalizedMobile = record.mobile }

    const email = record.email || getSyntheticEmail(normalizedMobile)
    const hasEmail = !!record.email
    const hasMobile = !!normalizedMobile
    const loginType = buildLoginType(hasEmail, hasMobile)
    const customerId = parseCustomerIdFromToken(fakeToken)
    const now = new Date()

    const doc = {
      email, mobile_number: normalizedMobile, login_type: loginType,
      customer_id: customerId, firstname: record.firstname || null,
      lastname: record.lastname || null, status: 'active', updated_at: now
    }

    await identityCol.updateOne(
      { email },
      { $set: doc, $setOnInsert: { created_at: now } },
      { upsert: true }
    )

    const identity = await findOneOrNull(identityCol, { email: testEmail })
    check('identity created', !!identity, true)
    check('email matches', identity?.email, testEmail)
    check('mobile matches', identity?.mobile_number, normalizedMobile)
    check('customer_id from token', identity?.customer_id, 42)
    check('login_type', identity?.login_type, 'both')
    check('firstname', identity?.firstname, 'Test')
    check('status', identity?.status, 'active')

    // ── Test 2: Upsert again (update, not duplicate) ──
    console.log('\n  --- Test 2: Upsert updates existing record ---')
    await identityCol.updateOne(
      { email: testEmail },
      { $set: { ...doc, firstname: 'Updated', updated_at: new Date() } },
      { upsert: true }
    )
    const updated = await findOneOrNull(identityCol, { email: testEmail })
    check('firstname updated', updated?.firstname, 'Updated')
    check('still same email', updated?.email, testEmail)

    // ── Test 3: Mobile-only OTP (no email → synthetic email) ──
    console.log('\n  --- Test 3: Mobile-only → synthetic email ---')
    const testMobile2 = '+919876500002'
    const syntheticEmail = getSyntheticEmail(testMobile2)
    check('synthetic email format', syntheticEmail, '919876500002@email.com')

    await identityCol.updateOne(
      { mobile_number: testMobile2 },
      { $set: { email: syntheticEmail, mobile_number: testMobile2, login_type: 'mobile', customer_id: 99, firstname: 'Mobile', lastname: 'Only', status: 'active', updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
      { upsert: true }
    )
    const mobileIdentity = await findOneOrNull(identityCol, { mobile_number: testMobile2 })
    check('identity created for mobile-only', !!mobileIdentity, true)
    check('synthetic email stored', mobileIdentity?.email, syntheticEmail)

    // Cleanup
    await identityCol.deleteOne({ email: testEmail })
    await identityCol.deleteOne({ mobile_number: testMobile2 })
    await otpCol.deleteOne({ otpReferenceId: ref1 })

    console.log(`\n  Result: ${passed} passed, ${failed} failed`)
  } catch (e) {
    console.error('  ERROR:', e.message, e.stack)
    failed++
  } finally {
    await closeDb(dbClient)
  }

  console.log('\n' + '='.repeat(55))
  console.log(`  TOTAL: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(55))
  process.exit(failed > 0 ? 1 : 0)
})()
