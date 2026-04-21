# Google SSO Setup Guide

This guide walks you through configuring Google Single Sign-On (SSO) for the OTP Login Module.

## Overview

The Google SSO feature allows customers to sign in or register using their Google account. The flow:

1. **Frontend** → User clicks "Sign in with Google" button
2. **Google** → Returns ID token (JWT) after successful authentication
3. **Frontend** → Sends token to App Builder `google-sso` action
4. **Backend** → Verifies token signature, extracts user info (email, name, Google sub)
5. **Backend** → Checks identity table:
   - **Existing user** → Generates Commerce customer token, returns customer data
   - **New user** → Creates Commerce customer, saves identity mapping, returns token
6. **Frontend** → Stores token, redirects to home page

## Prerequisites

1. **Google Cloud Console** project with OAuth 2.0 credentials
2. **App Builder** workspace with deployed actions
3. **API Mesh** deployed and configured
4. **Frontend** (EDS storefront) with OTP auth drop-in

---

## Step 1: Create Google OAuth 2.0 Client ID

### 1.1 Create or Select a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API** (required for Sign-In)

### 1.2 Configure OAuth Consent Screen

1. Navigate to **APIs & Services** → **OAuth consent screen**
2. Choose **External** (for public users) or **Internal** (for organization only)
3. Fill in required fields:
   - **App name**: Your storefront name
   - **User support email**: Support contact
   - **Developer contact**: Your email
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
5. Save and continue

### 1.3 Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** → **Credentials**
2. Click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Choose **Web application**
4. Configure:
   - **Name**: "My Storefront SSO"
   - **Authorized JavaScript origins**:
     ```
     http://localhost:3000
     https://yourdomain.com
     https://your-preview-url.aem.page
     ```
   - **Authorized redirect URIs**: Leave empty (we use popup flow)
5. Click **Create**
6. **Copy the Client ID** (format: `123456789-abc123.apps.googleusercontent.com`)

⚠️ **Security Note**: Do NOT share the Client Secret. It's not needed for frontend OAuth.

---

## Step 2: Configure App Builder Backend

### 2.1 Add Environment Variable

Add `GOOGLE_CLIENT_ID` to your `.env` file:

```bash
# .env
GOOGLE_CLIENT_ID=123456789-abc123.apps.googleusercontent.com
```

### 2.2 Enable in Admin UI (Optional)

1. Open Adobe Commerce Admin
2. Navigate to **System** → **Login Module**
3. Go to **Google SSO** section
4. Enable **Google SSO**
5. Enter your **Google Client ID**
6. Click **Save Configuration**

This stores the config in the database and makes it available to the `google-sso` action.

### 2.3 Verify Action is Deployed

The `google-sso` action should be visible in your App Builder workspace:

```bash
aio app deploy
```

Check that it's deployed:
```bash
aio rt action list
```

You should see: `login-module/google-sso`

---

## Step 3: Configure API Mesh

### 3.1 Verify OpenAPI Spec

The `mesh/openapi.json` file should include the `/google-sso` endpoint:

```json
{
  "paths": {
    "/google-sso": {
      "post": {
        "operationId": "googleSsoAction",
        "summary": "Google SSO sign-in (exchange Google ID token for Commerce token)",
        ...
      }
    }
  }
}
```

✅ This has been added for you in the latest update.

### 3.2 Deploy Mesh

Deploy or update your API Mesh:

```bash
cd mesh
aio api-mesh:update mesh.json
```

Verify the deployment:
```bash
aio api-mesh:get
```

Note the **Mesh URL** (e.g., `https://graph.adobe.io/api/<mesh-id>/graphql`).

---

## Step 4: Configure Frontend

### 4.1 Update `config.json`

Edit `storefront-otp-project-private/config.json`:

```json
{
  "public": {
    "default": {
      "backend-url": "https://YOUR_RUNTIME_NAMESPACE.adobeioruntime.net/api/v1/web/customerotplogin",
      "google-sso-enabled": true,
      "google-client-id": "123456789-abc123.apps.googleusercontent.com"
    }
  }
}
```

**Replace:**
- `YOUR_RUNTIME_NAMESPACE` → Your actual I/O Runtime namespace (find it with `aio where`)
- `YOUR_GOOGLE_CLIENT_ID` → The Client ID from Step 1.3

### 4.2 Verify Frontend Code

The following files have been updated with Google SSO integration:

✅ **Login Page**: `blocks/commerce-login/commerce-login.js`
✅ **Registration Page**: `blocks/commerce-create-account/commerce-create-account.js`
✅ **SSO Service**: `scripts/google-sso-service.js`

---

## Step 5: Testing

### 5.1 Local Testing

1. Start your local development server:
   ```bash
   npm run up
   ```

2. Open `http://localhost:3000/customer/login`

3. You should see:
   - Standard OTP login form
   - "or" divider
   - "Sign in with Google" button

4. Click the Google button:
   - Google sign-in popup appears
   - Select your Google account
   - Consent to share email/profile (first time only)
   - You're redirected back and logged in

### 5.2 Verify Backend Integration

Check browser console for logs:
```
[OTP Auth Drop-in] initialized, meshUrl: ...
[Google SSO Service] Exchanging token with backend
```

Check Network tab:
- Request to `/google-sso` endpoint
- Response: `{ success: true, customer_token: "...", customer: {...} }`

### 5.3 Verify Customer Creation

For new users:
1. Sign in with a Google account that hasn't registered before
2. Check Adobe Commerce Admin → **Customers** → **All Customers**
3. New customer should appear with:
   - Email from Google account
   - Name from Google profile
   - Password: Internal (not user-visible)

Check the identity table (MongoDB/MySQL):
```sql
SELECT * FROM customer_identity WHERE login_provider = 'google';
```

You should see:
- `google_sub`: Google's unique user ID
- `email`: Google email
- `customer_id`: Commerce customer ID
- `login_provider`: `'google'`

---

## Troubleshooting

### Google Button Not Appearing

**Symptom**: No "Sign in with Google" button on login/registration pages.

**Checks**:
1. Is `google-sso-enabled` set to `true` in `config.json`?
2. Is `google-client-id` filled in (not empty or placeholder)?
3. Check browser console for errors:
   ```
   [Google SSO] Configuration contains placeholder values
   ```
4. Verify the config is loaded:
   ```js
   // In browser console:
   document.querySelector('meta[name="commerce-config"]')?.content
   ```

### "Invalid Google Token" Error

**Cause**: Token verification failed.

**Checks**:
1. Is `GOOGLE_CLIENT_ID` in `.env` matching the frontend config?
2. Are you using the correct OAuth client ID (not Client Secret)?
3. Check App Builder logs:
   ```bash
   aio app logs
   ```
   Look for: `google_token: signing key not found`

### "No Account Found" Error (404)

**Cause**: User exists in Google but not in Commerce.

**Expected behavior**: This is normal for first-time users. They need to:
- Use the standard registration flow first, OR
- Configure auto-registration in the backend

**Backend**: The action creates accounts automatically. If you see 404, check:
1. Commerce GraphQL endpoint is reachable
2. Customer creation permissions are correct
3. App Builder logs for Commerce API errors

### CORS Errors

**Symptom**: Browser blocks the request with CORS error.

**Fix**: Add your frontend domain to `mesh/mesh.json`:

```json
{
  "responseConfig": {
    "CORS": {
      "origin": [
        "http://localhost:3000",
        "https://yourdomain.com"
      ]
    }
  }
}
```

Redeploy mesh:
```bash
aio api-mesh:update mesh.json
```

### Token Not Stored / User Not Authenticated

**Symptom**: Sign-in appears successful but user isn't logged in.

**Checks**:
1. Check localStorage:
   ```js
   localStorage.getItem('commerce_customer_token')
   localStorage.getItem('commerce_customer')
   ```
2. Verify `authenticated` event is emitted:
   ```js
   events.on('authenticated', (val) => console.log('Auth event:', val));
   ```
3. Check that the OTP auth drop-in and Google SSO use the same storage keys

---

## Security Considerations

### Frontend

- ✅ Google Client ID is public (safe to expose)
- ✅ ID token is verified server-side (cannot be tampered)
- ✅ Token expires quickly (Google enforces expiry)

### Backend

- ✅ Token signature is verified using Google's public certificates
- ✅ Issuer (`accounts.google.com`) and audience (Client ID) are validated
- ✅ Identity table prevents duplicate accounts (unique `customer_id`)
- ✅ Commerce customer password is internal (not user-facing)

### API Mesh

- ✅ `require-adobe-auth: false` is correct (mesh handles security)
- ✅ CORS only allows whitelisted origins
- ✅ No IMS credentials exposed to frontend

---

## Configuration Checklist

Before going live, verify:

- [ ] Google OAuth Client ID created and configured
- [ ] Authorized JavaScript origins include production domain
- [ ] `GOOGLE_CLIENT_ID` environment variable set in App Builder
- [ ] `google-sso` action deployed and visible in runtime
- [ ] API Mesh includes `/google-sso` endpoint
- [ ] Frontend `config.json` has correct values (no placeholders)
- [ ] CORS origins include all frontend domains
- [ ] Tested sign-in flow on staging/production
- [ ] Tested new user registration via Google SSO
- [ ] Verified customer appears in Commerce Admin
- [ ] Verified identity mapping in database

---

## Maintenance

### Rotating Google Client ID

If you need to change the Client ID:

1. Create new OAuth client in Google Cloud Console
2. Update `GOOGLE_CLIENT_ID` in App Builder `.env`
3. Update `google-client-id` in frontend `config.json`
4. Redeploy App Builder: `aio app deploy`
5. Clear CDN cache if applicable

Existing users are unaffected (Google `sub` doesn't change).

### Monitoring

Check these logs regularly:

**App Builder**:
```bash
aio app logs
```

Look for:
- `Google SSO login: email=...` (successful logins)
- `google-token: signing key not found` (validation errors)
- `New Google SSO user — creating Commerce customer` (registrations)

**Commerce Admin**:
- Monitor customer creation rate
- Check for duplicate accounts (should be prevented)

---

## API Reference

### Request

**Endpoint**: `/google-sso`  
**Method**: `POST`  
**Content-Type**: `application/json`

```json
{
  "google_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6..."
}
```

### Response (Success)

**Status**: `200 OK`

```json
{
  "success": true,
  "customer_token": "abc123token",
  "message": "login successful",
  "customer": {
    "customer_id": 123,
    "email": "user@gmail.com",
    "firstname": "John",
    "lastname": "Doe",
    "login_provider": "google",
    "login_type": "email"
  }
}
```

### Response (Error)

**Status**: `401 Unauthorized`
```json
{ "error": "invalid google_token: not a valid JWT" }
```

**Status**: `404 Not Found`
```json
{ "error": "user exists in identity DB but not found in Commerce" }
```

**Status**: `500 Internal Server Error`
```json
{ "error": "server error" }
```

---

## Support

For issues or questions:

1. Check this guide first
2. Review App Builder logs: `aio app logs`
3. Check browser console for frontend errors
4. Verify API Mesh is deployed: `aio api-mesh:get`
5. Test with a different Google account

Common resources:
- [Google Sign-In JavaScript Library](https://developers.google.com/identity/gsi/web/guides/overview)
- [Adobe App Builder Documentation](https://developer.adobe.com/app-builder/docs/)
- [Adobe API Mesh Documentation](https://developer.adobe.com/graphql-mesh-gateway/)
