/**
 * Unit tests for lib/http.js
 */

const {
  success, badRequest, unauthorized, forbidden,
  notFound, methodNotAllowed, conflict, serverError,
  errorResponse
} = require('../../lib/http')

describe('http response helpers', () => {
  describe('success', () => {
    test('returns 200 with body', () => {
      const result = success({ foo: 'bar' })
      expect(result).toEqual({ statusCode: 200, body: { foo: 'bar' } })
    })

    test('returns 200 with null body', () => {
      expect(success(null)).toEqual({ statusCode: 200, body: null })
    })
  })

  describe('badRequest', () => {
    test('returns 400 with error message', () => {
      expect(badRequest('missing field')).toEqual({ statusCode: 200, body: { success: false, statusCode: 400, error: 'missing field', message: 'missing field' } })
    })
  })

  describe('unauthorized', () => {
    test('returns 401 with error message', () => {
      expect(unauthorized('invalid token')).toEqual({ statusCode: 200, body: { success: false, statusCode: 401, error: 'invalid token', message: 'invalid token' } })
    })
  })

  describe('forbidden', () => {
    test('returns 403 with error message', () => {
      expect(forbidden('access denied')).toEqual({ statusCode: 200, body: { success: false, statusCode: 403, error: 'access denied', message: 'access denied' } })
    })
  })

  describe('notFound', () => {
    test('returns 404 with error message', () => {
      expect(notFound('not found')).toEqual({ statusCode: 200, body: { success: false, statusCode: 404, error: 'not found', message: 'not found' } })
    })
  })

  describe('methodNotAllowed', () => {
    test('returns 405 with error message', () => {
      expect(methodNotAllowed('GET only')).toEqual({ statusCode: 200, body: { success: false, statusCode: 405, error: 'GET only', message: 'GET only' } })
    })
  })

  describe('conflict', () => {
    test('returns 409 with error message', () => {
      expect(conflict('already exists')).toEqual({ statusCode: 200, body: { success: false, statusCode: 409, error: 'already exists', message: 'already exists' } })
    })
  })

  describe('serverError', () => {
    test('returns 500 with default message', () => {
      expect(serverError()).toEqual({ statusCode: 200, body: { success: false, statusCode: 500, error: 'server error', message: 'server error' } })
    })

    test('returns 500 with custom message', () => {
      expect(serverError('db down')).toEqual({ statusCode: 200, body: { success: false, statusCode: 500, error: 'db down', message: 'db down' } })
    })
  })

  describe('errorResponse', () => {
    test('returns standard response with statusCode and message', () => {
      const result = errorResponse(400, 'bad input')
      expect(result).toEqual({ statusCode: 200, body: { success: false, statusCode: 400, error: 'bad input', message: 'bad input' } })
    })

    test('logs when logger provided', () => {
      const mockLogger = { info: jest.fn() }
      errorResponse(500, 'fail', mockLogger)
      expect(mockLogger.info).toHaveBeenCalledWith('500: fail')
    })
  })
})
