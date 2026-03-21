#!/usr/bin/env node

/**
 * Automated local development setup for login-module
 *
 * Runs all prerequisites in order:
 *   1. Validates .env credentials
 *   2. Provisions database (skips if already provisioned)
 *   3. Creates collections, indexes, and seed data
 *   4. Starts aio app dev
 *
 * Usage:
 *   npm run dev
 */

const { execSync, spawn } = require('child_process')
const path = require('path')

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') })

const ROOT = path.resolve(__dirname, '..')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkEnv () {
  const required = [
    'AIO_runtime_namespace',
    'IMS_OAUTH_S2S_CLIENT_ID',
    'IMS_OAUTH_S2S_CLIENT_SECRET',
    'IMS_OAUTH_S2S_ORG_ID'
  ]
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error('✗ Missing required .env variables:', missing.join(', '))
    console.error('  Run "aio app use" to generate .env')
    process.exit(1)
  }
}

function runScript (label, scriptPath) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${label}`)
  console.log('='.repeat(60))
  try {
    execSync(`node ${scriptPath}`, { cwd: ROOT, stdio: 'inherit' })
  } catch (e) {
    // provision-db exits 1 on 409 (already provisioned) — that's ok
    if (label.includes('Provision') && e.status === 1) {
      console.log('  (Database already provisioned — continuing)')
    } else {
      console.error(`\n✗ ${label} failed`)
      process.exit(1)
    }
  }
}

function startDev () {
  console.log(`\n${'='.repeat(60)}`)
  console.log('  Starting aio app dev -e commerce/backend-ui/1')
  console.log('='.repeat(60) + '\n')
  const child = spawn('aio', ['app', 'dev', '-e', 'commerce/backend-ui/1'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true
  })
  child.on('exit', (code) => process.exit(code || 0))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\n🚀 login-module — Local Dev Setup\n')

checkEnv()
runScript('Step 1/3: Provisioning database', path.join(__dirname, 'provision-db.js'))
runScript('Step 2/3: Setting up collections, indexes & seed data', path.join(__dirname, 'setup-db.js'))
startDev()
