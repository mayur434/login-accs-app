# Manual Testing Guide

Comprehensive manual testing guide for all actions, covering every permutation and edge case.

---

## Prerequisites

1. **Environment running** — `aio app dev` or deployed actions
2. **Database initialized** — `npm run setup-db` completed successfully
3. **Config defaults loaded** — `is_enabled: true`, `otp_in_response: true` (for manual testing visibility)
4. **Variables ready:**

| Variable | Description | Example |
|---|---|---|
| `ADMIN_BASE_URL` | Direct action URL (local or deployed) | `https://localhost:9080/api/v1/web/login-module` |
| `MESH_URL` | API Mesh URL (prod testing) | `https://<mesh-id>.runtime.adobe.io/<api-path>` |
| `IMS_TOKEN` | IMS bearer token (Admin UI SDK calls) | From `aio ims:login` |
| `ORG_ID` | IMS organization ID | From Developer Console |

> **Tip:** For local testing, use `ADMIN_BASE_URL` directly. For production-like testing, use `MESH_URL` for OTP/customer actions.

---

## 1. Config Action (Admin UI SDK — Direct)

### 1.1 GET Config — Default State

```bash
curl -X GET "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}"
```

**Expected:** 200 — All 20 config fields returned with defaults.

| Check | Expected |
|---|---|
| `is_enabled` | `true` (after seed) |
| `otp_in_response` | `false` |
| `auto_register` | `false` |
| `allow_key_info_update` | `false` |
| `sms_template_enabled` | `false` |
| `email_template_enabled` | `false` |
| `email_smtp_port` | `587` |

---

### 1.2 POST Config — Update Application Settings

```bash
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "is_enabled": true,
    "otp_in_response": true,
    "otp_expiration_validity": 5,
    "auto_register": true,
    "allow_key_info_update": true
  }'
```

**Expected:** 200 — Updated fields reflect new values; SMS/Email fields unchanged.

---

### 1.3 PATCH Config — Partial SMS Update

```bash
curl -X PATCH "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "sms_api_host": "https://api.sms-provider.com",
    "sms_endpoint": "/v1/send",
    "sms_api_key": "test-key-123"
  }'
```

**Expected:** 200 — Only SMS fields updated. Application fields and email fields unchanged.

---

### 1.4 PATCH Config — Partial Email Update

```bash
curl -X PATCH "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "email_smtp_host": "smtp.example.com",
    "email_smtp_port": 465,
    "email_smtp_user": "user@example.com",
    "email_smtp_password": "secure-pass",
    "email_from_address": "noreply@example.com",
    "email_from_name": "Test Store"
  }'
```

**Expected:** 200 — Only email fields updated. SMS and application fields unchanged.

---

### 1.5 PATCH Config — Enable SMS Template

```bash
curl -X PATCH "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "sms_template_enabled": true,
    "sms_template_id": "tmpl-001",
    "sms_template_string": "Your code is {{OTP}}. Expires in {{VALIDITY}} min."
  }'
```

**Expected:** 200 — SMS template enabled.

---

### 1.6 PATCH Config — Enable Email Template

```bash
curl -X PATCH "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "email_template_enabled": true,
    "email_template_id": "tmpl-email-001",
    "email_template_string": "Hello, your OTP is {{OTP}}. Valid for {{VALIDITY}} minutes."
  }'
```

**Expected:** 200 — Email template enabled.

---

### 1.7 Validation — Invalid Types

```bash
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{
    "is_enabled": "yes",
    "otp_expiration_validity": -5,
    "sms_api_host": 123
  }'
```

**Expected:** 400 — `"is_enabled must be boolean true/false; otp_expiration_validity must be a positive integer; sms_api_host must be a string"`

---

### 1.8 Validation — Empty Body

```bash
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** 400 — `"Provide at least one configuration field to update"`

---

### 1.9 DELETE Config — Reset

```bash
curl -X DELETE "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}"
```

**Expected:** 200 — `{ "success": true, "message": "app_config deleted" }`

Followed by GET: Returns defaults (re-created automatically).

---

### 1.10 Backward Compat — auto_login Alias

```bash
curl -X POST "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}" \
  -H "Content-Type: application/json" \
  -d '{ "auto_login": true }'
```

**Expected:** 200 — `auto_register` set to `true` (mapped from `auto_login`).

---

### 1.11 Method Not Allowed

```bash
curl -X OPTIONS "{{ADMIN_BASE_URL}}/config" \
  -H "Authorization: Bearer {{IMS_TOKEN}}" \
  -H "x-gw-ims-org-id: {{ORG_ID}}"
```

**Expected:** 405 — Method not allowed.

---

## 2. Standalone OTP Action (via Mesh or Direct)

> **Setup:** Ensure `is_enabled: true` and `otp_in_response: true` in config before running these tests.

### 2.1 Generate OTP — Mobile

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "loginType": "mobile",
    "mobile": "9876543210"
  }'
```

**Expected:** 200 — `{ "otpReferenceId": "otp_...", "otpValue": "XXXX" }`

---

### 2.2 Generate OTP — Email

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "loginType": "email",
    "email": "test@example.com"
  }'
```

**Expected:** 200 — `{ "otpReferenceId": "otp_...", "otpValue": "XXXX" }`

---

### 2.3 Generate OTP — Missing loginType

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{ "mobile": "9876543210" }'
```

**Expected:** 400 — `"missing parameter(s) 'loginType'"`

---

### 2.4 Generate OTP — Mobile LoginType Without Mobile

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{ "loginType": "mobile" }'
```

**Expected:** 400 — `"missing parameter(s) 'mobile'"`

---

### 2.5 Generate OTP — Email LoginType Without Email

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{ "loginType": "email" }'
```

**Expected:** 400 — `"missing parameter(s) 'email'"`

---

### 2.6 Generate OTP — Invalid loginType

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{ "loginType": "social" }'
```

**Expected:** 400 — `"invalid loginType"`

---

### 2.7 Validate OTP — Correct Value

```bash
# Use otpReferenceId and otpValue from step 2.1
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "{{REF_ID}}",
    "otpValue": "{{OTP_VALUE}}",
    "loginType": "mobile"
  }'
```

**Expected:** 200 — `{ "success": true, "customer_token": "...", "message": "otp matched" }`

---

### 2.8 Validate OTP — Wrong Value

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "{{REF_ID}}",
    "otpValue": "0000",
    "loginType": "mobile"
  }'
```

**Expected:** 401 — `"invalid otp"` (if Levenshtein distance > 1)

---

### 2.9 Validate OTP — Fuzzy Match (Distance = 1)

```bash
# If OTP is "1234", try "1235" (distance = 1 → should pass)
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "{{REF_ID}}",
    "otpValue": "{{OTP_VALUE_PLUS_ONE}}",
    "loginType": "mobile"
  }'
```

**Expected:** 200 — Accepted (Levenshtein distance ≤ 1).

---

### 2.10 Validate OTP — Already Consumed

```bash
# Re-use the same otpReferenceId from a successful validation
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "{{CONSUMED_REF_ID}}",
    "otpValue": "{{OTP_VALUE}}",
    "loginType": "mobile"
  }'
```

**Expected:** 400 — `"otp already used"`

---

### 2.11 Validate OTP — Invalid Reference ID

```bash
curl -X POST "{{MESH_URL}}/otp" \
  -H "Content-Type: application/json" \
  -d '{
    "otpReferenceId": "otp_nonexistent_12345",
    "otpValue": "1234",
    "loginType": "mobile"
  }'
```

**Expected:** 400 — `"invalid otpReferenceId"`

---

### 2.12 Validate OTP — Expired

Wait for the configured `otp_expiration_validity` (e.g., 1 minute), then validate.

**Expected:** 400 — `"otp expired"`

---

### 2.13 Module Disabled

Set `is_enabled: false` in config, then try to generate OTP.

**Expected:** 403 — `"otp module is disabled"`

---

### 2.14 User Not Found (auto_register OFF)

Generate OTP for a mobile number not registered in Commerce, with `auto_register: false`.

**Expected:** 404 — `"user not exist"`

---

### 2.15 Auto-Register (auto_register ON)

Set `auto_register: true`, then generate OTP for a new mobile number.

**Expected:** 200 — OTP generated, and Commerce customer auto-created during validation.

---

### 2.16 OTP Not In Response (otp_in_response: false)

Set `otp_in_response: false`, then generate OTP.

**Expected:** 200 — `{ "otpReferenceId": "otp_..." }` (no `otpValue` field).

---

### 2.17 SMS/Email Dispatch Verification

When `otp_in_response: false` and templates are enabled:
- **Mobile OTP:** Check server logs for `[SMS]` log entry with resolved template
- **Email OTP:** Check server logs for `[Email]` log entry with resolved template

---

## 3. Customer Action — Registration

> **Setup:** `is_enabled: true`, `otp_in_response: true`

### 3.1 Register (Mobile) — Step 1: Request OTP

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "mobile",
    "mobile": "9876543210",
    "email": "newuser@example.com",
    "firstname": "John",
    "lastname": "Doe"
  }'
```

**Expected:** 200 — `{ "otpReferenceId": "...", "otpValue": "..." }`

---

### 3.2 Register (Mobile) — Step 2: Verify OTP & Complete

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "otpReferenceId": "{{REF_ID}}",
    "otpValue": "{{OTP_VALUE}}"
  }'
```

**Expected:** 200 — Customer created in Commerce + identity stored.

| Check | Expected |
|---|---|
| `customer_id` | Non-null integer |
| `customer_token` | Non-null JWT string |
| `email` | `newuser@example.com` |
| `mobile_number` | `+919876543210` |
| `login_type` | `both` |

---

### 3.3 Register (Email Only)

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "email",
    "email": "emailonly@example.com",
    "firstname": "Jane",
    "lastname": "Smith"
  }'
```

**Expected:** 200 — OTP generated for email registration.

After OTP verification: `login_type: "email"`, `mobile_number: null`.

---

### 3.4 Register (Mobile Only — No Email)

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "mobile",
    "mobile": "8765432109"
  }'
```

**Expected:** 200 — OTP generated. After verification: synthetic email generated (`918765432109@email.com`), `login_type: "mobile"`.

---

### 3.5 Register — Duplicate Email

After registering, try registering again with the same email.

**Expected:** 409 — `"email already exists"`

---

### 3.6 Register — Duplicate Mobile

After registering, try registering again with the same mobile.

**Expected:** 409 — `"mobile already exists"`

---

### 3.7 Register — Missing Identifiers

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{ "operation": "register" }'
```

**Expected:** 400 — `"provide at least one identifier: 'email' or 'mobile_number'"`

---

### 3.8 Register — Default Names (No firstname/lastname)

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "email",
    "email": "noname@example.com"
  }'
```

**Expected:** After complete registration, Commerce customer uses `firstname: "Guest"`, `lastname: "User"`.

---

### 3.9 Register — Invalid Mobile Number

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "register",
    "loginType": "mobile",
    "mobile": "1234567890",
    "email": "invalid@example.com"
  }'
```

**Expected:** 400 — `"invalid indian mobile number"` (number doesn't start with 6-9).

---

## 4. Customer Action — Login

> **Setup:** Register a customer first (sections 3.1–3.2).

### 4.1 Login (Mobile) — Step 1: Request OTP

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "mobile",
    "mobile": "9876543210"
  }'
```

**Expected:** 200 — OTP generated.

---

### 4.2 Login (Mobile) — Step 2: Verify & Authenticate

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "otpReferenceId": "{{REF_ID}}",
    "otpValue": "{{OTP_VALUE}}"
  }'
```

**Expected:** 200 — Customer token returned. Identity upserted (updated_at refreshed).

---

### 4.3 Login (Email)

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "email",
    "email": "newuser@example.com"
  }'
```

**Expected:** 200 — OTP generated for email login.

---

### 4.4 Login — User Not Found (auto_register OFF)

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "mobile",
    "mobile": "7777777777"
  }'
```

With `auto_register: false`:

**Expected:** 404 — `"user not found"`

---

### 4.5 Login — Auto-Register on Login (auto_register ON)

Set `auto_register: true`, then login with an unregistered mobile.

**Expected:** OTP generated → after verification, user auto-registered and logged in.

---

### 4.6 Login — Missing Operation

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{ "loginType": "mobile", "mobile": "9876543210" }'
```

**Expected:** 400 — `"missing parameter(s) 'operation'"`

---

### 4.7 Login — Invalid Operation

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{ "operation": "invalidOp" }'
```

**Expected:** 400 — `"invalid operation: invalidOp"`

---

### 4.8 Login — Mobile Identity Upsert Verification

After successful login, verify the identity record is updated:
- `updated_at` should be refreshed
- `login_type` should NOT change (write-once)
- Real emails should NOT be overwritten by pattern emails

---

## 5. Customer Action — Profile Update

> **Setup:** Register a customer, keep the `customer_token` and `customer_id`. Set `allow_key_info_update: true`.

### 5.1 Update — Mobile Number

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": {{CUSTOMER_ID}},
    "customer_token": "{{CUSTOMER_TOKEN}}",
    "mobile_number": "8765432109"
  }'
```

**Expected:** 200 — Mobile updated in both Commerce and identity store. `mobile_number: "+918765432109"`.

---

### 5.2 Update — Email

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": {{CUSTOMER_ID}},
    "customer_token": "{{CUSTOMER_TOKEN}}",
    "new_email": "updated@example.com"
  }'
```

**Expected:** 200 — Email updated. Note: Email change invalidates the customer token.

---

### 5.3 Update — Mobile + Email Together

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": {{CUSTOMER_ID}},
    "customer_token": "{{CUSTOMER_TOKEN}}",
    "mobile_number": "7654321098",
    "new_email": "both@example.com"
  }'
```

**Expected:** 200 — Both fields updated. Mobile mutation first, then email (which revokes token).

---

### 5.4 Update — Pattern Email Auto-Update

When customer has a pattern email (e.g., `919876543210@email.com`) and only mobile is updated:

**Expected:** Pattern email automatically regenerated to match new mobile.

---

### 5.5 Update — Duplicate Mobile Conflict

Try updating to a mobile number already assigned to another customer.

**Expected:** 409 — `"mobile number already exists"`

---

### 5.6 Update — Duplicate Email Conflict

Try updating to an email already assigned to another customer.

**Expected:** 409 — `"email already exists"`

---

### 5.7 Update — Missing customer_id

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_token": "{{CUSTOMER_TOKEN}}",
    "mobile_number": "8765432109"
  }'
```

**Expected:** If `customer_id` cannot be extracted from token → 400.

---

### 5.8 Update — Missing customer_token

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": {{CUSTOMER_ID}},
    "mobile_number": "8765432109"
  }'
```

**Expected:** 400 — `"customer_token is required"`

---

### 5.9 Update — Key Info Updates Disabled

Set `allow_key_info_update: false`, then try update.

**Expected:** 403 — `"key info updates are disabled"`

---

### 5.10 Update — No Fields Provided

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": {{CUSTOMER_ID}},
    "customer_token": "{{CUSTOMER_TOKEN}}"
  }'
```

**Expected:** 400 — `"provide at least one field: 'mobile_number' or 'new_email'"`

---

### 5.11 Update — Customer Not Found

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": 999999,
    "customer_token": "{{CUSTOMER_TOKEN}}",
    "mobile_number": "8765432109"
  }'
```

**Expected:** 404 — `"customer identity not found"`

---

### 5.12 Update — Invalid Mobile Number

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "updateCustomerDetails",
    "customer_id": {{CUSTOMER_ID}},
    "customer_token": "{{CUSTOMER_TOKEN}}",
    "mobile_number": "123"
  }'
```

**Expected:** 400 — `"invalid indian mobile number"`

---

## 6. SMS/Email OTP Dispatch

> These tests verify OTP delivery channels. SMS and Email senders are currently stubs that log the resolved template.

### 6.1 SMS Dispatch — Template Enabled

1. Enable SMS: `sms_template_enabled: true`, set `sms_template_string`
2. Set `otp_in_response: false`
3. Generate OTP with `loginType: mobile`

**Verify:** Server logs contain `[SMS] Sending OTP to +91XXXXXXXXXX: <resolved template>`

---

### 6.2 SMS Dispatch — Template Disabled

1. Set `sms_template_enabled: false`
2. Generate OTP with `loginType: mobile`

**Verify:** Server logs contain `[SMS] Template disabled — skipping SMS delivery`

---

### 6.3 Email Dispatch — Template Enabled

1. Enable Email: `email_template_enabled: true`, set `email_template_string`
2. Set `otp_in_response: false`
3. Generate OTP with `loginType: email`

**Verify:** Server logs contain `[Email] Sending OTP to test@example.com: <resolved template>`

---

### 6.4 Email Dispatch — Template Disabled

1. Set `email_template_enabled: false`
2. Generate OTP with `loginType: email`

**Verify:** Server logs contain `[Email] Template disabled — skipping email delivery`

---

### 6.5 Template Placeholders

Set template string to: `"OTP={{OTP}} VALIDITY={{VALIDITY}} MOBILE={{MOBILE}}"`

Generate OTP with mobile, verify log output has all placeholders replaced.

---

### 6.6 Dispatch Failure Non-Blocking

Even if SMS/Email dispatch throws an error (e.g., network failure), OTP generation should still succeed.

**Verify:** OTP reference returned, warning logged: `"OTP dispatch failed (non-critical): ..."`

---

## 7. Database Backend Validation

Run all tests above against both backends:

### 7.1 DocDB Backend

```bash
# DB_TYPE=docdb (default)
npm run setup-db
aio app dev
# Run all manual tests
```

### 7.2 MySQL Backend

```bash
export DB_TYPE=mysql
export MYSQL_HOST=your-host
export MYSQL_PORT=3307
export MYSQL_USER=root
export MYSQL_PASSWORD=your-password
export MYSQL_DATABASE=mydb
npm run setup-db
aio app dev
# Run all manual tests
```

### 7.3 Cross-Backend Consistency

| Check | DocDB | MySQL |
|---|---|---|
| Config GET returns all 20 fields | ✓ | ✓ |
| Config PATCH partial update preserves others | ✓ | ✓ |
| OTP generate/validate cycle | ✓ | ✓ |
| Customer register creates identity record | ✓ | ✓ |
| Unique constraints enforced (email, mobile, customer_id) | ✓ | ✓ |
| Boolean fields returned as true/false (not 0/1) | ✓ | ✓ |
| OTP expiry and consumed checks | ✓ | ✓ |

---

## 8. Admin UI (Browser Testing)

### 8.1 Application Setup Panel

1. Open Commerce Admin → Customer Module → Login Module
2. Verify sidebar shows 3 items: **Application Setup**, **SMS Setup**, **Email Setup**
3. Navigate to Application Setup
4. Toggle `is_enabled` switch
5. Change OTP validity
6. Toggle auto-register and key info update switches
7. Click Save → verify success notification
8. Refresh page → verify values persisted

### 8.2 SMS Setup Panel

1. Navigate to SMS Setup via sidebar
2. Fill in API Host, Endpoint, API Key
3. Enable template toggle
4. Fill Template ID and Template String
5. Click Save → verify success
6. Leave required fields empty → verify validation error states (red border)

### 8.3 Email Setup Panel

1. Navigate to Email Setup via sidebar
2. Fill in SMTP Host, Port, Username, Password
3. Fill From Address and From Name
4. Enable template toggle
5. Fill Template ID and Template String
6. Click Save → verify success
7. Leave required fields empty → verify validation error states
8. Verify SMTP port accepts only positive integers

### 8.4 Dirty State Detection

1. Modify a field
2. Navigate away → verify unsaved changes prompt (or dirty indicator)
3. Save → verify dirty state clears

---

## 9. Edge Cases & Security

### 9.1 Concurrent OTP Requests

Generate multiple OTPs for the same mobile/email rapidly. Each should get a unique reference.

### 9.2 OTP After Expiry

Set `otp_expiration_validity: 1`, generate OTP, wait 61 seconds, validate.

**Expected:** 400 — `"otp expired"`. OTP record deleted from DB.

### 9.3 Pattern Email Protection

Login with mobile → verify real email is never overwritten by pattern email in identity record.

### 9.4 Login Type Write-Once

Register with `login_type: "mobile"`. Login again with both email and mobile.

**Expected:** `login_type` remains `"mobile"` (never overwritten).

### 9.5 Mobile Number Normalization

| Input | Expected Normalized |
|---|---|
| `9876543210` | `+919876543210` |
| `919876543210` | `+919876543210` |
| `+919876543210` | `+919876543210` |
| `+91 98765 43210` | `+919876543210` |
| `1234567890` | Error: invalid |
| `5555555555` | Error: invalid (doesn't start with 6-9) |

### 9.6 SQL Injection Attempt (MySQL)

```bash
curl -X POST "{{MESH_URL}}/customer" \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "login",
    "loginType": "email",
    "email": "test@example.com'; DROP TABLE otps; --"
  }'
```

**Expected:** No SQL injection. Parameterized queries protect all inputs.

---

## Test Execution Checklist

| # | Test Area | Cases | Status |
|---|---|---|---|
| 1 | Config GET | 1.1 | ☐ |
| 2 | Config POST/PATCH | 1.2–1.6 | ☐ |
| 3 | Config Validation | 1.7–1.8, 1.10–1.11 | ☐ |
| 4 | Config DELETE | 1.9 | ☐ |
| 5 | OTP Generate | 2.1–2.6 | ☐ |
| 6 | OTP Validate | 2.7–2.12 | ☐ |
| 7 | OTP Module State | 2.13–2.16 | ☐ |
| 8 | OTP SMS/Email | 2.17, 6.1–6.6 | ☐ |
| 9 | Register (Mobile) | 3.1–3.2 | ☐ |
| 10 | Register (Email) | 3.3 | ☐ |
| 11 | Register (Mobile Only) | 3.4 | ☐ |
| 12 | Register Conflicts | 3.5–3.6 | ☐ |
| 13 | Register Validation | 3.7–3.9 | ☐ |
| 14 | Login (Mobile) | 4.1–4.2 | ☐ |
| 15 | Login (Email) | 4.3 | ☐ |
| 16 | Login Not Found | 4.4 | ☐ |
| 17 | Login Auto-Register | 4.5 | ☐ |
| 18 | Login Validation | 4.6–4.8 | ☐ |
| 19 | Update Mobile | 5.1 | ☐ |
| 20 | Update Email | 5.2 | ☐ |
| 21 | Update Both | 5.3 | ☐ |
| 22 | Update Pattern Email | 5.4 | ☐ |
| 23 | Update Conflicts | 5.5–5.6 | ☐ |
| 24 | Update Validation | 5.7–5.12 | ☐ |
| 25 | DocDB Backend | 7.1 | ☐ |
| 26 | MySQL Backend | 7.2 | ☐ |
| 27 | Admin UI Browser | 8.1–8.4 | ☐ |
| 28 | Edge Cases | 9.1–9.6 | ☐ |
