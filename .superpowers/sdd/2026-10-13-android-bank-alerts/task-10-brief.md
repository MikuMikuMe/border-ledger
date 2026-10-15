# Task 10 brief — statement identity and reconciliation

## Objective

Make statement import a durable reconciliation source instead of a local fingerprint merge. Preserve each statement row's source identity, classify weak overlaps as review candidates, and keep alert evidence/projection history intact when a statement confirms it.

## Scope

- Worker migration/schema for statement reconciliation candidates and durable commit metadata.
- A shared Worker reconciliation service for atomic statement-row commit, source-record identity, candidate creation, and explicit alert/statement review actions.
- Existing web import commit must call the shared durable service.
- Domain and parser changes may be made only by the separately assigned domain worker; do not overwrite those changes.
- Focused tests cover duplicate file/row replay, equal legitimate rows, weak overlap review, reversal-before-purchase, partial/full cancellation, cross-currency rejection, statement-before-alert, and annotation/source preservation.

## Invariants

- Strong statement identity is `(accountId, bankSourceId, bankRowId)`; fallback identity is `(accountId, fileSha256, rowIndex)`.
- A candidate fingerprint is never a unique identity and never silently merges transactions.
- Identical source replay is idempotent; overlapping exports without bank row IDs remain explicit review candidates.
- A confirmed statement transaction is created atomically with its source record and import operation; a failed batch creates neither.
- Alert events and source evidence remain immutable. A confirmed statement can supersede an alert projection only through an audited link/provenance revision.
- Lifecycle links stay within ledger/account/instrument scope, cannot form cycles, and never make negative spending.
- No Task 11+ UI/reports/theme work belongs in this task.

## Verification

- Direct TypeScript project check passes.
- Focused domain/Worker tests are added; run them when the dependency/runtime blocker permits.
- If Vitest/Miniflare/hosted D1 or Android tooling remains unavailable, record the exact limitation rather than claiming runtime success.
