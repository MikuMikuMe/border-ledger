# SDD ledger — plan: docs/superpowers/plans/2026-10-14-task12-backend-api.md

Pre-flight: Task 1 produces owner-bound staged-preview/operation invariants consumed by Tasks 2–3; the current store/service interfaces already expose those operations, so the implementation will preserve their names and add only bounded compatibility fields.

Baseline: Vitest runs from `C:\Windows` with `--root Z:\Projects\Personal-Finance`; current focused test has 5 tests, with CSV formula-cell safety and modern file-size persistence failing. Strict TypeScript currently fails because `ImportStoreError` has no `retryable` property in `worker/mobile.ts`.

Ruling: Use the existing Task 12 plan/spec as the authority and execute only the user-assigned backend/API files plus focused tests/helper/contract files — avoids touching explicitly excluded Android, UI, index, domain, reconciliation, recurring, and Plaid code.
