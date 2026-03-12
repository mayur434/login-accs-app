const { Core } = require('@adobe/aio-sdk')
const { generateAccessToken } = Core.AuthClient
const { stringParameters } = require('../utils')
const registerCustomer = require('./services/registerCustomer')
const loginCustomer = require('./services/loginCustomer')
const updateMobile = require('./services/updateMobile')

function getRequestParams (params) {
  let req = params

  if (params.params && typeof params.params === 'object') {
    req = params.params
  } else if (params.body) {
    try {
      req = typeof params.body === 'string' ? JSON.parse(params.body) : params.body
    } catch {
      req = params
    }
  } else if (params.__ow_body) {
    try {
      req = typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body
    } catch {
      req = params
    }
  }

  return { ...params, ...req }
}

function badRequest (message) {
  return {
    statusCode: 400,
    body: {
      error: message
    }
  }
}

function serverError () {
  return {
    statusCode: 500,
    body: {
      error: 'server error'
    }
  }
}

exports.main = async (params) => {
  const logger = Core.Logger('customerAuth', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('customerAuth action called')
    logger.debug(stringParameters(params))

    const requestParams = getRequestParams(params)

    // Generate IMS token for aio-lib-db (early-access DB requirement)
    try {
      const tokenResponse = await generateAccessToken(requestParams)
      const accessToken = tokenResponse && tokenResponse.access_token
      if (accessToken) {
        requestParams.AIO_DB_TOKEN = accessToken
      }
    } catch (e) {
      logger.warn(`Unable to generate IMS token for DB: ${e.message}`)
    }

    const operation = String(requestParams.operation || '').trim()

    if (!operation) {
      return badRequest("missing parameter(s) 'operation'")
    }

    switch (operation) {
      case 'register':
        return await registerCustomer(requestParams, logger)
      case 'login':
        return await loginCustomer(requestParams, logger)
      case 'updateMobile':
        return await updateMobile(requestParams, logger)
      default:
        return badRequest(`invalid operation: ${operation}`)
    }
  } catch (error) {
    logger.error(error)
    return serverError()
  }
}
