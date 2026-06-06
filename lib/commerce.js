/**
 * Shared Commerce GraphQL operation helpers.
 * These functions call the Commerce endpoint via GRAPHQL_ENDPOINT,
 * NOT the API Mesh, because createCustomerV2 / generateCustomerToken / customer
 * are native Commerce mutations that are not exposed through the Mesh schema.
 */

const { commerceGraphQLRequest, graphQLRequest } = require('./graphql')

const IS_CUSTOMER_EXISTS_QUERY = `query IsCustomerExists($email: String!, $mobile_number: String!) {
  isCustomerExists(email: $email, mobile_number: $mobile_number) {
    is_customer_exists
    is_disabled
  }
}`

/**
 * Check if customer exists and/or is disabled in Commerce.
 * @param {object} params - action params (needs GRAPHQL_ENDPOINT)
 * @param {string} email
 * @param {string} mobile
 * @param {object} logger
 * @returns {Promise<{ isCustomerExists: boolean, isDisabled: boolean }>}
 */
async function checkCustomerStatus (params, email, mobile, logger) {
  const gqlResp = await graphQLRequest(params, IS_CUSTOMER_EXISTS_QUERY, {
    email: email || '',
    mobile_number: mobile || ''
  }, logger)

  const status = gqlResp?.data?.isCustomerExists
  return {
    isCustomerExists: !!status?.is_customer_exists,
    isDisabled: !!status?.is_disabled
  }
}

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
  const queryWithAttributes = `
    query {
      customer {
        id
        firstname
        lastname
        email
        vs_mobile_number
        custom_attributes {
          attribute_code
          value
        }
      }
    }
  `

  try {
    const payload = await commerceGraphQLRequest(params, queryWithAttributes, {}, logger, customerToken)
    return payload?.data?.customer || null
  } catch (err) {
    // Some Commerce versions may not expose custom_attributes in customer query.
    logger?.debug && logger.debug('customer custom_attributes query failed, retrying basic profile: ' + err.message)
    const basicQuery = `query { customer { id firstname lastname email vs_mobile_number } }`
    const payload = await commerceGraphQLRequest(params, basicQuery, {}, logger, customerToken)
    return payload?.data?.customer || null
  }
}

module.exports = { generateCustomerToken, fetchCustomerProfile, checkCustomerStatus }
