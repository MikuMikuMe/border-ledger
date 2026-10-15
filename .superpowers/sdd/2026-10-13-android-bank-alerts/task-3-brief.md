# Task 3 — Preserve populated D1 and add native-parity storage

## Scope

Add the next versioned D1 migrations, schema snapshot/types, and focused Worker stores for multi-currency accounts, alert/source identities, device/capture pairing, owner sessions/replay, staged imports, preferences, annotations, and lifecycle/provenance. Preserve every existing populated ID, provider cursor/lineage, recurring relationship/membership/classification, and annotation.

## Files

Use next unused migration numbers after Task 0’s verified remote baseline (`0000`–`0002`): expected local files are `worker/migrations/0003-multicurrency.sql`, `0004-mobile-alerts.sql`, `0005-native-parity.sql` (allocate differently only if a newly discovered applied migration requires it), `worker/schema.sql`, `worker/db-types.ts`, `worker/alert-store.ts`, `worker/device-store.ts`, `worker/owner-session-store.ts`, `worker/import-store.ts`, `worker/preferences-store.ts`, `worker/annotation-store.ts`, and migration/storage/provider identity tests. Extend `tests/helpers/d1.ts` only to exercise new local migrations.

Do not edit previously applied migrations. Do not apply any migration to remote Cloudflare D1 in this task; use local/synthetic fixtures only.

## Required behavior (tests first)

- Seed populated fixtures with accounts, transactions, Plaid IDs/pending IDs/cursors, recurring streams/memberships/classifications, and annotations. Assert IDs/counts/FKs survive migration and restore. One credit account accepts multiple approved currencies; new auth/import/preferences tables do not alter existing money.
- Add fixed server-owned ledger `personal`, `currency_mode` (`single`/`multi`), `account_currencies(account_id,currency)`, approved source-profile/hint mappings, devices/pairings, and allowed source/account/currency scopes. The legacy `accounts.currency` remains default currency, not a multi-currency constraint.
- Replace global uniqueness of `transactions.fingerprint` with a nonunique candidate index. Preserve existing transaction IDs, provider identity/pending lineage, recurring relationships and classifications; unknown legacy rows receive `legacy:<transactionId>` source identity without rewriting IDs. Two equal provider purchases and later modifications remain distinct.
- Add `transaction_source_records` with unique source identity for Plaid `(itemId, providerTransactionId)`, statement `(accountId, bankSourceId, bankRowId)` or `(accountId,fileSha256,rowIndex)`, alert `(personal,eventId)`, manual random UUID. Add immutable alert events/digests, lifecycle links/cycle constraints, projection provenance and annotation revisions.
- Store owner request/code hashes, session/refresh generations, exact expiry/revocation, encrypted bounded identical-response replay TTL 60 seconds; capture credentials separate hash/type/scope. Add staged import/preview/chunk identity and publication status plus revisioned shared preferences.
- Use prepared statements and atomic D1 batches; use deferred/FK-safe migration steps supported by D1, never unsupported FK disabling. Expired staging/replay cleanup must not delete unsent native events or confirmed history.

## Authority/constraints

Use the approved spec for ledger `personal`, identity keys, auth scopes, source/lifecycle semantics, and privacy. No real credentials, transaction rows, screenshots, or secrets. Do not implement route/auth behavior yet; stores should be bounded primitives for later tasks. No remote writes.

## Environment

The host has no writable Git metadata; do not claim commits. Existing npm/Vitest installation may be incomplete on the WebDAV mount. Record exact test/typecheck limitations. Remote API metadata shows both sandbox and production currently have only migrations 0000–0002, so 0003+ are safe names for this plan but must not be applied remotely here.

## Report

Write `.superpowers/sdd/2026-10-13-android-bank-alerts/task-3-report.md` with TDD RED/GREEN evidence, migration/storage test output, schema/fixture checks, changed files, and concerns. Return under 15 lines with DONE/DONE_WITH_CONCERNS/BLOCKED, no-commit note, one-line verification, and report path.
