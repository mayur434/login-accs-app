# Setup Guide

## Prerequisites

- **Node.js** >= 18
- **Adobe I/O CLI** (`aio`) — install via `npm install -g @adobe/aio-cli`
- **App Builder workspace** with the following APIs enabled in Adobe Developer Console:
  - I/O Management API
  - App Builder Data Services (for Doc DB)
- **Adobe Commerce instance** with GraphQL endpoint accessible

## 1. Clone & Install

```bash
git clone <repository-url>
cd login-accs-app
npm install
```

## 2. Configure Environment

Generate the `.env` file from your App Builder workspace:

```bash
aio app use
```

This populates the required credentials:

| Variable | Description |
|---|---|
| `AIO_runtime_namespace` | I/O Runtime namespace |
| `AIO_runtime_auth` | I/O Runtime auth key |
| `IMS_OAUTH_S2S_CLIENT_ID` | OAuth S2S client ID |
| `IMS_OAUTH_S2S_CLIENT_SECRET` | OAuth S2S client secret |
| `IMS_OAUTH_S2S_ORG_ID` | IMS organization ID |
| `IMS_OAUTH_S2S_SCOPES` | OAuth scopes (JSON array) |

Additionally, set the following in your `.env` or as action inputs in `ext.config.yaml`:

| Variable | Description | Example |
|---|---|---|
| `GRAPHQL_ENDPOINT` | Commerce GraphQL URL | `https://your-store.com/graphql` |
| `GRAPHQL_API_KEY` | Commerce API key | `abc123` |
| `SERVICE_API_KEY` | Service API key for auth | `xyz789` |

> **Note:** `.env` is gitignored and must never be committed to source control.

## 3. Database Setup

The database auto-provisions on deploy (`auto-provision: true` in `app.config.yaml`). For local development, run the setup script manually:

```bash
npm run setup-db
```

This script:

1. Generates an IMS access token from `.env` credentials
2. Connects to Adobe Doc DB (region: `apac`)
3. Creates collections: `app_config`, `otps`, `customer_mobile_identity`
4. Creates unique indexes on `customer_mobile_identity` (`mobile_number`, `email`, `customer_id`)
5. Seeds the default `app_config` document

## 4. Local Development

### Quick Start (all-in-one)

```bash
npm run dev
```

This validates `.env`, runs DB setup, and starts `aio app dev`.

### Manual Start

```bash
aio app dev -e commerce/backend-ui/1
```

The app runs on `localhost:9080` by default. Actions are served from I/O Runtime (or locally with `aio app dev`).

## 5. Deploy

```bash
aio app deploy
```

After deploy, the `post-app-deploy` hook automatically runs `npm run setup-db` to initialize DB indexes.

### Undeploy

```bash
aio app undeploy
```

## 6. Configuration (ext.config.yaml)

The extension manifest defines four deployed actions:

| Action | Path | Auth Required | Description |
|---|---|---|---|
| `otp` | `actions/otp/otp.js` | Yes | Standalone OTP generate/verify |
| `config` | `actions/config/index.js` | Yes | Module configuration CRUD |
| `customer` | `actions/customer/index.js` | Yes | Customer register/login/update |
| `registration` | `actions/registration/index.js` | No | Extension menu registration |

### Action Inputs

Actions that interact with Commerce require `GRAPHQL_ENDPOINT` and `GRAPHQL_API_KEY`. All actions receive `LOG_LEVEL` (default: `debug`) and `apikey` (`$SERVICE_API_KEY`).

## 7. Project Structure

```
actions/
  lib/              # Shared libraries
    http.js          # HTTP response helpers
    db.js            # DB connection & query helpers
    graphql.js       # GraphQL request helper
    commerce.js      # Commerce token/profile operations
    otp.js           # OTP generation & validation
    params.js        # Request parameter parsing
    customer.js      # Customer identity helpers
  config/            # Module configuration CRUD action
  customer/          # Customer router action
    services/
      otp.js         # OTP gate (generate/verify)
      login.js       # Customer login
      register.js    # Customer registration
      update.js      # Customer profile update
  otp/               # Standalone OTP action
  registration/      # Extension menu registration
  init-identity/     # DB index initialization
web-src/             # React + Spectrum Admin UI
scripts/
  setup-db.js        # DB collections, indexes & seed
  dev-setup.js       # All-in-one local dev starter
test/                # Unit tests (Jest)
e2e/                 # End-to-end tests
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `Missing required .env variables` | Run `aio app use` to generate `.env` |
| `missing authorization header` | Open extension from Commerce Admin to load IMS context |
| `database token missing` | Ensure "App Builder Data Services" API is enabled in Developer Console |
| `GRAPHQL_ENDPOINT not configured` | Set `GRAPHQL_ENDPOINT` in `.env` or `ext.config.yaml` inputs |
| DB already provisioned (exit code 1) | Safe to ignore — `npm run dev` handles this automatically |
