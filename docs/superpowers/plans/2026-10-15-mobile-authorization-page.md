# Mobile Access Authorization Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `MOBILE_ACCESS_AUTHORIZATION_URL` point to a real Access-protected web approval page that completes the Android PKCE login flow and returns to the verified app callback.

**Architecture:** The Worker will append the already-generated PKCE state to the fixed authorization-page URL alongside the opaque request ID. The SPA will render a dedicated `/mobile/authorize` route, require an explicit same-origin approval POST, validate the Worker-provided HTTPS callback shape, and redirect with the approved code and original state. The Worker issues one code atomically and keeps a short-lived encrypted replay response so a lost browser response can retry without minting another code. No mobile token or private Worker secret is exposed to the page.

**Tech Stack:** Cloudflare Worker TypeScript, React 18, Vite, Vitest/jsdom, existing CSS tokens and Cloudflare Access session cookies.

**Spec:** `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md` (Interactive login and session architecture; mobile auth endpoint contract)

## Global Constraints

- Cloudflare Access remains the identity boundary; the page must not collect passwords or mint credentials in the browser.
- The Worker owns request, PKCE, state, callback, and code validation; the page only submits explicit consent and follows the returned callback.
- The callback must remain HTTPS and exactly `/android/auth/callback`; arbitrary redirects are rejected.
- Missing, malformed, expired, repeated, or failed requests must fail closed with a recoverable UI state.
- The page must be keyboard accessible, have visible focus, live status/error regions, and respect reduced motion.

## Review Focus

- Missing or malformed `request_id`/`state` must not trigger an approval request.
- Double activation while approval is pending must issue only one request.
- HTML, non-2xx, malformed, or incomplete Worker responses must never redirect.
- A callback from another origin/path or with an existing fragment must be rejected.
- A successful response must be JSON with the complete approval schema, including a parseable expiry.
- Approval must issue one code atomically at the Worker boundary even if two browser tabs submit the same request; an approved identity may recover the same response from the short-lived encrypted replay record.
- The authorization code and its encrypted replay response must share the same 60-second lifetime.
- `MOBILE_CALLBACK_URL`, when configured, must be HTTPS on the canonical app origin at exactly `/android/auth/callback` with no query, fragment, or credentials.
- The configured authorization page must be HTTPS on the canonical app origin at exactly `/mobile/authorize`.
- A successful approval must preserve the exact state and code in the callback query without displaying them as page content.

### Task 1: Bind the PKCE state to the authorization page

**Files:**
- Modify: `worker/mobile-owner-auth.ts`
- Test: `tests/mobile-auth-cases.ts`

**Interfaces:**
- Consumes: existing `OwnerLoginStart.state` and `MobileAuthConfig.accessAuthorizationUrl`.
- Produces: `OwnerLoginRequest.authorizationUrl` containing `request_id` and the original `state` query parameters.

- [x] Write the failing assertion that the start URL preserves the exact state while the database continues to store only its hash.
- [x] Run `npm test -- --run tests/mobile-auth.test.ts` and observe the expected failure.
- [x] Append `state` to the configured authorization URL using `URL.searchParams`.
- [x] Re-run the focused test and the full test suite.
- [x] Commit as `fix: bind mobile authorization state to approval page`.

### Task 2: Build the app-owned approval page and route

**Files:**
- Create: `src/MobileAuthorizationPage.tsx`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `worker/mobile.ts`
- Test: `tests/mobile-authorization-page.test.ts`
- Test: `tests/mobile-authorization-route.test.ts`

**Interfaces:**
- Consumes: `request_id` and `state` from `/mobile/authorize`, `POST /api/mobile-auth/requests/{id}/approval`.
- Produces: explicit approval UI and callback redirect to the Worker-returned `/android/auth/callback?state=...&code=...` URL.

- [x] Write tests for missing parameters, successful approval/redirect, duplicate-click suppression, and unsafe callback rejection.
- [x] Run the focused jsdom test and observe failures because the route/component does not exist.
- [x] Implement the route, bounded query validation, approval request, response validation, explicit consent button, cancel/error states, and accessible visual treatment.
- [x] Return the Worker-validated callback URL from the approval route so the page does not reconstruct a redirect target from untrusted browser state.
- [x] Require `application/json` and the complete `{ approved, code, callbackUrl, expiresAt }` approval response, reject explicit empty fragments, make code issuance atomic, and add a short-lived encrypted replay response for safe retry after a lost browser response.
- [x] Align the authorization code expiry with the replay TTL so an expired replay cannot strand a still-valid code.
- [x] Enforce `MOBILE_ACCESS_AUTHORIZATION_URL` as the canonical HTTPS app route `/mobile/authorize` during Worker configuration parsing.
- [x] Enforce `MOBILE_CALLBACK_URL` as the canonical HTTPS app callback `/android/auth/callback` during Worker configuration parsing.
- [x] Re-run focused tests and the full web test suite.
- [x] Commit as `feat: add mobile access authorization page`.

### Task 3: Document and verify the production configuration

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-15-automatic-app-release-and-cloudflare-deploy.md` (workspace plan, when available)

- [x] Document the production value `https://pf.lofuyu.com/mobile/authorize` and distinguish it from the Worker secret key.
- [x] Run typecheck, test, build, and Wrangler dry-run.
- [x] Run a final diff/security review, address replay/callback findings, and record the result.
- [x] Commit documentation and verification updates.
