/**
 * Shared GraphQL request helper.
 */

const fetch = require('node-fetch')

/**
 * Internal helper – executes a GraphQL request against the given endpoint.
 */
async function _doRequest (endpoint, query, variables, logger, authToken) {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) {
    headers.authorization = `Bearer ${authToken}`
  }

  logger.info(`calling GraphQL ${endpoint}`)

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  })

  const text = await res.text()

  if (!text?.trim()) {
    throw new Error(
      `Commerce GraphQL returned an empty body (HTTP ${res.status}). ` +
      `Check that COMMERCE_GRAPHQL_ENDPOINT points to the storefront GraphQL URL ` +
      `(e.g. https://your-store.com/graphql), not the Admin or SaaS portal endpoint.`
    )
  }

  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(
      `Commerce GraphQL returned non-JSON (HTTP ${res.status}): ${text.substring(0, 200)}`
    )
  }

  if (!res.ok) {
    throw new Error(payload?.errors?.[0]?.message || `graphql request failed with status ${res.status}`)
  }

  if (payload?.errors?.length) {
    throw new Error(payload.errors.map(e => e.message).join('; '))
  }

  return payload
}

/**
 * Execute a GraphQL query/mutation against the API Mesh endpoint.
 * Use this for custom schema mutations (generateOtp, validateOtp, registerCustomer, etc.).
 *
 * @param {object}  params      Action params (needs GRAPHQL_ENDPOINT).
 * @param {string}  query       GraphQL query or mutation string.
 * @param {object}  variables   Variables for the query.
 * @param {object}  logger      Logger instance.
 * @param {string}  [authToken] Optional bearer token for customer-scoped requests.
 */
async function graphQLRequest (params, query, variables = {}, logger, authToken) {
  const endpoint = params.GRAPHQL_ENDPOINT || process.env.GRAPHQL_ENDPOINT
  if (!endpoint) throw new Error('GRAPHQL_ENDPOINT not configured in params or env')
  return _doRequest(endpoint, query, variables, logger, authToken)
}

/**
 * Execute a GraphQL query/mutation directly against the Commerce GraphQL endpoint.
 * Use this for native Commerce mutations (createCustomerV2, generateCustomerToken, customer query, etc.)
 * which are NOT exposed through the API Mesh schema.
 *
 * @param {object}  params      Action params (needs COMMERCE_GRAPHQL_ENDPOINT).
 * @param {string}  query       GraphQL query or mutation string.
 * @param {object}  variables   Variables for the query.
 * @param {object}  logger      Logger instance.
 * @param {string}  [authToken] Optional bearer token for customer-scoped requests.
 */
async function commerceGraphQLRequest (params, query, variables = {}, logger, authToken) {
  const endpoint = params.COMMERCE_GRAPHQL_ENDPOINT || process.env.COMMERCE_GRAPHQL_ENDPOINT
  if (!endpoint) throw new Error('COMMERCE_GRAPHQL_ENDPOINT not configured in params or env')
  if (endpoint.includes('admin.commerce.adobe.com')) {
    throw new Error(
      'Invalid COMMERCE_GRAPHQL_ENDPOINT: admin.commerce.adobe.com is not a storefront GraphQL endpoint. ' +
      'Use your Commerce GraphQL gateway/storefront endpoint (for example, na1-sandbox.api.commerce.adobe.com/<tenant>/graphql).'
    )
  }
  return _doRequest(endpoint, query, variables, logger, authToken)
}

module.exports = { graphQLRequest, commerceGraphQLRequest }
