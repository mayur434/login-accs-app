# Setup Guide

## Prerequisites

- **Node.js** >= 18
- **Adobe I/O CLI** (`aio`) — install via `npm install -g @adobe/aio-cli`
- **App Builder workspace** with the following APIs enabled in Adobe Developer Console:
  - I/O Management API
  - App Builder Data Services (for Doc DB)
  - API Mesh (for storefront/mobile consumption)
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

> **Note:** In local dev, the Admin UI calls actions directly at `localhost:9080`. For storefront testing via API Mesh, you need to deploy actions first (see Deploy section).

## 5. Deploy

### Step 1: Deploy Actions & Admin UI

```bash
aio app deploy -e commerce/backend-ui/1
```

After deploy, the `post-app-deploy` hook automatically runs `npm run setup-db` to initialize DB indexes.

### Step 2: Deploy API Mesh (Frontend Gateway)

The API Mesh is required for storefronts and mobile apps to consume the Login Module. The mesh acts as the security boundary — `otp` and `customer` actions have `require-adobe-auth: false` and are only accessible through the mesh URL.

```bash
# 1. Fill in mesh/secrets.yaml with your deployed values
#    COMMERCE_GRAPHQL_ENDPOINT, ACTION_BASE_URL

# 2. Deploy the mesh
cd mesh
npm run create        # first time
npm run update        # update existing
npm run get           # get your mesh URL
```

### Undeploy

```bash
aio app undeploy
```

## 6. Configuration (ext.config.yaml)

The extension manifest defines four deployed actions:

| Action | Path | Auth | Access Layer |
|---|---|---|---|
| `otp` | `actions/otp/otp.js` | `require-adobe-auth: false` | API Mesh (frontend) |
| `customer` | `actions/customer/index.js` | `require-adobe-auth: false` | API Mesh (frontend) |
| `config` | `actions/config/index.js` | `require-adobe-auth: true` | Admin UI SDK (direct) |
| `registration` | `actions/registration/index.js` | `require-adobe-auth: true` | Admin UI SDK (direct) |

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
  config/            # Module config CRUD — Admin UI SDK only
  customer/          # Customer router — API Mesh only
    services/
      otp.js         # OTP gate (generate/verify)
      login.js       # Customer login
      register.js    # Customer registration
      update.js      # Customer profile update
  otp/               # Standalone OTP — API Mesh only
  registration/      # Extension menu — Admin UI SDK only
  init-identity/     # DB index initialization
mesh/                # API Mesh config (self-contained package)
  mesh.json          # Mesh sources (Commerce GraphQL + LoginModule)
  openapi.json       # OTP + Customer endpoints (single spec)
  secrets.yaml       # Secrets — COMMERCE_GRAPHQL_ENDPOINT, ACTION_BASE_URL (git-ignored)
  deploy.js          # Deploy script (reads secrets, patches spec, runs aio)
  package.json       # Mesh-specific npm scripts (create, update, get, describe)
web-src/             # React + Spectrum Admin UI (Commerce Admin extension)
scripts/
  setup-db.js        # DB collections, indexes & seed
  dev-setup.js       # All-in-one local dev starter
  mesh-deploy.js     # Reads secrets.yaml → deploys mesh
test/                # Unit tests (Jest)
e2e/                 # End-to-end tests
```

## Troubleshooting

| Problem | Context | Solution |
|---|---|---|
| `Missing required .env variables` | Setup | Run `aio app use` to generate `.env` |
| `missing authorization header` | Admin UI | Open extension from Commerce Admin to load IMS context |
| `401/403 on mesh calls` | API Mesh | Calling action directly instead of through mesh. Use `cd mesh && npm run get` to get the mesh URL |
| `database token missing` | Deploy | Ensure "App Builder Data Services" API is enabled in Developer Console |
| `GRAPHQL_ENDPOINT not configured` | Deploy | Set `GRAPHQL_ENDPOINT` in `.env` or `ext.config.yaml` inputs |
| DB already provisioned (exit code 1) | Setup | Safe to ignore — `npm run dev` handles this automatically |
| Storefront getting 401 calling action directly | Integration | Actions `otp`/`customer` are not auth-protected but their URLs are not published. Use the API Mesh URL instead. |
