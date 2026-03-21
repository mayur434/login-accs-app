# login-module

OTP-based customer authentication module for Adobe Commerce, built on Adobe App Builder.

## What This App Does

This module adds OTP (One-Time Password) based customer authentication to Adobe Commerce. It runs as an App Builder extension inside the Commerce Admin panel, providing:

- **Customer Registration** — OTP-verified registration that creates customers in Commerce and maintains an identity mapping (mobile ↔ email ↔ Commerce customer ID)
- **Customer Login** — OTP-gated login via mobile number or email, with automatic mobile-to-email resolution
- **Customer Profile Update** — Update mobile, email, or name with automatic Commerce sync and rollback safety
- **Admin Configuration** — Self-service UI in Commerce Admin to control OTP validity, auto-login, module enable/disable, and more
- **Standalone OTP** — Independent OTP generate/verify endpoint with auto-register capability

## Business Use Case

Commerce operations teams need controlled, OTP-based customer authentication — without requiring code deployments for every policy change. This module solves:

- **Mobile-first identity** — Customers register/login using mobile numbers. The module maps mobiles to Commerce email accounts transparently.
- **Centralized policy control** — Admin users toggle OTP settings, auto-login behavior, and profile update permissions from the Commerce Admin UI.
- **No-code operations** — Config changes take effect immediately via the Admin UI. No redeployment required.
- **Secure onboarding** — Every register/login is OTP-gated. OTPs use cryptographic randomness, expiry windows, and single-use enforcement.

## Where to Integrate

This extension is designed to be called from:

- **Headless / PWA storefronts** — Call the `customer` action's REST API from any frontend (React, Next.js, mobile apps) for register/login/update flows
- **Commerce Admin** — The Admin UI extension is auto-registered under **Customer Module → Login Module** in the Commerce Admin sidebar
- **Third-party systems** — Any system with valid IMS credentials can call the REST APIs for customer operations
- **Mobile apps** — Use the OTP flow for mobile-first authentication without requiring email at registration

### Integration Points

| Use Case | Action | Endpoint |
|---|---|---|
| Register customer | `customer` | `POST /customer` with `operation: register` |
| Login customer | `customer` | `POST /customer` with `operation: login` |
| Update profile | `customer` | `POST /customer` with `operation: updateCustomerDetails` |
| Manage module settings | `config` | `GET/POST/PUT/PATCH/DELETE /config` |
| Standalone OTP | `otp` | `POST /otp` |
| Admin menu registration | `registration` | `POST /registration` |

### API Base URLs

| Environment | Base URL |
|---|---|
| Local dev | `https://localhost:9080/api/v1/web/login-module` |
| Deployed | `https://<namespace>.adobeioruntime.net/api/v1/web/login-module` |

## Requirements

### Platform

- Adobe App Builder workspace with I/O Runtime
- Adobe Commerce instance with GraphQL endpoint
- Adobe Doc DB (auto-provisioned via `app.config.yaml`)
- Node.js >= 18

### Adobe Developer Console APIs

- I/O Management API
- App Builder Data Services (for Doc DB)

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AIO_runtime_namespace` | Yes | I/O Runtime namespace |
| `AIO_runtime_auth` | Yes | I/O Runtime auth key |
| `IMS_OAUTH_S2S_CLIENT_ID` | Yes | OAuth S2S client ID |
| `IMS_OAUTH_S2S_CLIENT_SECRET` | Yes | OAuth S2S client secret |
| `IMS_OAUTH_S2S_ORG_ID` | Yes | IMS organization ID |
| `GRAPHQL_ENDPOINT` | Yes | Commerce GraphQL URL |
| `GRAPHQL_API_KEY` | Yes | Commerce API key |
| `SERVICE_API_KEY` | Yes | Service API key |

Generate via `aio app use`, then add Commerce-specific variables.

## Quick Start

```bash
npm install
aio app use            # generate .env
npm run setup-db       # create collections & indexes
aio app dev -e commerce/backend-ui/1   # start local dev
```

Or use the all-in-one dev script:

```bash
npm run dev
```

## Deploy

```bash
aio app deploy         # build, deploy actions + static UI
aio app undeploy       # remove deployment
```

The `post-app-deploy` hook automatically runs `npm run setup-db` after each deploy.

## Test

```bash
npm test               # unit tests (Jest)
npm run e2e            # end-to-end tests
npm run lint           # ESLint
```

## Project Structure

```
actions/
  lib/            # Shared libraries (http, db, graphql, commerce, otp, params, customer)
  config/         # Module configuration CRUD action
  customer/       # Customer router action (register/login/update)
    services/     # Service handlers (otp, login, register, update)
  otp/            # Standalone OTP generate/verify action
  registration/   # Extension menu registration
  init-identity/  # DB index initialization (used by setup-db)
web-src/          # React + Spectrum Admin UI
scripts/          # Setup and dev scripts
test/             # Unit tests
e2e/              # End-to-end tests
```

## Documents

- [Setup Guide](SETUP_GUIDE.md) — prerequisites, installation, configuration, and deployment
- [Testing Guide](TESTING_GUIDE.md) — running tests, writing new tests, mocking, and CI
- [Dev & Integration Testing Guide](DEV_INTEGRATION_GUIDE.md) — cURL samples, Postman setup, request/response reference, end-to-end flows
- [Technical Documentation](TECHNICAL_README.md) — architecture, APIs, shared libraries, and engineering notes
- [Business Documentation](BUSINESS_README.md) — objectives, success criteria, rollout plan, and risks
