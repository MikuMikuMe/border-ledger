# Task 4 — owner login broker, capture pairing, and credential boundaries

## Scope

Implement the Worker-side auth/pairing primitives on top of the accepted Task 2 contracts and Task 3 stores. This task owns owner login start/exchange/refresh/authentication, narrow capture pairing/claim/revocation, scope guards, and safe broker resources. Do not implement the Android session manager or full feature routes yet; do not weaken existing browser/webhook guards.

## Files

Expected files: `worker/mobile-owner-auth.ts`, `worker/mobile-auth.ts`, `worker/device-pairing.ts`, any narrowly required updates to `worker/owner-session-store.ts`, `worker/device-store.ts`, `worker/alert-store.ts`/validation, explicit auth/pairing tests, and public `.well-known/assetlinks.json` only if the existing origin/host is authoritative. Do not edit applied migrations or add secrets/real identities.

## Required behavior (tests first)

- Owner login: ten-minute Access-backed request; PKCE S256 and state bound to device/request; verified HTTPS callback host/path; explicit approved Access identity; two-minute one-use code; wrong state/verifier/host/path, expired/consumed/duplicate code, conflicting claims, environment mismatch, and unapproved identity fail without issuing tokens.
- Owner sessions: opaque hashes at rest; 15-minute access; rotating 24-hour refresh or explicit 30-day Stay signed in; absolute expiry/family revocation; single-flight/digest recovery; identical exchange/refresh response replay is encrypted and exactly 60 seconds; conflicting reuse revokes the session family; revocation is checked on every request.
- Capture pairing: ten-minute pairing session and eight-character code; explicit owner consent for selected source/profile/account/currency scopes; 32 random-byte credential hash only, 90-day lifetime, `alerts:write` only; separate capture type/scope/revocation and no owner/import/export/recurring/bank/device-management access.
- Scope guards: owner token cannot fall through old browser/global-key guard; capture cannot read whole ledger or mutate owner features; owner/auth paths remain personal-ledger-only and preserve raw-host 404 and verified webhook behavior.
- Logout/revocation: owner logout revokes owner/capture grants and supports idempotent revocation; separate revocation-only capabilities expire with each grant; offline revocation intent can revoke but cannot restore or revoke newly issued grants. No raw tokens/codes/state in logs or responses beyond required one-time exchange.
- Use prepared statements/atomic D1 batches and existing bounded stores. No remote writes; no full route/UI implementation; test with synthetic hashes/identities only.

## Verification/report

Write `.superpowers/sdd/2026-10-13-android-bank-alerts/task-4-report.md` with TDD RED/GREEN evidence, exact typecheck/test limitations, changed files, and concerns. Runtime Vitest/Miniflare may remain blocked by the known dependency gaps; do not claim those suites passed. Return under 15 lines with status and report path.
