# Business Document

## Business Problem

Commerce operations teams need controlled OTP-based customer authentication (registration, login, profile management) and centralized configuration, without code deployments for every policy change.

## Business Objective

Provide a secure Admin module that allows authorized users to:

- Enable/disable OTP module
- Configure OTP validity and response behavior
- Control auto-login behavior
- Toggle key info updates (mobile, email, name) for customers
- Manage customer registration and login flows with OTP verification
- Support both email and mobile-based authentication

## Target Users

- Commerce Admin users
- Support/Operations teams
- Platform administrators
- End customers (via OTP-based registration and login)

## Business Value

- Faster operational changes (self-service from Admin UI)
- Improved governance via authenticated access
- Reduced dependency on engineering for routine config updates
- Consistent managed storage model with Adobe App Builder Doc DB
- Seamless customer onboarding via OTP-gated registration and login
- Mobile-first customer identity with email fallback

## Security and Compliance Intent

- Access to Admin actions is restricted to authenticated Adobe users.
- Customer operations are OTP-gated to prevent unauthorized access.
- Profile updates require a valid customer token.
- Configuration updates are executed through controlled backend actions.
- OTP generation uses cryptographically secure randomness.

## Success Criteria

- Admin user can update OTP and module settings from Commerce UI.
- Config changes persist and are reflected in OTP runtime behavior.
- Customers can register and login via OTP (email or mobile).
- Customer profile updates (mobile, email, name) sync to Commerce and identity store.
- Unauthorized API access is blocked.

## Operational Rollout Plan

1. Enable in Stage, validate auth and config flows.
2. Validate Doc DB persistence and OTP configuration behavior.
3. Test customer registration, login, and profile update end-to-end.
4. Run UAT with operations/admin stakeholders.
5. Promote to Production with monitoring enabled.

## Risks and Mitigations

- **Risk:** Host auth context unavailable leads to blocked config actions.
  - **Mitigation:** Ensure launch from Commerce Admin shell and verify IMS context handshake.

- **Risk:** Commerce GraphQL errors during customer operations.
  - **Mitigation:** Profile updates include automatic Doc DB rollback on Commerce failure. Monitor action logs for errors.

- **Risk:** Duplicate customer identity records.
  - **Mitigation:** Unique indexes on identity collection enforced via post-deploy hook. Conflict detection before registration.
