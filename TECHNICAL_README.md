# Technical Document

## Solution Overview

This project is an Adobe App Builder extension with two distinct access layers:

1. **Admin UI SDK** — A React + Spectrum UI running inside Adobe Commerce Admin that calls the `config` action directly using IMS auth from the host context.
2. **API Mesh** — A gateway that proxies storefront/mobile requests to the `otp` and `customer` actions. These actions have `require-adobe-auth: false` — the mesh URL is the only published endpoint, acting as the security boundary. Frontend consumers never handle IMS credentials.

### Core Modules

**Admin UI SDK (direct action calls):**

- **UI**: `web-src/src/components/AdminUi.js` — Module configuration panel
- **Extension registration**: `web-src/src/components/ExtensionRegistration.js`
- **Config action**: `actions/config/index.js` — Module configuration CRUD
- **Registration action**: `actions/registration/index.js` — Commerce Admin menu registration

**API Mesh (frontend consumption):**

- **Customer action** (router): `actions/customer/index.js`
  - `actions/customer/services/otp.js` — OTP generate/verify gate
  - `actions/customer/services/login.js` — customer login (email or mobile)
  - `actions/customer/services/register.js` — customer registration with Commerce sync
  - `actions/customer/services/update.js` — customer profile update (email, mobile, name) with rollback
- **Standalone OTP action**: `actions/otp/otp.js`

**Shared libraries** (`actions/lib/`):

- `http.js` — standardized HTTP response helpers
- `db.js` — DB connection, query helpers, app config utilities
- `graphql.js` — GraphQL request helper
- `commerce.js` — shared Commerce operations (token generation, profile fetch)
- `otp.js` — OTP generation and validation helpers
- `params.js` — request parameter parsing and normalization
- `customer.js` — customer identity helpers (ID parsing, token extraction, mobile/email utils)

## Solution Architecture

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Storefront / Mobile    │     │    Commerce Admin         │
│  (React, Next.js, etc.) │     │    (Admin UI SDK)         │
└────────┬────────────────┘     └────────┬─────────────────┘
         │ no auth needed                │ IMS token (host context)
         ▼                              ▼
┌─────────────────┐            ┌──────────────────────────┐
│   API Mesh      │            │  Config / Registration   │
│   (mesh.json)   │            │  Actions (direct call)   │
│   gateway       │            └──────────────────────────┘
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

## Two Access Layers

### Layer 1: Admin UI SDK → Direct Action Calls

The Admin UI extension runs inside Commerce Admin and receives IMS credentials from the host context automatically. It calls the `config` action directly:

- **Auth mechanism**: IMS token (`Authorization: Bearer <IMS_TOKEN>`) + org ID (`x-gw-ims-org-id`) injected by Commerce Admin host
- **Actions called**: `config` (GET/POST/PUT/PATCH/DELETE), `registration` (GET)
- **Consumers**: Commerce Admin users only
- **No API Mesh involved**

### Layer 2: API Mesh → Proxied Action Calls

Storefronts, mobile apps, and websites consume the Login Module through Adobe API Mesh. The mesh acts as a **security boundary** that:

- **Gates access** — the mesh URL is the only published endpoint; direct action URLs are not exposed to consumers
- **Exposes** clean REST endpoints defined by a single OpenAPI spec (`mesh/openapi.json`)
- **Coexists** with the Commerce GraphQL source for unified gateway access

The `otp` and `customer` actions have `require-adobe-auth: false` — no IMS or S2S tokens are needed.

Actions proxied through the mesh:

| Action | Endpoint | Operations |
|---|---|---|
| `otp` | `POST /otp` | Generate OTP, validate OTP |
| `customer` | `POST /customer` | Register, login, update profile |

### Runtime Details

- Backend actions run on Adobe I/O Runtime (Node.js 22).
- Frontend (React + Spectrum) is served from App Builder static hosting inside Commerce Admin.
- The `customer` action opens a **single DB connection** for the entire request lifecycle — OTP gate, identity checks, and service handlers all share the same connection, which is closed in a `finally` block.

## API Mesh Configuration

### Mesh Sources

| Source        | Handler  | Spec                 | Description                                  |
|---------------|----------|----------------------|----------------------------------------------|
| Commerce      | graphql  | —                    | Commerce GraphQL endpoint                    |
| LoginModule   | openapi  | `mesh/openapi.json`  | OTP + Customer actions (register/login/update) |

### Mesh Auth (S2S)

The mesh injects auth headers from environment variables — **not from client request headers**:

```json
"operationHeaders": {
  "Authorization": "Bearer {env.MESH_IMC_ACCESS_TOKEN}",
  "x-gw-ims-org-id": "{env.IMS_ORG_ID}"
}
```

| Env Variable            | Source                                                     |
|-------------------------|------------------------------------------------------------|
| `MESH_IMC_ACCESS_TOKEN` | S2S OAuth token from the App Builder project credentials    |
| `IMS_ORG_ID`            | IMS Organization ID from Adobe Developer Console           |

Generate the S2S token using the project's OAuth credentials:

```bash
curl -X POST https://ims-na1.adobelogin.com/ims/token/v3 \
  -d "grant_type=client_credentials" \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "scope=openid,AdobeID,adobeio_api"
```

### Mesh Deployment

The `mesh/` folder is a self-contained package with its own `package.json`:

```bash
# 1. Deploy actions first
aio app deploy -e commerce/backend-ui/1

# 2. Fill in mesh/.env.mesh with deployed values
#    COMMERCE_GRAPHQL_ENDPOINT, ACTION_BASE_URL

# 3. Deploy the mesh
cd mesh
npm run create        # first time
npm run update        # update existing
npm run get           # get your mesh URL
```

All mesh secrets are stored in `mesh/.env.mesh` (git-ignored) and passed to `aio api-mesh` via `--env` flag.

## Authentication and Authorization

| Access Path | Auth Mechanism | Who Manages Auth | Consumer |
|---|---|---|---|
| Admin UI SDK → `config` | IMS token from Commerce Admin host context | Adobe Commerce (automatic) | Admin users |
| Admin UI SDK → `registration` | IMS token from Commerce Admin host context | Adobe Commerce (automatic) | Admin users |
| API Mesh → `otp` | None (`require-adobe-auth: false`) | Mesh is the security boundary | Storefronts, mobile apps |
| API Mesh → `customer` | None (`require-adobe-auth: false`) | Mesh is the security boundary | Storefronts, mobile apps |

- `config` and `registration` are protected with `require-adobe-auth: true` in `ext.config.yaml`.
- `otp` and `customer` have `require-adobe-auth: false` — the API Mesh acts as the security boundary. Direct action URLs are not published.
- Storefronts and mobile apps **never** need to pass IMS tokens — they call the mesh URL directly.
- Admin UI users **never** need to manually obtain tokens — Commerce Admin host context provides them.

## Data Backend

The solution uses Adobe Doc DB (`@adobe/aio-lib-db`) with `auto-provision: true` and region `apac`.

Collections:

- `app_config` — module configuration (enable/disable, OTP settings, etc.)
- `otps` — OTP records (reference IDs, expiry, consumed state)
- `customer_mobile_identity` — customer identity mapping (email, mobile, Commerce customer ID)

## Key APIs

### Admin UI SDK (Direct)

- `GET /config` — fetch current module configuration.
- `POST /config` — create/update module configuration.
- `PUT /config` — update module configuration.
- `PATCH /config` — partial update module configuration.
- `DELETE /config` — reset module configuration.

### API Mesh (Frontend)

- `POST /otp` (generate) — create OTP reference.
- `POST /otp` (validate) — verify OTP and issue token.
- `POST /customer` `{operation: 'register'}` — register a new customer (OTP-gated).
- `POST /customer` `{operation: 'login'}` — login an existing customer (OTP-gated).
- `POST /customer` `{operation: 'updateCustomerDetails'}` — update customer profile.

## Post-Deploy Hook

After deployment, `npm run setup-db` runs automatically to initialize DB indexes on the `customer_mobile_identity` collection.

## Common Failure and Fix

- **Error:** `missing authorization header`
  - Context: Admin UI trying to call `config` action.
  - Cause: IMS token not available in host context.
  - Fix: Open extension from Commerce Admin and ensure host context is loaded.

- **Error:** `customer token is required/invalid for key info update`
  - Context: Storefront calling `customer` action via mesh.
  - Cause: Customer bearer token missing or expired for profile update.
  - Fix: Ensure the customer is logged in and token is passed in the request payload.

- **Error:** 401/403 on mesh calls
  - Context: Action rejecting requests.
  - Cause: Calling action directly instead of through mesh, or mesh URL misconfigured.
  - Fix: Use the mesh URL (get via `cd mesh && npm run get`). Ensure `ACTION_BASE_URL` in `.env.mesh` is correct.

## Engineering Notes

- Do not log secrets such as raw DB passwords or bearer tokens.
- Use `LOG_LEVEL=debug` only for troubleshooting in non-production contexts.
- The `customer` action router manages the DB connection lifecycle — individual services receive `dbClient` and must not open/close their own connections.
- Commerce operations (`generateCustomerToken`, `fetchCustomerProfile`) are shared via `actions/lib/commerce.js` to avoid duplication.
- OTP generation uses `crypto.randomInt` (cryptographically secure) instead of `Math.random`.
- The `config` action is **excluded** from the API Mesh — it is only accessible via the Admin UI SDK with IMS auth from the Commerce Admin host context.
