# Business Document

## Business Problem

Commerce operations teams need controlled OTP-login behavior and centralized configuration, without code deployments for every policy change.

## Business Objective

Provide a secure Admin module that allows authorized users to:

- Enable/disable OTP module
- Configure OTP validity
- Control auto-login behavior
- Toggle OTP bypass for controlled testing
- Use managed Doc DB storage aligned with current platform operations

## Target Users

- Commerce Admin users
- Support/Operations teams
- Platform administrators

## Business Value

- Faster operational changes (self-service from Admin UI)
- Improved governance via authenticated access
- Reduced dependency on engineering for routine config updates
- Consistent managed storage model with Adobe App Builder Doc DB

## Security and Compliance Intent

- Access to sensitive actions is restricted to authenticated Adobe users.
- Configuration updates are executed through controlled backend actions.
- Supports controlled and centralized configuration using Doc DB.

## Success Criteria

- Admin user can update OTP settings from Commerce UI.
- Config changes persist and are reflected in OTP runtime behavior.
- Unauthorized API access is blocked.
- Stable behavior is maintained with a single Doc DB backend.

## Operational Rollout Plan

1. Enable in Stage, validate auth and config flows.
2. Validate Doc DB persistence and OTP configuration behavior.
3. Run UAT with operations/admin stakeholders.
4. Promote to Production with monitoring enabled.

## Risks and Mitigations

- **Risk:** Host auth context unavailable leads to blocked config actions.
  - **Mitigation:** Ensure launch from Commerce Admin shell and verify IMS context handshake.

- **Risk:** Runtime configuration errors affect persistence behavior.
  - **Mitigation:** Keep `DB_BACKEND=docdb`, validate in stage, and monitor action logs.
