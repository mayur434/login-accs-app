# Dev & Integration Testing Guide

Complete reference for testing all actions — via Admin UI SDK (direct calls) and API Mesh (frontend consumption).

---

## Access Layers

This module has two distinct access layers. Use the correct base URL for each:

| Layer | Consumer | Base URL | Auth |
|---|---|---|---|
| **Admin UI SDK** | Commerce Admin | `https://localhost:9080/api/v1/web/login-module` (local) or deployed URL | IMS token (automatic from host) |
| **API Mesh** | Storefronts, mobile apps | `https://<mesh-id>.runtime.adobe.io/<api-path>` | None required (mesh is the security boundary) |

> **Important:** The `otp` and `customer` actions have `require-adobe-auth: false` and are accessible through API Mesh for frontend consumers. The `config` and `registration` actions have `require-adobe-auth: true` and are only accessible via Admin UI SDK (direct call with IMS auth). Direct action URLs for `otp`/`customer` are not published — the mesh URL is the only frontend endpoint.

---

## Part 1: Admin UI SDK — Direct Action Calls

These actions are called directly from the Commerce Admin UI extension. IMS auth is provided by the Commerce Admin host context.

### 1. Registration Action

Returns the Commerce Admin menu structure.

#### cURL

```bash
curl -X POST "{{ADMIN_BASE_URL}}/registration" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}"
```

#### Response (200)

```json
{
  "registration": {
    "menuItems": [
      {
        "id": "customer-module::apps",
        "title": "Customer Module",
        "isSection": true,
        "sortOrder": 100
      },
      {
        "id": "customer-module::admin",
        "title": "Login Module",
        "parent": "customer-module::apps",
        "sortOrder": 1
      }
    ],
    "page": {
      "title": "Login Module"
    }
  }
}
```

### 2. Config Action

CRUD operations for module configuration. Called from Admin UI SDK only.

#### 2.1 Get Config

```bash
curl -X GET "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}"
```

**Response (200):**

```json
{
  "is_enabled": true,
  "otp_expiration_validity": 5,
  "otp_in_response": false,
  "auto_login": false,
  "allow_key_info_update": false
}
```

#### 2.2 Update Config (POST / PUT / PATCH)

```bash
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "is_enabled": true,
    "otp_expiration_validity": 10,
    "otp_in_response": true,
    "auto_login": true,
    "allow_key_info_update": true
  }'
```

**Response (200):**

```json
{
  "is_enabled": true,
  "otp_expiration_validity": 10,
  "otp_in_response": true,
  "auto_login": true,
  "allow_key_info_update": true,
  "updatedAt": 1711017600000
}
```

**Validation Error (400):**

```json
{
  "error": "is_enabled must be boolean; otp_expiration_validity must be a positive integer"
}
```

#### 2.3 Delete Config

```bash
curl -X DELETE "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}"
```

**Response (200):**

```json
{
  "success": true,
  "message": "app_config deleted"
}
```

#### Config Field Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `is_enabled` | boolean | `false` | Master switch for OTP module |
| `otp_expiration_validity` | integer | `5` | OTP validity in minutes |
| `otp_in_response` | boolean | `false` | Include OTP value in response (for testing) |
| `auto_login` | boolean | `false` | Auto-create Commerce customer on OTP verify |
| `allow_key_info_update` | boolean | `false` | Allow customer profile updates (mobile/email/name) |

---

## Part 2: API Mesh — Frontend Consumption

These endpoints are consumed by storefronts, mobile apps, and websites through the API Mesh gateway. **No auth headers required** — the mesh acts as the security boundary. The `otp` and `customer` actions have `require-adobe-auth: false`.

> **`{{MESH_URL}}`** = your API Mesh endpoint URL (get it via `cd mesh && npm run get`)

### 3. Standalone OTP Action

Standalone OTP generate/verify with auto-login capability.

#### 3.1 Generate OTP (Mobile)

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "loginType": "mobile",
    "mobile": "9876543210"
  }'
```

**Response (200) — when `otp_in_response: true`:**

```json
{
  "otpReferenceId": "otp_1711017600000_12345",
  "otpValue": "4821"
}
```

**Response (200) — when `otp_in_response: false`:**

```json
{
  "otpReferenceId": "otp_1711017600000_12345"
}
```

#### 3.2 Generate OTP (Email)

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "loginType": "email",
    "email": "customer@example.com"
  }'
```

#### 3.3 Validate OTP

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "otp_1711017600000_12345",
    "otpValue": "4821",
    "loginType": "mobile"
  }'
```

**Response (200):**

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "message": "otp matched"
}
```

#### 3.4 Validate OTP with Auto-Register

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "otp_1711017600000_12345",
    "otpValue": "4821",
    "loginType": "mobile",
    "register": true
  }'
```

> **Note:** Auto-register also triggers if `auto_login: true` in app config.

#### Standalone OTP Error Responses

| Status | Error | When |
|---|---|---|
| 400 | `missing parameter(s) 'loginType'` | loginType not provided |
| 400 | `missing parameter(s) 'mobile'` | mobile loginType but no mobile |
| 400 | `missing parameter(s) 'email'` | email loginType but no email |
| 400 | `invalid otpReferenceId` | Reference ID not found |
| 400 | `otp expired` | OTP past expiration time |
| 401 | `invalid otp` | OTP value doesn't match (Levenshtein distance > 1) |
| 403 | `otp module is disabled` | `is_enabled: false` in config |
| 404 | `user is not registered, kindly register first` | User not in Commerce and auto-register off |
| 500 | `unable to create/login user` | Commerce create/login failed |

---

### 4. Customer Action (via API Mesh)

Multi-operation router for customer register, login, and profile update. Uses OTP gate for register/login.

#### 4.1 Register — Step 1: Request OTP

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "mobile",
    "mobile": "9876543210",
    "email": "customer@example.com",
    "firstname": "John",
    "lastname": "Doe"
  }'
```

**Response (200) — OTP generated:**

```json
{
  "otpReferenceId": "otp_1711017600000_54321",
  "otpValue": "7293"
}
```

> `otpValue` only appears when `otp_in_response: true` in config.

#### 4.2 Register — Step 2: Verify OTP & Complete Registration

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "otpReferenceId": "otp_1711017600000_54321",
    "otpValue": "7293"
  }'
```

> **Note:** `email`, `mobile`, `firstname`, `lastname` are automatically hydrated from the OTP record. No need to resend them.

**Response (200):**

```json
{
  "customer_id": 42,
  "customer_token": "eyJhbGciOiJIUzI1NiIs...",
  "login_type": "both",
  "customer": {
    "firstname": "John",
    "lastname": "Doe",
    "email": "customer@example.com",
    "mobile_number": "+919876543210"
  }
}
```

#### 4.3 Login — Step 1: Request OTP

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "mobile",
    "mobile": "9876543210"
  }'
```

#### 4.4 Login — Step 2: Verify OTP & Authenticate

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "otpReferenceId": "otp_1711017600000_54321",
    "otpValue": "7293"
  }'
```

**Response (200):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "customer": {
    "id": 42,
    "firstname": "John",
    "lastname": "Doe",
    "email": "customer@example.com"
  }
}
```

#### 4.5 Login via Email

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "email",
    "email": "customer@example.com"
  }'
```

#### 4.6 Update Customer Profile

No OTP gate — requires a valid customer token in the payload.

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_token": "eyJhbGciOiJIUzI1NiIs...",
    "mobile_number": "8765432109",
    "new_email": "newemail@example.com",
    "password": "currentPassword123",
    "firstName": "Jane",
    "lastName": "Smith"
  }'
```

**Response (200):**

```json
{
  "success": true,
  "customer_id": 42,
  "mobile_number": "+918765432109",
  "email": "newemail@example.com",
  "firstName": "Jane",
  "lastName": "Smith",
  "commerce": {
    "customer": {
      "id": "42",
      "firstname": "Jane",
      "lastname": "Smith",
      "email": "newemail@example.com"
    }
  }
}
```

#### 4.7 Update — Mobile Only

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_token": "eyJhbGciOiJIUzI1NiIs...",
    "mobile_number": "8765432109"
  }'
```

#### 4.8 Update — Name Only

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_token": "eyJhbGciOiJIUzI1NiIs...",
    "firstName": "Jane"
  }'
```

#### Customer Action Error Responses

| Status | Error | When |
|---|---|---|
| 400 | `missing parameter(s) 'operation'` | No operation specified |
| 400 | `provide exactly one identifier: 'email' or 'mobile_number'` | Login: both or neither provided |
| 400 | `provide at least one identifier: 'email' or 'mobile_number'` | Register: neither provided |
| 400 | `missing parameter(s) 'password' for email update` | Email update without password |
| 400 | `provide at least one field...` | Update with no fields |
| 400 | `authenticated customer_id not found in request context` | Update without customer ID |
| 400 | `invalid otpReferenceId` | OTP reference not found |
| 400 | `otp already used` | OTP already consumed |
| 400 | `otp expired` | OTP past expiry |
| 401 | `invalid otp` | Wrong OTP value |
| 401 | `customer token is required/invalid for key info update` | Commerce rejects customer token |
| 403 | `otp module is disabled` | Module is_enabled = false |
| 403 | `key info updates are disabled` | allow_key_info_update = false |
| 404 | `user not found` | Login: identity not found |
| 404 | `mobile number not found` | Login via mobile: not in identity store |
| 404 | `customer record not found` | Update: no identity record |
| 409 | `email already exists` | Register/update conflict |
| 409 | `mobile already exists` / `mobile_number already exists` | Register/update conflict |
| 409 | `email/mobile already exists` | Both conflict |
| 500 | `server error` | Unhandled exception |

---

## 5. Complete Flows

### Flow A: Mobile Registration (End-to-End via API Mesh)

```bash
# 1. Enable module (Admin UI SDK — direct call)
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{"is_enabled": true, "otp_in_response": true}'

# 2. Request OTP for registration (API Mesh — no auth needed)
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "mobile",
    "mobile": "9876543210",
    "email": "john@example.com",
    "firstname": "John",
    "lastname": "Doe"
  }'
# → { "otpReferenceId": "otp_...", "otpValue": "1234" }

# 3. Verify OTP and complete registration (API Mesh)
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "otpReferenceId": "otp_...",
    "otpValue": "1234"
  }'
# → { "customer_id": 42, "customer_token": "...", ... }
```

### Flow B: Mobile Login (End-to-End via API Mesh)

```bash
# 1. Request OTP for login (API Mesh)
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "mobile",
    "mobile": "9876543210"
  }'
# → { "otpReferenceId": "otp_..." }

# 2. Verify OTP and authenticate (API Mesh)
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "otpReferenceId": "otp_...",
    "otpValue": "5678"
  }'
# → { "token": "...", "customer": { ... } }
```

### Flow C: Profile Update (End-to-End)

```bash
# 1. Enable key info updates (Admin UI SDK — direct call)
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{"allow_key_info_update": true}'

# 2. Update profile (API Mesh — no auth needed)
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_token": "eyJhbGci...",
    "mobile_number": "8765432109",
    "firstName": "Jane"
  }'
# → { "success": true, "customer_id": 42, ... }
```

---

## 6. Postman Setup

### Environment Variables

Create a Postman environment with:

| Variable | Value | Usage |
|---|---|---|
| `ADMIN_BASE_URL` | `https://localhost:9080/api/v1/web/login-module` or deployed URL | Config / Registration (Admin UI SDK) |
| `MESH_URL` | Your API Mesh endpoint URL | OTP / Customer (Frontend) |
| `IMS_TOKEN` | Your IMS bearer token | Admin UI SDK calls only |
| `ORG_ID` | Your IMS org ID | Admin UI SDK calls only |

### Postman Collection Structure

```
📁 Login Module
├── 📁 Admin UI SDK (Direct — requires IMS auth)
│   ├── 📁 Config
│   │   ├── GET Config
│   │   ├── POST Update Config
│   │   └── DELETE Reset Config
│   └── 📁 Registration
│       └── POST Get Menu Registration
├── 📁 API Mesh (Frontend — no auth needed)
│   ├── 📁 Standalone OTP
│   │   ├── POST Generate OTP (Mobile)
│   │   ├── POST Generate OTP (Email)
│   │   └── POST Validate OTP
│   ├── 📁 Customer - Register
│   │   ├── POST Register Step 1 (Request OTP)
│   │   └── POST Register Step 2 (Verify & Complete)
│   ├── 📁 Customer - Login
│   │   ├── POST Login Step 1 (Request OTP - Mobile)
│   │   ├── POST Login Step 1 (Request OTP - Email)
│   │   └── POST Login Step 2 (Verify & Authenticate)
│   └── 📁 Customer - Update
│       ├── POST Update Mobile
│       ├── POST Update Email
│       ├── POST Update Name
│       └── POST Update All Fields
```

### Generating an IMS Token (Admin UI SDK testing only)

```bash
# Using aio CLI
aio ims:ctx:list
aio ims:login --ctx <your-context>
aio ims:get --ctx <your-context> | jq -r '.access_token'

# Or via OAuth S2S (programmatic)
curl -X POST "https://ims-na1.adobelogin.com/ims/token/v3" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id={{CLIENT_ID}}&client_secret={{CLIENT_SECRET}}&scope={{SCOPES}}"
```

> **Note:** IMS tokens are only needed for testing Admin UI SDK calls (config/registration). API Mesh calls do not require any auth \u2014 the mesh is the security boundary.

---

## 7. Database Collections Reference

### `app_config`

Singleton document (`_id: 'app_config'`) holding module settings. Managed via Admin UI SDK (config action).

| Field | Type | Description |
|---|---|---|
| `is_enabled` | boolean | Master enable/disable |
| `otp_expiration_validity` | integer | OTP validity (minutes) |
| `otp_in_response` | boolean | Show OTP in API response |
| `auto_login` | boolean | Auto-create customer on OTP verify |
| `allow_key_info_update` | boolean | Allow profile updates |
| `updatedAt` | number | Last update timestamp |

### `otps`

Temporary OTP records. Created via API Mesh (otp/customer actions).

| Field | Type | Description |
|---|---|---|
| `otpReferenceId` | string | Unique reference (`otp_{timestamp}_{random}`) |
| `otp` | string | 4-digit OTP value |
| `operation` | string | `register` / `login` |
| `loginType` | string | `mobile` / `email` |
| `mobile` | string? | Mobile number |
| `email` | string? | Email address |
| `customer_id` | number? | Customer ID (if known) |
| `firstname` / `lastName` | string? | Customer name fields |
| `createdAt` | number | Creation timestamp |
| `expiresAt` | number | Expiry timestamp |
| `consumed` | boolean | Whether OTP was verified |
| `consumedAt` | number? | Verification timestamp |

### `customer_mobile_identity`

Customer identity mapping between Commerce and the module. Written by API Mesh (customer action).

| Field | Type | Indexed | Description |
|---|---|---|---|
| `email` | string | unique | Customer email |
| `mobile_number` | string | unique | Normalized mobile (`+91XXXXXXXXXX`) |
| `customer_id` | number | unique | Commerce customer ID |
| `login_type` | string | — | `email` / `mobile` / `both` |
| `status` | string | — | `active` / `inactive` |
| `first_name` | string? | — | First name |
| `last_name` | string? | — | Last name |
| `created_at` | Date | — | Creation time |
| `updated_at` | Date | — | Last modification time |

---

## 8. Mobile Number Normalization

All mobile numbers are normalized to Indian format before storage:

| Input | Normalized Output |
|---|---|
| `9876543210` | `+919876543210` |
| `919876543210` | `+919876543210` |
| `+919876543210` | `+919876543210` |
| `+91 98765-43210` | `+919876543210` |
| `1234567890` | **Error:** `invalid indian mobile number` |

Validation rule: after stripping non-digits and optional `91` prefix, the remaining 10 digits must start with `6-9`.

---

## 9. OTP Behavior Notes

- **OTP length:** 4 digits (1000–9999), generated with `crypto.randomInt` (cryptographically secure)
- **Fuzzy matching:** Levenshtein distance ≤ 1 from stored OTP is accepted
- **Single use:** OTP is marked `consumed: true` after successful verification
- **Expiry:** Controlled by `otp_expiration_validity` config (default: 5 minutes)
- **Auto-cleanup:** Expired OTPs are deleted on verification attempt
- **Reference ID format:** `otp_{timestamp}_{random5digits}`

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `403 otp module is disabled` | `is_enabled: false` | Update config: `{"is_enabled": true}` |
| `403 key info updates are disabled` | `allow_key_info_update: false` | Update config: `{"allow_key_info_update": true}` |
| `409 email already exists` | Duplicate registration | Use login instead, or different email |
| `404 user not found` | Login for unregistered user | Register first |
| `401 invalid otp` | Wrong OTP or too different | Resend OTP and retry |
| `400 otp expired` | OTP past validity window | Generate a new OTP |
| `400 otp already used` | OTP consumed | Generate a new OTP |
| `401 customer token is required/invalid` | Missing or expired customer token for update | Login again to get fresh token |
| `500 GRAPHQL_ENDPOINT not configured` | Missing env variable | Set `GRAPHQL_ENDPOINT` in `.env` |
| Commerce rollback on update | Commerce mutation failed | Check action logs; identity doc reverted automatically |
