# Technical Document

## Solution Overview

This project is an Adobe App Builder extension integrated into Adobe Commerce Admin. It provides an Admin UI to manage OTP-login module settings and exposes backend actions for customer authentication (register, login, profile update), OTP workflows, and module configuration.

Core modules:

- **UI**: `web-src/src/components/AdminUi.js`
- **Extension registration**: `web-src/src/components/ExtensionRegistration.js`
- **Customer action** (router): `actions/customer/index.js`
  - `actions/customer/services/otp.js` — OTP generate/verify gate
  - `actions/customer/services/login.js` — customer login (email or mobile)
  - `actions/customer/services/register.js` — customer registration with Commerce sync
  - `actions/customer/services/update.js` — customer profile update (email, mobile, name) with rollback
- **Config action**: `actions/config/index.js`
- **Standalone OTP action**: `actions/otp/otp.js`
- **Shared libraries**: `actions/lib/`
  - `http.js` — standardized HTTP response helpers
  - `db.js` — DB connection, query helpers, app config utilities
  - `graphql.js` — GraphQL request helper
  - `commerce.js` — shared Commerce operations (token generation, profile fetch)
  - `otp.js` — OTP generation and validation helpers
  - `params.js` — request parameter parsing and normalization
  - `customer.js` — customer identity helpers (ID parsing, token extraction, mobile/email utils)
- **Extension runtime config**: `ext.config.yaml`

## Runtime Architecture

- Frontend (React + Spectrum) is served from App Builder static hosting.
- Backend actions run on Adobe I/O Runtime (Node.js 22).
- Admin configuration is handled through the `config` web action.
- Customer operations (register/login/update) are handled through the `customer` web action.
- The `customer` action opens a **single DB connection** for the entire request lifecycle — OTP gate, identity checks, and service handlers all share the same connection, which is closed in a `finally` block.
- OTP standalone workflow is handled through the `otp` web action.

## Authentication and Authorization

- Sensitive actions are protected using `require-adobe-auth: true` in `ext.config.yaml`.
- Admin UI sends IMS auth headers (`Authorization`, `x-gw-ims-org-id`) from Commerce host context.
- If IMS context is unavailable, UI blocks save/load calls and shows a meaningful message.
- Customer-scoped Commerce mutations (email update, profile update) use the customer's bearer token.

## Data Backend

The solution uses Adobe Doc DB (`@adobe/aio-lib-db`) with `auto-provision: true` and region `apac`.

Collections:

- `app_config` — module configuration (enable/disable, OTP settings, etc.)
- `otps` — OTP records (reference IDs, expiry, consumed state)
- `customer_mobile_identity` — customer identity mapping (email, mobile, Commerce customer ID)

## Key APIs

- `GET /config` — fetch current module configuration.
- `POST /config` — create/update module configuration.
- `PUT /config` — update module configuration.
- `PATCH /config` — partial update module configuration.
- `DELETE /config` — reset module configuration.
- `POST /customer` `{operation: 'register'}` — register a new customer (OTP-gated).
- `POST /customer` `{operation: 'login'}` — login an existing customer (OTP-gated).
- `POST /customer` `{operation: 'updateCustomerDetails'}` — update customer profile (email, mobile, name).
- `POST /otp` (generate) — create OTP reference (standalone).
- `POST /otp` (validate) — verify OTP and issue token flow (standalone).

## Post-Deploy Hook

After deployment, `npm run setup-db` runs automatically to initialize DB indexes on the `customer_mobile_identity` collection.

## Common Failure and Fix

- **Error:** `missing authorization header`
  - Cause: IMS token not available in host context.
  - Fix: open extension from Commerce Admin and ensure host context is loaded.

- **Error:** `customer token is required/invalid for key info update`
  - Cause: customer bearer token missing or expired for profile update.
  - Fix: ensure the customer is logged in and token is passed in the request.

## Engineering Notes

- Do not log secrets such as raw DB passwords or bearer tokens.
- Use `LOG_LEVEL=debug` only for troubleshooting in non-production contexts.
- The `customer` action router manages the DB connection lifecycle — individual services receive `dbClient` and must not open/close their own connections.
- Commerce operations (`generateCustomerToken`, `fetchCustomerProfile`) are shared via `actions/lib/commerce.js` to avoid duplication.
- OTP generation uses `crypto.randomInt` (cryptographically secure) instead of `Math.random`.
