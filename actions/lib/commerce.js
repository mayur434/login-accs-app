/**
 * Shared Commerce GraphQL operation helpers.
 */

const { graphQLRequest } = require('./graphql')

async function generateCustomerToken (params, email, password, logger) {
  const mutation = `
    mutation generateCustomerToken($email: String!, $password: String!) {
      generateCustomerToken(email: $email, password: $password) { token }
    }
  `
  const payload = await graphQLRequest(params, mutation, { email, password }, logger)
  const token = payload?.data?.generateCustomerToken?.token
  if (!token) throw new Error('failed to generate customer token')
  return token
}

async function fetchCustomerProfile (params, customerToken, logger) {
  const query = `query { customer { id firstname lastname email } }`
  const payload = await graphQLRequest(params, query, {}, logger, customerToken)
  return payload?.data?.customer || null
}

module.exports = { generateCustomerToken, fetchCustomerProfile }
