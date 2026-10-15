# Task 3 report — populated D1 and native-parity storage

Status: **DONE_WITH_CONCERNS**. The three Important review findings are fixed in the shared workspace. Task 0–2 files and applied migrations `0000`–`0002` were not edited; no remote D1, production data, secrets, or real notification material was used.

## Review follow-up

- `worker/plaid.ts` no longer looks up or conflicts on `fingerprint`. It resolves Plaid identity by item/current/pending IDs, uses `ON CONFLICT(id)` only for the local row, and batches the transaction write with an idempotent `(personal, plaid, identity_key)` source-record upsert. Pending and current IDs are retained with `COALESCE`; pending-to-posted lineage produces both source identities and deletes cascade safely.
- `0003-multicurrency.sql` creates/populates `account_currencies` before the rebuilt transactions table, adds the composite transaction currency FK, and seeds default currency rows for accounts created after migration. `0004-mobile-alerts.sql` and `worker/schema.sql` add the composite `(transaction_id, account_id)` source-record FK with cascade; `appendTransactionSourceRecord` also rejects mismatched account provenance before insert.
- Added focused regressions in `tests/provider-identity.test.ts`, `tests/multicurrency-migration.test.ts`, and `tests/alert-storage.test.ts` for equal purchases, idempotent provenance, pending/current lineage, approved/rejected currencies, and direct-D1/store provenance rejection.

## TDD and verification evidence

- Pre-fix SQLite RED: `PLAID_CONFLICT_RED ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`; invalid currency and mismatched source rows were both accepted (`1` row each).
- Direct TypeScript GREEN: `node node_modules/typescript/lib/tsc.js --noEmit --pretty false --diagnostics` exited `0` (405 files; total time 29.77s).
- Final Python 3.14 SQLite smoke exited `0`: `MIGRATIONS_OK 34 []`, `ACCOUNT_CURRENCY_OK 5`, `PLAID_IDENTITY_OK 2`, `PLAID_LINEAGE_OK ('posted-2', None)`, `SOURCE_CONSISTENCY_OK 2`, `SCHEMA_SNAPSHOT_OK 124 []`. It used `PRAGMA foreign_keys=ON`, populated migration data, approved/rejected writes, provider identity/lineage/source upserts, cascade deletion, and the standalone schema snapshot.
- Fresh final smoke also exited `0`: `FINAL_SQLITE_SMOKE_OK [] []` and `FINAL_IDENTITY_COUNTS 2 1` (zero foreign-key violations, two equal-fingerprint purchases, one idempotent provider source record).
- Targeted and full Vitest runs remain blocked before collection by `ERR_MODULE_NOT_FOUND: ...node_modules\\@jridgewell\\trace-mapping\\dist\\trace-mapping.mjs`; no Vitest assertion pass is claimed.
- Miniflare/D1 remains unavailable: importing/starting Miniflare fails with `Error: Cannot find module 'workerd'`.

## Changed files in this follow-up

- `worker/plaid.ts`
- `worker/migrations/0003-multicurrency.sql`
- `worker/migrations/0004-mobile-alerts.sql`
- `worker/schema.sql`
- `worker/alert-store.ts`
- `tests/provider-identity.test.ts`
- `tests/multicurrency-migration.test.ts`
- `tests/alert-storage.test.ts`
- `.superpowers/sdd/2026-10-13-android-bank-alerts/task-3-report.md`

## Remaining concerns

- Hosted D1/Miniflare runtime assertions and Vitest execution still require a repaired dependency/runtime installation; SQLite is a syntax/FK/constraint smoke, not hosted-D1 proof.
- The WebDAV workspace has no usable Git metadata (`git` reports `fatal: not a git repository`), so no commit or diff-based review artifact exists. No reset, revert, remote write, route change, or auth change was performed.
