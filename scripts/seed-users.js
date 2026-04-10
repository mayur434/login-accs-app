#!/usr/bin/env node

const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const { Core } = require('@adobe/aio-sdk')
const mysqlAdapter = require('../actions/lib/db-adapters/mysql-adapter')
const docdbAdapter = require('../actions/lib/db-adapters/docdb-adapter')

const { generateAccessToken } = Core.AuthClient

const COLLECTION_NAME = 'customer_mobile_identity'
const DEFAULT_BATCH_SIZE = 1000
const DEFAULT_CUSTOMER_ID_BASE = 900000000
const DEFAULT_MOBILE_BASE = 910000000000000
const DEFAULT_EMAIL_PREFIX = 'perf.user+'
const DEFAULT_EMAIL_DOMAIN = 'seed.local'

function printUsage () {
  console.log(`
Usage:
  npm run seed-users -- --count=100000
  npm run seed-users -- --count=200000 --batch=2000
  npm run seed-users -- --count=100000 --start=0 --db=mysql

Options:
  --count=<n>              Number of users to insert. Required.
  --start=<n>              Start sequence offset. Defaults to existing row/document count.
  --batch=<n>              Batch size. Default: 1000.
  --db=<mysql|docdb>       Override DB_TYPE from .env.
  --customer-id-base=<n>   Starting base for generated customer_id values.
  --mobile-base=<n>        Starting base for generated mobile_number values.
  --email-prefix=<value>   Email local-part prefix. Default: perf.user+
  --email-domain=<value>   Email domain. Default: seed.local
  --help                   Show this help.

Examples:
  npm run seed-users -- --count=100000
  npm run seed-users -- --count=200000
  npm run seed-users -- --count=300000 --batch=5000 --db=docdb
`)
}

function parseArgs (argv) {
  const args = {}

  for (const rawArg of argv) {
    if (!rawArg.startsWith('--')) continue
    const arg = rawArg.slice(2)
    const eqIndex = arg.indexOf('=')

    if (eqIndex === -1) {
      args[arg] = true
      continue
    }

    const key = arg.slice(0, eqIndex)
    const value = arg.slice(eqIndex + 1)
    args[key] = value
  }

  return args
}

function parseIntegerOption (value, name, { min = 0, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error(`${name} is required`)
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`)
  }

  return parsed
}

function formatNumber (value) {
  return new Intl.NumberFormat('en-IN').format(value)
}

function formatDurationMs (ms) {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(2)} s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`
}

function resolveConfig () {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printUsage()
    process.exit(0)
  }

  const dbType = String(args.db || process.env.DB_TYPE || 'docdb').toLowerCase().trim()
  if (!['mysql', 'docdb'].includes(dbType)) {
    throw new Error('db must be either mysql or docdb')
  }

  const count = parseIntegerOption(args.count, 'count', { min: 1, required: true })
  const start = parseIntegerOption(args.start, 'start', { min: 0 })
  const batchSize = parseIntegerOption(args.batch, 'batch', { min: 1 }) || DEFAULT_BATCH_SIZE
  const customerIdBase = parseIntegerOption(args['customer-id-base'], 'customer-id-base', { min: 1 }) || DEFAULT_CUSTOMER_ID_BASE
  const mobileBase = parseIntegerOption(args['mobile-base'], 'mobile-base', { min: 1 }) || DEFAULT_MOBILE_BASE

  return {
    count,
    dbType,
    batchSize,
    start,
    customerIdBase,
    mobileBase,
    emailPrefix: String(args['email-prefix'] || DEFAULT_EMAIL_PREFIX),
    emailDomain: String(args['email-domain'] || DEFAULT_EMAIL_DOMAIN)
  }
}

async function getDocDbToken () {
  if (process.env.AIO_DB_TOKEN) return process.env.AIO_DB_TOKEN

  const clientId = process.env.IMS_OAUTH_S2S_CLIENT_ID
  const clientSecret = process.env.IMS_OAUTH_S2S_CLIENT_SECRET
  const orgId = process.env.IMS_OAUTH_S2S_ORG_ID
  const rawScopes = process.env.IMS_OAUTH_S2S_SCOPES || '[]'

  if (!clientId || !clientSecret || !orgId) {
    throw new Error('Missing IMS OAuth S2S credentials for DocDB in .env')
  }

  let scopes
  try {
    scopes = JSON.parse(rawScopes)
  } catch {
    scopes = rawScopes.split(',')
  }

  const tokenResponse = await generateAccessToken({
    clientId,
    clientSecret,
    orgId,
    scopes: scopes.map(scope => String(scope).trim()).filter(Boolean)
  })

  if (!tokenResponse?.access_token) {
    throw new Error('Failed to generate DocDB access token')
  }

  return tokenResponse.access_token
}

async function connectDb (dbType) {
  if (dbType === 'mysql') {
    return mysqlAdapter.connect({})
  }

  if (!process.env.__OW_NAMESPACE && process.env.AIO_runtime_namespace) {
    process.env.__OW_NAMESPACE = process.env.AIO_runtime_namespace
  }

  const token = await getDocDbToken()
  return docdbAdapter.connect({
    AIO_DB_TOKEN: token,
    AIO_DB_REGION: process.env.AIO_DB_REGION || 'apac',
    AIO_runtime_namespace: process.env.AIO_runtime_namespace || process.env.__OW_NAMESPACE
  })
}

async function getExistingCount (dbClient, dbType) {
  if (dbType === 'mysql') {
    const [rows] = await dbClient._pool.execute(`SELECT COUNT(*) AS total FROM \`${COLLECTION_NAME}\``)
    return Number(rows?.[0]?.total || 0)
  }

  const collection = await dbClient.collection(COLLECTION_NAME)
  return Number(await collection.countDocuments({}))
}

function buildUser(sequence, config) {
  const suffix = sequence + 1
  const now = new Date()

  return {
    email: `${config.emailPrefix}${suffix}@${config.emailDomain}`,
    mobile_number: String(config.mobileBase + sequence),
    customer_id: config.customerIdBase + suffix,
    login_type: 'both',
    status: 'active',
    firstname: `Perf${suffix}`,
    lastname: 'Seed',
    resolvedEmail: `${config.emailPrefix}${suffix}@${config.emailDomain}`,
    created_at: now,
    updated_at: now
  }
}

function buildBatch(startSequence, batchSize, config) {
  const batch = []
  for (let offset = 0; offset < batchSize; offset++) {
    batch.push(buildUser(startSequence + offset, config))
  }
  return batch
}

function toSqlValue (value) {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ')
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

async function insertMysqlBatch (dbClient, batch) {
  const columns = [
    'email',
    'mobile_number',
    'customer_id',
    'login_type',
    'status',
    'firstname',
    'lastname',
    'resolvedEmail',
    'created_at',
    'updated_at'
  ]
  const columnList = columns.map(column => `\`${column}\``).join(', ')

  const placeholders = batch
    .map(() => `(${columns.map(() => '?').join(', ')})`)
    .join(', ')

  const values = batch.flatMap(row => columns.map(column => toSqlValue(row[column])))

  await dbClient._pool.execute(
    `INSERT INTO \`${COLLECTION_NAME}\` (${columnList}) VALUES ${placeholders}`,
    values
  )
}

async function insertDocdbBatch (dbClient, batch) {
  const collection = await dbClient.collection(COLLECTION_NAME)
  await collection.insertMany(batch)
}

async function insertBatch (dbClient, dbType, batch) {
  if (dbType === 'mysql') {
    await insertMysqlBatch(dbClient, batch)
    return
  }

  await insertDocdbBatch(dbClient, batch)
}

async function run () {
  const config = resolveConfig()
  const { dbClient } = await connectDb(config.dbType)

  try {
    const initialCount = await getExistingCount(dbClient, config.dbType)
    const start = config.start === undefined ? initialCount : config.start
    const end = start + config.count - 1

    console.log(`DB           : ${config.dbType}`)
    console.log(`Target       : ${COLLECTION_NAME}`)
    console.log(`Existing rows: ${formatNumber(initialCount)}`)
    console.log(`Insert count : ${formatNumber(config.count)}`)
    console.log(`Start offset : ${formatNumber(start)}`)
    console.log(`End offset   : ${formatNumber(end)}`)
    console.log(`Batch size   : ${formatNumber(config.batchSize)}`)
    console.log('')

    let inserted = 0
    const startedAt = Date.now()

    while (inserted < config.count) {
      const currentBatchSize = Math.min(config.batchSize, config.count - inserted)
      const batchStart = start + inserted
      const batch = buildBatch(batchStart, currentBatchSize, config)
      const batchStartedAt = Date.now()

      await insertBatch(dbClient, config.dbType, batch)

      inserted += currentBatchSize
      const batchMs = Date.now() - batchStartedAt
      const totalMs = Date.now() - startedAt
      const rate = totalMs > 0 ? Math.round((inserted * 1000) / totalMs) : inserted

      console.log(
        `[${formatNumber(inserted)}/${formatNumber(config.count)}] ` +
        `last batch ${formatNumber(currentBatchSize)} in ${formatDurationMs(batchMs)} | ` +
        `avg ${formatNumber(rate)} rows/sec`
      )
    }

    const finalCount = await getExistingCount(dbClient, config.dbType)
    const totalMs = Date.now() - startedAt

    console.log('')
    console.log(`Completed in ${formatDurationMs(totalMs)}`)
    console.log(`Inserted     : ${formatNumber(inserted)}`)
    console.log(`Final rows   : ${formatNumber(finalCount)}`)
  } finally {
    await dbClient.close()
  }
}

run().catch(error => {
  console.error('Seed failed:', error.message)
  process.exitCode = 1
})