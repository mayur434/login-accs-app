# Technical Document

## Solution Overview

This project is an Adobe App Builder extension integrated into Adobe Commerce Admin. It provides an Admin UI to manage OTP-login module settings and exposes backend actions for config and OTP operations.

Core modules:

- UI: `web-src/src/components/AdminUi.js`
- Extension registration: `web-src/src/components/ExtensionRegistration.js`
- App config action: `actions/app_config/index.js`
- OTP action: `actions/otp/otp.js`
- Extension runtime config: `ext.config.yaml`

## Runtime Architecture

- Frontend (React + Spectrum) is served from App Builder static hosting.
- Backend actions run on Adobe I/O Runtime (Node.js 22).
- Admin configuration is handled through the `app_config` web action.
- OTP workflow is handled through the `otp` web action.

## Authentication and Authorization

- Sensitive actions are protected using `require-adobe-auth: true` in `ext.config.yaml`.
- Admin UI sends IMS auth headers (`Authorization`, `x-gw-ims-org-id`) from Commerce host context.
- If IMS context is unavailable, UI blocks save/load calls and shows a meaningful message.

## Data Backend Strategy

The solution currently uses `docdb` (Adobe App Builder database) as the active storage backend.

`db_backend` is configurable from Admin UI and persisted by `app_config` action.

## Key APIs

- `GET /app_config`: fetch current module configuration.
- `POST /app_config`: update module configuration.
- `POST /otp` (generate): create OTP reference.
- `POST /otp` (validate): verify OTP and issue token flow.

## Deployment Inputs (important)

Use `DB_BACKEND=docdb` for current deployments.

## Common Failure and Fix

- **Error:** `missing authorization header`
  - Cause: IMS token not available in host context.
  - Fix: open extension from Commerce Admin and ensure host context is loaded.

## Engineering Notes

- Do not log secrets such as raw DB passwords or bearer tokens.
- Use `LOG_LEVEL=debug` only for troubleshooting in non-production contexts.
