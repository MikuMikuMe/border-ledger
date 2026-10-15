# Task 11 brief — native ledger shell, reports, and theme states

## Objective

Expose the owner-gated native ledger jobs through a real Compose shell: Overview, Recurring, Activity, Review, and Accounts. Preserve the Border Ledger paper/ink theme in System/Light/Dark modes and make loading, empty, offline, review, and signed-out states explicit.

## Scope

- Android Compose navigation/state shell and injectable ledger UI model adapter.
- Owner-session and `LedgerRepository` boundary: no financial cache or demo records while signed out.
- Theme roles, accessible controls, safe drawing/IME insets, Back/state restoration.
- Domain report aggregation and full-query pagination semantics are separate from this shell; do not fake server totals where the current API is not available.

## Invariants

- Capture credentials never authorize owner reads.
- Signed-out/expired/revoked state exposes no financial values.
- No browser detour or demo fallback is presented as a native ledger feature.
- Every destination has a reachable, honest state even when data is unavailable.
- Controls are at least 48 dp and labels remain usable with large fonts/TalkBack.

## Verification

- Direct source/static checks and focused Compose model tests.
- Android Gradle/device evidence remains pending if the wrapper/toolchain/ADB is unavailable.
