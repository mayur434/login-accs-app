# login-module

OTP-based customer authentication module for Adobe Commerce, built on Adobe App Builder.

## What This App Does

This module adds OTP (One-Time Password) based customer authentication to Adobe Commerce. It has two distinct layers:

### For Storefronts & Mobile Apps (via API Mesh)

- **Customer Registration** — OTP-verified registration that creates customers in Commerce and maintains an identity mapping (mobile ↔ email ↔ Commerce customer ID)
- **Customer Login** — OTP-gated login via mobile number or email, with automatic mobile-to-email resolution
- **Customer Profile Update** — Update mobile, email, or name with automatic Commerce sync and rollback safety
- **Standalone OTP** — Independent OTP generate/verify endpoint with auto-register capability

All frontend-facing APIs are consumed exclusively through **Adobe API Mesh**. The mesh acts as the gateway — storefronts and mobile apps never need IMS credentials.

### For Commerce Admin (via Admin UI SDK)

- **Admin Configuration** — Self-service UI in Commerce Admin to control OTP validity, auto-login, module enable/disable, and more

The Admin UI runs as an App Builder extension within Adobe Commerce Admin. It calls the `config` action directly using the IMS token provided by the host context.

## Architecture

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Storefront / Mobile    │     │    Commerce Admin         │
│  (React, Next.js, etc.) │     │    (Admin UI SDK)         │
└────────┬────────────────┘     └────────┬─────────────────┘
         │ no auth needed                │ IMS token (host context)
         ▼                              ▼
┌─────────────────┐            ┌─────────────────┐
│   API Mesh      │            │  Config Action   │ ← direct call
│   (mesh.json)   │            │  (Admin UI only) │
│   gateway       │            └─────────────────┘
└──┬──────────┬───┘
   │          │
   ▼          ▼
  OTP      Customer     ← App Builder actions (require-adobe-auth: false)
   │          │
   ▼          ▼
┌─────────────────┐
│   Commerce      │ ← GraphQL backend
│   + Doc DB      │
└─────────────────┘
```

## Where to Integrate

### Storefronts & Mobile Apps → API Mesh

All customer-facing operations go through the API Mesh gateway:

| Use Case | Mesh Operation | Payload |
|---|---|---|
| Register customer | `POST /otp` → `POST /customer` | `operation: register` |
| Login customer | `POST /otp` → `POST /customer` | `operation: login` |
| Update profile | `POST /customer` | `operation: updateCustomerDetails` |
| Standalone OTP | `POST /otp` | Generate or validate |

**Mesh URL:** `https://<mesh-id>.runtime.adobe.io/<api-path>`

No auth headers required — the mesh acts as the security gateway.

### Commerce Admin → Direct Action

| Use Case | Action | Access |
|---|---|---|
| Manage module settings | `config` | Admin UI SDK (IMS auth from host) |
| Admin menu registration | `registration` | Admin UI SDK (extension registration) |

## Requirements

### Platform

- Adobe App Builder workspace with I/O Runtime
- Adobe Commerce instance with GraphQL endpoint
- Adobe API Mesh (for frontend consumption)
- Adobe Doc DB (auto-provisioned via `app.config.yaml`)
- Node.js >= 18

### Adobe Developer Console APIs

- I/O Management API
- App Builder Data Services (for Doc DB)
- API Mesh

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

### 1. Deploy Actions & Admin UI

```bash
aio app deploy -e commerce/backend-ui/1
```

The `post-app-deploy` hook automatically runs `npm run setup-db` after each deploy.

### 2. Deploy API Mesh (Frontend Gateway)

```bash
# 1. Fill in mesh/secrets.yaml with your deployed values
#    COMMERCE_GRAPHQL_ENDPOINT, ACTION_BASE_URL

# 2. Deploy the mesh
cd mesh
npm run create        # first time
npm run update        # update existing
npm run get           # get your mesh URL
```

See [Technical Documentation](TECHNICAL_README.md) for details.

### Undeploy

```bash
aio app undeploy       # remove actions + static UI
```

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
  config/         # Module config CRUD — Admin UI SDK only
  customer/       # Customer router (register/login/update) — via API Mesh
    services/     # Service handlers (otp, login, register, update)
  otp/            # Standalone OTP generate/verify — via API Mesh
  registration/   # Extension menu registration — Admin UI SDK
  init-identity/  # DB index initialization (used by setup-db)
mesh/             # API Mesh config (self-contained package)
  mesh.json       # Mesh sources (Commerce GraphQL + LoginModule REST)
  openapi.json    # OTP + Customer endpoints (single spec)
  secrets.yaml    # Secrets — COMMERCE_GRAPHQL_ENDPOINT, ACTION_BASE_URL (git-ignored)
  deploy.js       # Deploy script (reads secrets, patches spec, runs aio)
  package.json    # Mesh-specific npm scripts (create, update, get, describe)
web-src/          # React + Spectrum Admin UI (Commerce Admin extension)
scripts/          # Setup and dev scripts
test/             # Unit tests
e2e/              # End-to-end tests
```

## Documents

- [Setup Guide](SETUP_GUIDE.md) — prerequisites, installation, configuration, and deployment
- [Testing Guide](TESTING_GUIDE.md) — running tests, writing new tests, mocking, and CI
- [Dev & Integration Testing Guide](DEV_INTEGRATION_GUIDE.md) — cURL samples, Postman setup, request/response reference, end-to-end flows
- [API Documentation (Postman)](https://documenter.getpostman.com/view/38215772/2sBXijJBVG) — interactive API reference with request/response examples
- [Technical Documentation](TECHNICAL_README.md) — architecture, mesh config, S2S auth, shared libraries, and engineering notes
- [Business Documentation](BUSINESS_README.md) — objectives, success criteria, rollout plan, and risks
