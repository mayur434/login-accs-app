# Testing Guide

## Overview

The project uses **Jest** (v29) for both unit and end-to-end tests. Tests run on Node.js >= 18.

## Access Layer Context

When writing tests, keep in mind the two access layers:

- **Admin UI SDK actions** (`config`, `registration`) \u2014 called directly with IMS auth from Commerce Admin (`require-adobe-auth: true`)
- **API Mesh actions** (`otp`, `customer`) \u2014 called through API Mesh (`require-adobe-auth: false`). The mesh is the security boundary; frontend consumers never pass IMS tokens.

Unit tests mock auth at the action level regardless of access layer.

## Running Tests

### Unit Tests

```bash
npm test
```

This runs all tests in the `test/` directory with `--passWithNoTests`.

### End-to-End Tests

```bash
npm run e2e
```

This runs tests in the `e2e/` directory without coverage collection.

### Via AIO CLI

```bash
aio app test          # unit tests
aio app test --e2e    # e2e tests
```

### With Coverage

```bash
npx jest --coverage ./test
```

## Test Structure

```
test/
  utils.test.js      # Unit tests for shared utilities
e2e/
  (e2e test files)
jest.setup.js         # Global test setup (timeout, hooks)
```

## Current Test Coverage

The existing test suite (`test/utils.test.js`) covers the public API of `actions/utils.js`:

| Function | Tests | What's Verified |
|---|---|---|
| `errorResponse` | 2 | Correct error wrapper format, logger integration |
| `stringParameters` | 2 | Auth header masking, parameter serialization |
| `checkMissingRequestInputs` | 10 | Missing params, headers, nested keys, edge cases |
| `getBearerToken` | 5 | Bearer extraction, malformed headers, missing headers |
| `normalizeMobile` | 6 | Indian mobile normalization, country code handling, invalid input |

**Total: 28 tests, 1 suite**

## Writing New Tests

### File Naming

- Unit tests: `test/<module-name>.test.js`
- E2e tests: `e2e/<feature>.e2e.test.js`

### Test Template

```javascript
const { functionUnderTest } = require('../actions/lib/<module>')

describe('<module-name>', () => {
  describe('functionUnderTest', () => {
    test('should handle valid input', () => {
      const result = functionUnderTest(validInput)
      expect(result).toEqual(expectedOutput)
    })

    test('should handle edge case', () => {
      expect(() => functionUnderTest(badInput)).toThrow('error message')
    })
  })
})
```

### Mocking Adobe SDKs

Actions depend on `@adobe/aio-sdk` and `@adobe/aio-lib-db`. Mock them at the top of your test file:

```javascript
jest.mock('@adobe/aio-sdk', () => ({
  Core: {
    Logger: jest.fn().mockReturnValue({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }),
    AuthClient: {
      generateAccessToken: jest.fn().mockResolvedValue({ access_token: 'mock-token' })
    }
  }
}))

jest.mock('@adobe/aio-lib-db', () => ({
  init: jest.fn().mockResolvedValue({
    connect: jest.fn().mockResolvedValue({
      collection: jest.fn().mockResolvedValue({
        findOne: jest.fn(),
        insertOne: jest.fn(),
        updateOne: jest.fn(),
        deleteOne: jest.fn()
      }),
      close: jest.fn()
    })
  })
}))
```

### Mocking GraphQL (node-fetch)

```javascript
jest.mock('node-fetch', () =>
  jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({
      data: { /* mock response */ }
    })
  })
)
```

## Testable Modules (Shared Libraries)

These modules in `actions/lib/` are pure functions or have minimal dependencies, making them easy to unit test:

| Module | Key Exports | Test Focus |
|---|---|---|
| `http.js` | `success`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `serverError`, `errorResponse` | Status codes, body format |
| `otp.js` | `generateOtpValue`, `createReferenceId`, `levenshtein` | OTP format (4 digits), reference ID format, edit distance accuracy |
| `params.js` | `hasValue`, `getRequestParams`, `normalizeRequestParams` | Null/empty handling, `__ow_body` parsing, field alias normalization |
| `customer.js` | `parseCustomerIdValue`, `getCustomerId`, `getSyntheticEmail`, `normalizeMobile`, `buildLoginType`, `extractCustomerId` | Base64 decoding, ID extraction, email generation, mobile validation |
| `commerce.js` | `generateCustomerToken`, `fetchCustomerProfile` | Mock GraphQL responses, error handling |
| `db.js` | `findOneOrNull`, `isUniqueConstraintError`, `normalizeAppConfig` | Error classification, config defaults |

## Testing Service Handlers

Service handlers (`actions/customer/services/*.js`) accept `(dbClient, params, logger)`. These are consumed via API Mesh in production, but in unit tests you call them directly with a mock `dbClient`:

```javascript
const register = require('../actions/customer/services/register')

const mockCollection = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn()
}

const mockDbClient = {
  collection: jest.fn().mockResolvedValue(mockCollection),
  close: jest.fn()
}

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}

test('register returns 400 when password missing', async () => {
  const result = await register(mockDbClient, { email: 'a@b.com' }, mockLogger)
  expect(result.statusCode).toBe(400)
})
```

## Testing Admin UI SDK Actions (Config)

The `config` action is called directly from Admin UI SDK. Test it the same way — mock the DB and call `main(params)`:

```javascript
const { main } = require('../actions/config/index')

test('GET config returns defaults', async () => {
  // Mock DB, call main with __ow_method: 'GET'
  const result = await main({ __ow_method: 'GET', ...mockDbParams })
  expect(result.statusCode).toBe(200)
  expect(result.body.is_enabled).toBe(false)
})
```

## Linting

```bash
npm run lint          # check for lint errors
npm run lint:fix      # auto-fix lint errors
```

ESLint is configured with `eslint-plugin-jest` and scans `test/`, `src/`, and `actions/` directories.

## CI Integration

For CI pipelines, run the full validation suite:

```bash
npm install
npm run lint
npm test
npm run e2e
```
