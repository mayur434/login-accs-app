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

The test suite covers all shared libraries, utilities, actions, and service handlers:

### Utility Tests (`test/utils.test.js`)

| Function | Tests | What's Verified |
|---|---|---|
| `errorResponse` | 2 | Error wrapper format, logger integration |
| `stringParameters` | 2 | Auth header masking, parameter serialization |
| `checkMissingRequestInputs` | 10 | Missing params, headers, nested keys, edge cases |
| `getBearerToken` | 5 | Bearer extraction, malformed headers, missing headers |
| `normalizeMobile` | 6 | Indian mobile normalization, country code handling, invalid input |

### Library Tests (`test/lib/`)

| Suite | Tests | Coverage |
|---|---|---|
| `http.test.js` | 10 | All response helpers (success/badRequest/unauthorized/forbidden/notFound/conflict/serverError/errorResponse) |
| `otp.test.js` | 10 | OTP format, uniqueness, reference ID format, Levenshtein distance (exact/close/far/empty/null) |
| `params.test.js` | 13 | hasValue, getRequestParams (__ow_body/body/params), normalizeRequestParams (aliases, loginType inference) |
| `customer.test.js` | 30 | parseCustomerIdValue, getCustomerId, parseCustomerIdFromToken, extractCustomerId, extractCustomerToken, extractBearerToken, getSyntheticEmail, getCommerceMobileValue, buildLoginType, normalizeEmailInput, normalizeMobile |
| `db.test.js` | 19 | APP_CONFIG_DEFAULTS (20 fields), error classifiers, normalizeAppConfig (defaults, actual values, auto_login compat, type coercion) |
| `template.test.js` | 8 | resolveTemplate (single/multiple/repeated placeholders, missing vars, null/empty template, type coercion) |
| `sms-email.test.js` | 6 | sendSmsOtp/sendEmailOtp (enabled/disabled template, empty template) |
| `graphql.test.js` | 9 | graphQLRequest (endpoint validation, headers, auth token, empty body, non-JSON, GraphQL errors, HTTP errors), commerceGraphQLRequest (admin URL rejection) |
| `commerce.test.js` | 4 | generateCustomerToken (success/missing token), fetchCustomerProfile (success/missing customer) |
| `db-adapters.test.js` | 7 | Adapter factory (default/docdb/mysql/case-insensitive/whitespace/unknown/env fallback) |

### Action Tests (`test/`)

| Suite | Tests | Coverage |
|---|---|---|
| `config.test.js` | 10 | GET config, POST validation (empty body, non-boolean, non-integer, non-string), valid inputs (boolean/SMS/email fields), auto_login compat, DELETE |
| `customer-services.test.js` | 16 | Register (missing password/identifiers, duplicate mobile, invalid mobile, successful email register), Login (missing password/email/mobile, mobile not found, successful email login), Update (missing customer_id/token/fields, key info disabled, identity not found, invalid mobile) |

**Total: 211 tests, 13 suites**

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

Actions depend on `@adobe/aio-sdk` and `@adobe/aio-lib-db` (DocDB backend). Mock them at the top of your test file:

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
| `template.js` | `resolveTemplate` | Placeholder substitution (`{{OTP}}`, `{{VALIDITY}}`), missing vars handling |
| `sms.js` | `sendSmsOtp` | Template dispatch when enabled, skip when disabled |
| `email.js` | `sendEmailOtp` | Template dispatch when enabled, skip when disabled |
| `db-adapters/index.js` | `getAdapter` | Returns correct adapter for `DB_TYPE` |
| `db-adapters/docdb-adapter.js` | `connect` | IMS token resolution, DocDB init |
| `db-adapters/mysql-adapter.js` | `connect`, `filterValidColumns`, `hydrateRow`, `toSqlValue` | SQL translation, column safety, boolean handling |

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

## Dual-Backend Integration Tests

The project includes a comprehensive integration test suite that runs against both DocDB and MySQL:

```bash
# Run against both backends (162 tests total)
node scripts/test-mysql.js

# Run against MySQL only (81 tests)
node scripts/test-mysql.js mysql

# Run against DocDB only (81 tests)
node scripts/test-mysql.js docdb
```

### Test Suites (per backend)

| Suite | Tests | Coverage |
|---|---|---|
| Adapter Layer | 23 | connect, list, findOne, insertOne, updateOne, deleteOne, upsert, unique constraints, filterValidColumns, getIndexes |
| db.js Facade | 13 | getCollection, getAppConfig, findOneOrNull, error classifiers, normalizeAppConfig |
| Config Action | 20 | GET, POST, PUT, PATCH, DELETE, validation, auto-create, backward compat |
| OTP Service | 16 | generate (email/mobile), verify (correct/wrong/consumed/bad ref), persistence |
| Customer Identity | 9 | insert, find by email/mobile/customer_id, update, upsert, delete |

> **Note:** Integration tests require a live database connection. For MySQL, ensure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` are set. For DocDB, ensure IMS credentials are configured.
