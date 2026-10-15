# Task 4 report

Status: implemented with verification limitations; handoff requested before further changes.

## Scope delivered

- Added bounded Worker owner-auth primitives for login start, Access approval, one-use PKCE/state-bound exchange, opaque encrypted access/refresh credentials, refresh rotation, replay recovery, family revocation, logout, and owner authentication.
- Added capture pairing, explicit owner approval, selected source/account/currency scopes, one-use claim, 90-day capture credentials, separate revocation capabilities, capture authentication, scope guards, and idempotent revocation.
- Added the Task 4 hardening migration/schema fields, narrow mobile request handler, direct SQLite-D1 behavior tests, route-guard checks, and the matching OpenAPI response fields.
- Preserved the canonical-origin/raw-host 404, webhook handling order, same-origin mutation guard, and legacy browser/global-key authorization branch. No Android UI, broad mobile feature routes, remote writes, or production secrets were added.

## Checks completed

| Check | Result | Exact evidence |
| --- | --- | --- |
| Initial direct RED | Expected failure | `node --experimental-strip-types tests/mobile-auth-direct.ts` failed with `ERR_MODULE_NOT_FOUND` for the not-yet-implemented `worker/mobile-auth.ts`. |
| Direct auth/pairing suite | PASS | `node --experimental-strip-types --experimental-loader ./tests/helpers/resolve-ts-loader.mjs tests/mobile-auth-direct.ts` exited 0 and printed `TASK4_DIRECT_AUTH_PAIRING_OK`. |
| Direct route guards | PASS | `node --experimental-strip-types --experimental-transform-types --experimental-loader ./tests/helpers/resolve-ts-loader.mjs tests/mobile-route-direct.ts` exited 0 and printed `TASK4_DIRECT_ROUTE_GUARDS_OK`. |
| TypeScript check | PASS | `node node_modules/typescript/lib/tsc.js --noEmit --pretty false` exited 0. |
| Migration smoke check | PASS | Node 24 `DatabaseSync` applied migrations `0000` through `0006`; printed `TASK4_MIGRATIONS_OK capture_credentials,device_pairings,mobile_auth_requests,owner_refresh_generations,owner_replay_records,owner_session_families`. |
| Focused Vitest | BLOCKED before collection | `node node_modules/vitest/vitest.mjs run tests/mobile-auth.test.ts` exited 1 because `node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs` is missing; no assertions ran. |

The direct behavior suite covers wrong PKCE/state/host/environment, Access identity approval, hashed request secrets, exact access/refresh/pairing lifetimes, one-use exchange and claim, identical 60-second replay recovery, refresh rotation and replay-family revocation, Stay signed in, capture token substitution/type and scope denial, selected currency scope denial, owner/capture revocation capabilities, idempotent logout/revocation, and credential storage separation.

## Known limitations and follow-up concerns

- The Vitest dependency tree is incomplete (`@jridgewell/trace-mapping`); the Miniflare/workerd harness is also unavailable in this workspace. The direct checks use Node 24 experimental TypeScript stripping/loading and an in-memory SQLite D1 adapter, so they are not a hosted-D1 or workerd substitute.
- The full Vitest suite was not claimed green. No install was run, and no remote migration, secret, deployment, or repository write was performed.
- Direct regressions now cover wrong callback path, an approved-but-expired authorization code, cross-account source-hint collisions, and a stale rotated owner token attempting to revoke a newer capture grant. An expired owner token against a newer capture grant remains a minor unseparated coverage case; the implementation rejects expiry before mutation.
- Git metadata is unavailable in the shared checkout, so there is no commit/branch status to report. Existing Task 0–3 work was left in place.
- A later reviewer should re-check that the refactored Access JWT identity helper preserves every legacy acceptance case while approval flows continue to require an approved subject/issuer/audience identity.

No raw credential values or production secrets were logged by the implementation or checks.
