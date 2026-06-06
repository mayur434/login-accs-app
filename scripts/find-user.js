#!/usr/bin/env node

const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const { Core } = require('@adobe/aio-sdk')
const mysqlAdapter = require('../lib/db-adapters/mysql-adapter')
const docdbAdapter = require('../lib/db-adapters/docdb-adapter')

const { generateAccessToken } = Core.AuthClient

const COLLECTION_NAME = 'customer_mobile_identity'

function printUsage () {
  console.log(`
Usage:
  npm run find-user -- --email=user@example.com
  npm run find-user -- --email=user@example.com --db=mysql
  npm run find-user -- --email=user@example.com --iterations=10

Options:
  --email=<address>   Email address to search for. Required.
  --db=<mysql|docdb>  Override DB_TYPE from .env.
  --iterations=<n>    Number of times to repeat the query (for benchmarking). Default: 1.
  --help              Show this help.

Examples:
  npm run find-user -- --email=perf.user+1@seed.local
  npm run find-user -- --email=perf.user+1@seed.local --iterations=5
  npm run find-user -- --email=perf.user+1@seed.local --db=mysql --iterations=10
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

function formatDurationMs (ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(3)} s`
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

  const email = args.email
  if (!email) {
    console.error('Error: --email is required\n')
    printUsage()
    process.exit(1)
  }

  const iterations = Math.max(1, parseInt(args.iterations, 10) || 1)

  return { dbType, email, iterations }
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

async function findByEmail (dbClient, email) {
  const collection = await dbClient.collection(COLLECTION_NAME)
  return collection.findOne({ email })
}

async function run () {
  const config = resolveConfig()
  const { dbClient } = await connectDb(config.dbType)

  try {
    console.log(`DB         : ${config.dbType}`)
    console.log(`Collection : ${COLLECTION_NAME}`)
    console.log(`Email      : ${config.email}`)
    console.log(`Iterations : ${config.iterations}`)
    console.log('')

    const timings = []
    let user = null

    for (let i = 1; i <= config.iterations; i++) {
      const start = performance.now()
      user = await findByEmail(dbClient, config.email)
      const elapsed = performance.now() - start

      timings.push(elapsed)
      console.log(`[${i}/${config.iterations}] findOne → ${formatDurationMs(elapsed)}`)
    }

    console.log('')

    if (!user) {
      console.log('Result     : User NOT found')
    } else {
      console.log('Result     : User found')
      console.log('─'.repeat(50))
      for (const [key, value] of Object.entries(user)) {
        if (key === '_id') continue
        console.log(`  ${key}: ${value}`)
      }
      console.log('─'.repeat(50))
    }

    console.log('')

    // ── Timing summary ──────────────────────────────────────────────
    const min = Math.min(...timings)
    const max = Math.max(...timings)
    const sum = timings.reduce((a, b) => a + b, 0)
    const avg = sum / timings.length

    // Median
    const sorted = [...timings].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid]

    console.log('Timing Summary')
    console.log(`  Min      : ${formatDurationMs(min)}`)
    console.log(`  Max      : ${formatDurationMs(max)}`)
    console.log(`  Avg      : ${formatDurationMs(avg)}`)
    console.log(`  Median   : ${formatDurationMs(median)}`)
    console.log(`  Total    : ${formatDurationMs(sum)}`)
  } finally {
    await dbClient.close()
  }
}

run().catch(error => {
  console.error('Find-user failed:', error.message)
  process.exitCode = 1
})
