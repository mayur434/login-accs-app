#!/usr/bin/env node

/**
 * Reads mesh/secrets.yaml and deploys the API Mesh with those secrets.
 *
 * Usage:
 *   node mesh/deploy.js create   # first-time setup
 *   node mesh/deploy.js update   # update existing mesh
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const command = process.argv[2]
if (!command || !['create', 'update'].includes(command)) {
  console.error('Usage: node mesh/deploy.js <create|update>')
  process.exit(1)
}

const secretsPath = path.resolve(__dirname, 'secrets.yaml')
if (!fs.existsSync(secretsPath)) {
  console.error('mesh/secrets.yaml not found.')
  console.error('Copy the template and fill in your values:')
  console.error('  cp mesh/secrets.yaml.example mesh/secrets.yaml')
  process.exit(1)
}

const content = fs.readFileSync(secretsPath, 'utf8')
const secrets = {}
content
  .split('\n')
  .filter(line => line.trim() && !line.trim().startsWith('#') && line.includes(':'))
  .forEach(line => {
    const idx = line.indexOf(':')
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    secrets[key] = value
  })

// Patch openapi.json server URL from ACTION_BASE_URL
if (secrets.ACTION_BASE_URL) {
  const specPath = path.resolve(__dirname, 'openapi.json')
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
  spec.servers = [{ url: secrets.ACTION_BASE_URL, description: 'Deployed App Builder actions' }]
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n')
  console.log(`✓ openapi.json server → ${secrets.ACTION_BASE_URL}`)
}

const envFlags = Object.entries(secrets)
  .map(([key, value]) => `--env ${key}=${value}`)
  .join(' ')

const meshConfig = path.resolve(__dirname, 'mesh.json')
const cmd = `aio api-mesh:${command} ${meshConfig} ${envFlags}`

console.log(`→ aio api-mesh:${command} mesh/mesh.json (with ${Object.keys(secrets).length} secrets from secrets.yaml)`)
execSync(cmd, { stdio: 'inherit' })
