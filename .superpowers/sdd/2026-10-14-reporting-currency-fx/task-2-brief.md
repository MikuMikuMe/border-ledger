# Task 2 — Immutable transaction lock date and D1 snapshot storage

Read this brief first; it is the complete task requirement. You own only:

- `worker/migrations/0018-fx-snapshots.sql` (create)
- `worker/schema.sql`
- `worker/db-types.ts`
- `tests/helpers/d1.ts` only to add an exported migration list if needed
- `tests/fx-snapshot-migration.test.ts` (create)

The checkout is shared with other workers: do not revert unrelated edits, do not edit report aggregation/routes/UI/Android/CI, do not spawn subagents, and do not commit because this mapped checkout has no usable Git object database. Task 1 may add an FX snapshot type to `worker/db-types.ts`; preserve compatible types and extend them rather than replacing them.

Add an additive migration after `0017-import-duplicate-decisions.sql`.

Schema requirements:

- Add nullable `transactions.fx_lock_date TEXT` and backfill every existing row from its canonical `date`.
- New inserts that omit the column must receive the canonical `date` through an insert trigger. The initial lock is allowed to be filled only with `NEW.date`; once established, changing it must abort. Preserve compatibility with all existing direct fixtures/writers.
- Add `fx_rate_snapshots` with one row per `requested_date`, fields `requested_date`, `effective_date`, `provider` (only `frankfurter`), `rates_json`, `content_digest`, and `fetched_at`. Add bounded text checks, a primary/unique requested-date key, and an index usable by report reads.
- Snapshot rows are immutable: update and delete must abort. First-valid-response semantics are enforced by the primary key plus an insert-if-absent helper if one is needed. Do not add a network call here.
- Keep existing foreign keys, account-currency constraints, and bootstrap behavior intact. Update `worker/schema.sql` to match the final table/column/trigger shape.
- Add typed `FxRateSnapshotRow` and transaction row lock field types only if useful; keep SQL parameterized.

Tests must use a populated pre-FX fixture and cover: backfill, preservation of source amounts/currencies/provider IDs/notes, an insert omitting the new column, established lock-date rejection, snapshot update/delete rejection, first-write-wins insertion behavior, and foreign keys. Use the existing `applyMigrations`/Miniflare conventions. Run the focused test plus the existing multicurrency migration test.

Write `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-2-report.md` with files changed, exact commands/output, and concerns. Return only status/report path/test summary/concerns.
