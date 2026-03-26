#!/usr/bin/env node

/**
 * Database Setup Script for login-module
 *
 * Prerequisites:
 *   - Run `aio app use` to generate .env with workspace credentials
 *   - Ensure "App Builder Data Services" API is added in Developer Console
 *   - Database must be provisioned first (run: npm run provision-db)
 *
 * Usage:
 *   node scripts/setup-db.js
 *
 * What it does:
 *   1. Generates IMS access token from .env credentials
 *   2. Connects to Adobe docdb
 *   3. Creates collections: app_config, otps, customer_mobile_identity
 *   4. Creates unique indexes on customer_mobile_identity (mobile_number, email, customer_id)
 *   5. Seeds default app_config document
 *   6. Verifies everything by reading back collections, indexes, and data
 */

const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const libDB = require('@adobe/aio-lib-db')

const REGION = process.env.AIO_DB_REGION || 'apac'

// ---------------------------------------------------------------------------
// Collection definitions
// ---------------------------------------------------------------------------

/**
 * app_config — singleton document holding module configuration
 *
 * Fields:
 *   _id                       string    always 'app_config'
 *   is_enabled                boolean   module enabled flag
 *   otp_expiration_validity   integer   OTP validity in minutes (>0)
 *   otp_in_response           boolean   include OTP in API response (testing)
 *   auto_login                boolean   auto-create customer on OTP verify
 *   allow_key_info_update     boolean   allow mobile/email mapping updates
 *   updatedAt                 number    Date.now() timestamp
 */
const APP_CONFIG_COLLECTION = 'app_config'
const APP_CONFIG_SEED = {
  _id: 'app_config',
  is_enabled: true,
  otp_expiration_validity: 5,
  otp_in_response: false,
  auto_login: false,
  allow_key_info_update: false,
  updatedAt: Date.now()
}

/**
 * otps — temporary OTP records for authentication
 *
 * Fields:
 *   otpReferenceId                string    unique ref 'otp_{timestamp}_{random}'
 *   otp                           string    4-digit OTP value
 *   operation                     string    'login' | 'register' | 'update_mobile'
 *   loginType                     string    'mobile' | 'email'
 *   mobile                        string?   mobile number (nullable)
 *   mobile_number                 string?   normalized mobile (nullable)
 *   email                         string?   email address (nullable)
 *   customer_id                   string|number?  customer id (nullable)
 *   firstname / firstName         string?   first name
 *   lastname / lastName           string?   last name
 *   createdAt                     number    Date.now() timestamp
 *   expiresAt                     number    expiration timestamp
 *   otpExpirationValidityMinutes  number    validity in minutes
 *   token                         string?   customer auth token (set on validate)
 *   tokenStoredAt                 number?   when token was stored
 *   consumed                      boolean   whether OTP was used
 *   consumedAt                    number?   when OTP was consumed
 */
const OTP_COLLECTION = 'otps'

/**
 * customer_mobile_identity — customer identity records
 *
 * Fields:
 *   _id            ObjectId  auto-generated
 *   email          string    customer email (unique index)
 *   mobile_number  string    normalized mobile (unique index)
 *   customer_id    number    commerce customer id (unique index)
 *   login_type     string    'email' | 'mobile' | 'both'
 *   status         string    'active' | 'inactive'
 *   firstname     string?   customer first name
 *   lastname      string?   customer last name
 *   created_at     Date      document creation time
 *   updated_at     Date      last modification time
 *
 * Unique Indexes:
 *   uniq_mobile_number  { mobile_number: 1 }
 *   uniq_email          { email: 1 }
 *   uniq_customer_id    { customer_id: 1 }
 */
const IDENTITY_COLLECTION = 'customer_mobile_identity'
const IDENTITY_INDEXES = [
  { field: 'mobile_number', name: 'uniq_mobile_number' },
  { field: 'email', name: 'uniq_email' },
  { field: 'customer_id', name: 'uniq_customer_id' }
]

const ALL_COLLECTIONS = [APP_CONFIG_COLLECTION, OTP_COLLECTION, IDENTITY_COLLECTION]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getToken () {
  const clientId = process.env.IMS_OAUTH_S2S_CLIENT_ID
  const clientSecret = process.env.IMS_OAUTH_S2S_CLIENT_SECRET
  const orgId = process.env.IMS_OAUTH_S2S_ORG_ID
  const rawScopes = process.env.IMS_OAUTH_S2S_SCOPES || '[]'

  if (!clientId || !clientSecret || !orgId) {
    throw new Error(
      'Missing IMS_OAUTH_S2S_CLIENT_ID, IMS_OAUTH_S2S_CLIENT_SECRET, or IMS_OAUTH_S2S_ORG_ID in .env.\n' +
      'Run "aio app use" to generate .env, then ensure "App Builder Data Services" is added in Developer Console.'
    )
  }

  let scopes
  try { scopes = JSON.parse(rawScopes) } catch { scopes = rawScopes.split(',') }
  scopes = scopes.map(s => s.trim()).filter(s => s.startsWith('adobeio.abdata.') || s === 'adobeio_api')

  const tokenResponse = await generateAccessToken({ clientId, clientSecret, orgId, scopes })
  if (!tokenResponse || !tokenResponse.access_token) {
    throw new Error('Failed to generate IMS access token.')
  }
  return tokenResponse.access_token
}

async function getDbClient (token) {
  if (!process.env.__OW_NAMESPACE) {
    process.env.__OW_NAMESPACE = process.env.AIO_runtime_namespace || process.env.AIO_RUNTIME_NAMESPACE
  }
  if (!process.env.__OW_NAMESPACE) {
    throw new Error('Missing runtime namespace. Set AIO_runtime_namespace in .env (run "aio app use").')
  }
  const db = await libDB.init({ region: REGION, token })
  return db.connect()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run () {
  let dbClient
  const errors = []

  try {
    console.log('=== Adobe DocDB Setup ===')
    console.log(`Region : ${REGION}`)
    console.log(`Namespace: ${process.env.AIO_runtime_namespace || process.env.AIO_RUNTIME_NAMESPACE || '(not set)'}`)

    // ---- Step 1: Token ----
    console.log('\n[1/6] Generating IMS access token...')
    const token = await getToken()
    console.log('   ✓ Token generated')

    // ---- Step 2: Connect ----
    console.log('\n[2/6] Connecting to docdb...')
    dbClient = await getDbClient(token)
    console.log('   ✓ Connected')

    // ---- Step 3: Create collections ----
    console.log('\n[3/6] Creating collections...')
    const existing = await dbClient.listCollections()
    const existingNames = new Set((existing || []).map(c => c.name || c))
    console.log('   Currently on server:', existingNames.size ? [...existingNames].join(', ') : '(none)')

    for (const name of ALL_COLLECTIONS) {
      if (existingNames.has(name)) {
        console.log(`   ✓ Already exists: ${name}`)
      } else {
        await dbClient.createCollection(name)
        console.log(`   ✓ Created: ${name}`)
      }
    }

    // ---- Step 4: Create indexes on customer_mobile_identity ----
    console.log('\n[4/6] Creating indexes on customer_mobile_identity...')
    const identityCol = dbClient.collection(IDENTITY_COLLECTION)
    for (const idx of IDENTITY_INDEXES) {
      try {
        await identityCol.createIndex(
          { [idx.field]: 1 },
          { unique: true, name: idx.name }
        )
        console.log(`   ✓ Index created: ${idx.name} (unique on ${idx.field})`)
      } catch (e) {
        if (e.message && e.message.includes('already exists')) {
          console.log(`   ✓ Index already exists: ${idx.name}`)
        } else {
          throw e
        }
      }
    }

    // ---- Step 5: Seed app_config ----
    console.log('\n[5/6] Seeding default app_config document...')
    const configCol = dbClient.collection(APP_CONFIG_COLLECTION)
    let configDoc = null
    try {
      configDoc = await configCol.findOne({ _id: 'app_config' })
    } catch {
      // findOne throws "Document not found" when absent in docdb
    }

    if (configDoc) {
      console.log('   ✓ app_config document already exists (not overwriting)')
    } else {
      await configCol.insertOne(APP_CONFIG_SEED)
      console.log('   ✓ Default app_config document inserted')
    }

    // ---- Step 6: Verify everything ----
    console.log('\n[6/6] Verifying setup...')

    // 6a. Verify collections exist
    const finalCollections = await dbClient.listCollections()
    const finalNames = new Set((finalCollections || []).map(c => c.name || c))
    for (const name of ALL_COLLECTIONS) {
      if (finalNames.has(name)) {
        console.log(`   ✓ Collection verified: ${name}`)
      } else {
        errors.push(`Collection missing after creation: ${name}`)
        console.log(`   ✗ Collection NOT found: ${name}`)
      }
    }

    // 6b. Verify indexes on customer_mobile_identity
    const indexes = await identityCol.getIndexes()
    const indexNames = (indexes || []).map(i => i.name || i)
    console.log(`   Indexes on ${IDENTITY_COLLECTION}: ${JSON.stringify(indexNames)}`)
    for (const idx of IDENTITY_INDEXES) {
      if (indexNames.includes(idx.name)) {
        console.log(`   ✓ Index verified: ${idx.name}`)
      } else {
        errors.push(`Index missing: ${idx.name}`)
        console.log(`   ✗ Index NOT found: ${idx.name}`)
      }
    }

    // 6c. Verify app_config document
    const verifyConfig = await configCol.findOne({ _id: 'app_config' })
    const requiredFields = ['is_enabled', 'otp_expiration_validity', 'otp_in_response', 'auto_login', 'allow_key_info_update', 'updatedAt']
    const missingFields = requiredFields.filter(f => !(f in verifyConfig))
    if (missingFields.length > 0) {
      errors.push(`app_config missing fields: ${missingFields.join(', ')}`)
      console.log(`   ✗ app_config missing fields: ${missingFields.join(', ')}`)
    } else {
      console.log('   ✓ app_config document verified — all fields present')
    }
    console.log('   app_config:', JSON.stringify(verifyConfig, null, 4))

    // ---- Summary ----
    if (errors.length > 0) {
      console.log('\n=== Setup completed with errors ===')
      errors.forEach(e => console.error(`   ✗ ${e}`))
      process.exit(1)
    } else {
      console.log('\n=== Setup Complete ===')
      console.log('Collections : ' + ALL_COLLECTIONS.join(', '))
      console.log('Indexes     : ' + IDENTITY_INDEXES.map(i => i.name).join(', '))
      console.log('Seed data   : app_config document')
      console.log('\nReady to run: aio app dev\n')
    }
  } catch (error) {
    console.error('\n✗ Setup failed:', error.message)
    if (error.message.includes('not provisioned') || error.message.includes('NOT_PROVISIONED')) {
      console.error('\n→ Database not provisioned. Run: npm run provision-db')
    }
    process.exit(1)
  } finally {
    try { if (dbClient) await dbClient.close() } catch {}
  }
}

run()
