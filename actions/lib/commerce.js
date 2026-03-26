/**
 * Shared Commerce GraphQL operation helpers.
 * These functions call the Commerce endpoint directly (COMMERCE_GRAPHQL_ENDPOINT),
 * NOT the API Mesh, because createCustomerV2 / generateCustomerToken / customer
 * are native Commerce mutations that are not exposed through the Mesh schema.
 */

const { commerceGraphQLRequest } = require('./graphql')

async function generateCustomerToken (params, email, password, logger) {
  const mutation = `
    mutation generateCustomerToken($email: String!, $password: String!) {
      generateCustomerToken(email: $email, password: $password) { token }
    }
  `
  const payload = await commerceGraphQLRequest(params, mutation, { email, password }, logger)
  const token = payload?.data?.generateCustomerToken?.token
  if (!token) throw new Error('failed to generate customer token')
  return token
}

async function fetchCustomerProfile (params, customerToken, logger) {
  const query = `query { customer { id firstname lastname email } }`
  const payload = await commerceGraphQLRequest(params, query, {}, logger, customerToken)
  return payload?.data?.customer || null
}

module.exports = { generateCustomerToken, fetchCustomerProfile }
