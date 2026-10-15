# Task 4 Review Follow-up

Date: 2026-10-13

Scope is limited to the Task 4 owner-session logout boundary, capture pairing hint resolution, and direct auth/route coverage. Task 0–3 behavior is preserved; Task 5 and broad route work are out of scope.

## Findings fixed

- `logoutOwnerSession` now authenticates the owner access token through `authenticateOwner` with the `devices:manage` scope before revoking anything. Expiry, current family/generation, environment, ledger, and owner scope are checked by that authoritative path. Device-wide capture revocation uses the authenticated family/device context and is conditional on the same current generation. Rotated or expired tokens fail closed without changing the family or capture rows. Repeating logout for the already-revoked same generation is a no-op. Revocation-only capabilities remain handled only by the revocation-capability path.
- Explicit pairing hints now have to resolve to exactly one approved account. A same-hint mapping collision across accounts returns `ambiguous_scope` and leaves the pairing pending, even when the selected account is one of the candidates.
- Direct cases cover a wrong callback path, an approved-but-expired owner code, a colliding source hint, and a newer capture grant surviving replay of a rotated owner token.

## Verification

- Direct auth/pairing smoke: `TASK4_DIRECT_AUTH_PAIRING_OK`.
- Direct route smoke: `TASK4_DIRECT_ROUTE_GUARDS_OK`.
- TypeScript: `tsc --noEmit --project tsconfig.json` exited 0.
- Vitest targeted and full runs could not start because the existing WebDAV `node_modules` lacks `@jridgewell/trace-mapping/dist/trace-mapping.mjs`; running npm scripts directly from the UNC checkout also reports that CMD does not support UNC working directories. The direct auth case uses the repository's Node SQLite fixture, so it is independent evidence, not a claim that the Vitest/Miniflare suite passed.
