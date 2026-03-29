# Business Document

## Business Problem

Commerce operations teams need controlled OTP-based customer authentication (registration, login, profile management) and centralized configuration, without code deployments for every policy change. Additionally, storefronts and mobile apps need a secure, credential-free way to access the authentication APIs.

## Business Objective

Provide two distinct service layers:

### For Commerce Admin Teams (Admin UI SDK)

- Enable/disable OTP module
- Configure OTP validity and response behavior
- Control auto-register behavior
- Toggle key info updates (mobile, email) for customers
- Configure SMS delivery — gateway host, endpoint, API key, and template
- Configure Email delivery — SMTP settings, sender details, and template

### For Storefronts & Mobile Apps (API Mesh)

- Customer registration and login via OTP verification
- Customer profile updates with Commerce sync
- Standalone OTP generation and validation
- **No authentication credentials required** from the frontend — handled automatically by API Mesh

## Solution Architecture

| Layer | Consumer | Access Method | Auth |
|---|---|---|---|
| **Admin UI SDK** | Commerce Admin users | Direct action calls | IMS token (automatic from Commerce host) |
| **API Mesh** | Storefronts, mobile apps, websites | Mesh gateway URL | None required (mesh is the security boundary) |

## Target Users

- **Commerce Admin users** — configure the module via the Admin UI SDK extension
- **Support/Operations teams** — manage OTP settings and customer policies
- **End customers** — register, login, and update profiles via storefront/mobile (through API Mesh)
- **Frontend developers** — integrate customer auth flows using the API Mesh endpoint (no IMS tokens needed)

## Business Value

- **Credential-free frontend integration** — Storefronts call API Mesh with no auth headers. The mesh URL is the only published endpoint.
- **Faster operational changes** — Self-service config from Admin UI, no redeployment needed
- **Clear separation of concerns** — Admin config is isolated from customer-facing APIs
- **Secure by default** — Admin UI actions are IMS-protected. Frontend actions are gated by the mesh as the security boundary.
- **Mobile-first customer identity** — Customers register/login using mobile numbers, with email fallback
- **Multi-channel OTP delivery** — OTP can be dispatched via SMS (configurable gateway) or Email (SMTP), with template customization from the Admin UI
- **Single gateway** — API Mesh combines Commerce GraphQL + Login Module REST into one endpoint
- **Database flexibility** — Choose between Adobe Doc DB (managed, zero-ops) or MySQL (self-hosted, full control) via the `DB_TYPE` setting. Switch backends without code changes.

## Security and Compliance Intent

- All App Builder actions for Admin UI require Adobe authentication (`require-adobe-auth: true`).
- Frontend-facing actions (`otp`, `customer`) have `require-adobe-auth: false` — the API Mesh acts as the security boundary.
- Admin UI actions are accessible only within Commerce Admin context (IMS auth from host).
- Customer-facing actions are accessible only through API Mesh — direct action URLs are not published.
- Actions cannot be called directly from storefronts — the mesh URL is the only frontend gateway.
- Customer operations are OTP-gated to prevent unauthorized access.
- Profile updates require a valid customer token.
- OTP generation uses cryptographically secure randomness.

## Success Criteria

- Admin user can update OTP and module settings from Commerce Admin UI (Admin UI SDK).
- Config changes persist and are reflected in OTP runtime behavior.
- Storefronts can register and login customers via API Mesh without passing IMS credentials.
- Customer profile updates (mobile, email, name) sync to Commerce and identity store.
- Direct action calls from storefronts are blocked (actions not published; mesh is the only gateway).
- API Mesh correctly proxies all frontend requests.

## Operational Rollout Plan

1. Deploy actions and Admin UI to Stage environment.
2. Deploy API Mesh pointing to Stage actions (`cd mesh && npm run create`).
3. Validate Admin UI config flows (Admin UI SDK → Config action).
4. Validate storefront flows (API Mesh → OTP / Customer actions).
5. Test Doc DB or MySQL persistence and OTP configuration behavior.
6. Test customer registration, login, and profile update end-to-end via mesh.
7. Run UAT with operations/admin stakeholders (Admin UI) and frontend team (API Mesh).
8. Promote to Production: deploy actions, then update mesh with production `ACTION_BASE_URL` (`cd mesh && npm run update`).
9. Enable monitoring on both action logs and mesh metrics.

## Risks and Mitigations

- **Risk:** Mesh configuration mismatch causes frontend API failures.
  - **Mitigation:** Ensure `ACTION_BASE_URL` in `mesh/.env.mesh` matches the deployed action URL. Use `cd mesh && npm run update` after redeployment.

- **Risk:** Host auth context unavailable leads to blocked Admin UI config actions.
  - **Mitigation:** Ensure launch from Commerce Admin shell and verify IMS context handshake.

- **Risk:** Commerce GraphQL errors during customer operations.
  - **Mitigation:** Profile updates include automatic DB rollback on Commerce failure. Monitor action logs for errors.

- **Risk:** Adobe Doc DB dependency or regional availability.
  - **Mitigation:** MySQL backend available as an alternative (`DB_TYPE=mysql`). Switch at deployment time without code changes.

- **Risk:** Duplicate customer identity records.
  - **Mitigation:** Unique indexes on identity collection enforced via post-deploy hook. Conflict detection before registration.
