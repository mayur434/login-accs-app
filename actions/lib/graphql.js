/**
 * Shared GraphQL request helper.
 */

const fetch = require('node-fetch')

/**
 * Execute a GraphQL query/mutation against the configured Commerce endpoint.
 *
 * @param {object}  params      Action params (needs GRAPHQL_ENDPOINT).
 * @param {string}  query       GraphQL query or mutation string.
 * @param {object}  variables   Variables for the query.
 * @param {object}  logger      Logger instance.
 * @param {string}  [authToken] Optional bearer token for customer-scoped requests.
 * @returns {object} Parsed JSON payload from the endpoint.
 */
async function graphQLRequest (params, query, variables = {}, logger, authToken) {
  const endpoint = params.GRAPHQL_ENDPOINT || process.env.GRAPHQL_ENDPOINT
  if (!endpoint) throw new Error('GRAPHQL_ENDPOINT not configured in params or env')

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

  const payload = await res.json()

  if (!res.ok) {
    throw new Error(payload?.errors?.[0]?.message || `graphql request failed with status ${res.status}`)
  }

  if (payload?.errors?.length) {
    throw new Error(payload.errors.map(e => e.message).join('; '))
  }

  return payload
}

module.exports = { graphQLRequest }
