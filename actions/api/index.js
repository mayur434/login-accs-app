/**
 * Unified Login Module API — single action router.
 *
 * Routes requests based on __ow_path to the appropriate handler.
 * All Mesh-facing endpoints are served from this single action,
 * reducing cold starts and maximizing container reuse.
 *
 * Paths:
 *   /generate-otp  → generateOtp handler
 *   /validate-otp  → validateOtp handler
 *   /customer      → customer handler
 *   /google-sso    → googleSso handler
 *   /config        → config handler (GET only via Mesh)
 */

const generateOtp = require('./generate-otp/index')
const validateOtp = require('./validate-otp/index')
const customer = require('./customer/index')
const googleSso = require('./google-sso/index')
const config = require('../config/index')

const routes = {
  '/generate-otp': generateOtp.main,
  '/validate-otp': validateOtp.main,
  '/customer': customer.main,
  '/google-sso': googleSso.main,
  '/config': config.main
}

async function main (params) {
  const path = (params.__ow_path || '').replace(/\/+$/, '') || '/'

  const handler = routes[path]
  if (!handler) {
    return {
      statusCode: 200,
      body: { success: false, statusCode: 404, error: 'not found' }
    }
  }

  return handler(params)
}

exports.main = main
