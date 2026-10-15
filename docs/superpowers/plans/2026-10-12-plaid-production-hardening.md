# Plaid Production Hardening Implementation Plan

> For agentic workers: execute this plan task-by-task and keep the checklist current.

**Goal:** Make the Personal Finance app safe to prepare for a real Plaid connection by closing the identified browser/API security gaps, requiring explicit account selection, supporting revocation, and documenting a controlled production rollout.

**Architecture:** Keep the existing same-origin React app and Cloudflare Worker API. Add small, unit-testable Worker security and validation helpers; enforce the configured application origin at the Worker boundary; keep Plaid secrets server-side; make account selection an explicit client-to-server allowlist; and use Plaid's Item removal flow for disconnects.

**Tech Stack:** React/Vite, TypeScript, Cloudflare Workers, D1, Queues, Plaid Link, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-cross-border-spending-tracker-design.md`

## Global constraints

- Keep Sandbox as the default deployment. Add an explicit production Wrangler environment rather than silently switching the currently deployed Worker.
- Never send Plaid access tokens, client secrets, encryption keys, or the ledger API key to the browser.
- Treat Plaid Link metadata as user-interface input only; the Worker must validate selected account IDs against Plaid's server response.
- Disconnect revokes the Plaid Item first, then removes local synchronization credentials and mappings while preserving existing local ledger history.
- Use the current workspace inline because this checkout has no Git repository. Do not create commits or rewrite unrelated user files.

## Review focus

- Origin and CSRF protection must prevent the raw Worker hostname from being an alternate authenticated API.
- State-changing and data-returning API responses must not be browser-cacheable.
- Request bodies and imported data must be bounded and validated before database writes.
- Plaid webhook verification must remain signature-based and must not expose detailed verification errors.
- Production readiness must clearly distinguish code readiness from the final Plaid approval, secret provisioning, deployment, and live smoke test.

---

### Task 1: Add boundary security and validation primitives — complete

**Files:**
- Create: `worker/security.ts`
- Create: `worker/validation.ts`
- Modify: `worker/index.ts`
- Create: `tests/worker-security.test.ts`
- Create: `tests/worker-validation.test.ts`

**Steps:**

1. Write failing tests for allowed application origins, same-origin state-changing requests, bounded request bodies, security headers, and strict import/account-selection validation.
2. Run the focused tests and confirm they fail for the expected missing behavior.
3. Implement the helpers without logging secrets or request bodies.
4. Integrate them at the Worker boundary: reject non-application API origins, require same-origin state changes, bound JSON bodies, add no-store/security headers to API responses, and validate import and Plaid exchange inputs before database writes.
5. Run the focused tests again, then the full suite.

### Task 2: Make Plaid account selection explicit and server-enforced — complete

**Files:**
- Modify: `worker/index.ts`
- Modify: `worker/plaid.ts`
- Modify: `src/plaid-link.ts`
- Modify: `src/App.tsx`
- Modify: `src/domain/types.ts`
- Modify: `src/styles.css`
- Modify or create relevant UI tests under `tests/`

**Steps:**

1. Add failing tests for Link-token account filters, fixed webhook configuration, and exchange rejection when selected account IDs are missing or do not match Plaid's `/accounts/get` response.
2. Run the focused tests and confirm the new expectations fail.
3. Add the configured HTTPS webhook URL and supported depository/credit account filters to Link-token creation.
4. Preserve Plaid Link's returned account metadata in the client, show a confirmation dialog, and send only the user's selected account IDs to the exchange endpoint.
5. Filter server-side accounts by the selected IDs and return/store only those accounts. Never trust the client-supplied institution name.
6. Run UI, Worker, and full regression tests.

### Task 3: Implement Plaid disconnect and credential revocation — complete

**Files:**
- Modify: `worker/index.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify or create relevant tests under `tests/`

**Steps:**

1. Write failing tests for disconnect input validation and the required revoke-before-delete behavior.
2. Run the focused tests and confirm they fail.
3. Add an authenticated, same-origin disconnect route that calls Plaid `/item/remove`, then deletes encrypted local Item credentials and mappings, marks connected accounts import-only, and preserves prior transaction history.
4. Return the mapped Plaid Item ID with connected accounts so the UI can offer a clearly labeled institution disconnect action.
5. Add the UI action, confirmation, refresh, and safe error handling.
6. Run focused and full regression tests.

### Task 4: Prepare controlled production configuration and documentation — complete

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Steps:**

1. Add `LEDGER_APP_ORIGIN` and `PLAID_WEBHOOK_URL` configuration, keep Sandbox at the default environment, and add a clearly named production environment with `PLAID_ENV=production`.
2. Document the exact production secret provisioning, Plaid approval prerequisite, Cloudflare Access policy, edge rate-limit requirement for the public webhook, deploy command, and post-deploy smoke tests.
3. Update direct development dependencies to patched versions indicated by the audit, then regenerate the lockfile without running install scripts.
4. Run typecheck, tests, build, and both full and production-only dependency audits.

### Task 5: Final security review and handoff — code complete; deployment gates remain

**Files:**
- Review all changed files and relevant route/config tests.

**Steps:**

1. Re-run the verification commands from a clean NTFS copy because the workspace is on WebDAV and its existing `node_modules` is not reliable.
2. Inspect the final diff for secret exposure, missing origin checks, unsafe error messages, unbounded inputs, and accidental production flips.
3. Report what is fixed, what remains an explicit deployment/Cloudflare action, and whether the app is safe to connect now or only after the listed production gates pass.
