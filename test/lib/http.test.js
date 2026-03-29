/**
 * Unit tests for actions/lib/http.js
 */

const {
  success, badRequest, unauthorized, forbidden,
  notFound, methodNotAllowed, conflict, serverError,
  errorResponse
} = require('../../actions/lib/http')

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
      expect(badRequest('missing field')).toEqual({ statusCode: 400, body: { error: 'missing field' } })
    })
  })

  describe('unauthorized', () => {
    test('returns 401 with error message', () => {
      expect(unauthorized('invalid token')).toEqual({ statusCode: 401, body: { error: 'invalid token' } })
    })
  })

  describe('forbidden', () => {
    test('returns 403 with error message', () => {
      expect(forbidden('access denied')).toEqual({ statusCode: 403, body: { error: 'access denied' } })
    })
  })

  describe('notFound', () => {
    test('returns 404 with error message', () => {
      expect(notFound('not found')).toEqual({ statusCode: 404, body: { error: 'not found' } })
    })
  })

  describe('methodNotAllowed', () => {
    test('returns 405 with error message', () => {
      expect(methodNotAllowed('GET only')).toEqual({ statusCode: 405, body: { error: 'GET only' } })
    })
  })

  describe('conflict', () => {
    test('returns 409 with error message', () => {
      expect(conflict('already exists')).toEqual({ statusCode: 409, body: { error: 'already exists' } })
    })
  })

  describe('serverError', () => {
    test('returns 500 with default message', () => {
      expect(serverError()).toEqual({ statusCode: 500, body: { error: 'server error' } })
    })

    test('returns 500 with custom message', () => {
      expect(serverError('db down')).toEqual({ statusCode: 500, body: { error: 'db down' } })
    })
  })

  describe('errorResponse', () => {
    test('returns error wrapper with statusCode and message', () => {
      const result = errorResponse(400, 'bad input')
      expect(result.error).toBeDefined()
      expect(result.error.statusCode).toBe(400)
      expect(result.error.body.error).toBe('bad input')
    })

    test('logs when logger provided', () => {
      const mockLogger = { info: jest.fn() }
      errorResponse(500, 'fail', mockLogger)
      expect(mockLogger.info).toHaveBeenCalledWith('500: fail')
    })
  })
})
