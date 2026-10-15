# Task 2 report

## Status

`DONE_WITH_CONCERNS`

Task 2 is implemented in the requested scope. No commit was created.

## Files changed

- `worker/migrations/0018-fx-snapshots.sql`
- `worker/schema.sql`
- `worker/db-types.ts`
- `tests/helpers/d1.ts`
- `tests/fx-snapshot-migration.test.ts`
- `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-2-report.md`

The migration adds the nullable/backfilled `transactions.fx_lock_date`, validates initial explicit values against `NEW.date`, fills omitted values through an insert trigger, and rejects established lock-date changes. It adds bounded immutable `fx_rate_snapshots` storage with a primary requested-date key (the primary-key index is sufficient for exact report reads), Frankfurter-only provider check, and immutable update/delete triggers. Requested/effective dates require the bounded `YYYY-MM-DD` shape.

`worker/db-types.ts` provides the typed, parameterized helpers `readFxSnapshot(db, requestedDate)` and `insertFxSnapshotIfAbsent(db, snapshot)`. The latter uses `ON CONFLICT(requested_date) DO NOTHING` and returns whether the first write won. `tests/helpers/d1.ts` exports migration lists through `0018-fx-snapshots.sql`.

## Verification

Review-fix RED run:

- `cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/fx-snapshot-migration.test.ts --run"` — exit code `1`; 6 tests collected, 2 failed because malformed 10-character dates were accepted by migration/bootstrap checks, and 4 passed.

Final local-mirror commands:

```text
Command: npm test -- tests/fx-snapshot-migration.test.ts --run
Working directory: C:\Users\aa207\AppData\Local\Temp\border-ledger-verify
Exit code: 0
Output: Test Files 1 passed (1); Tests 6 passed (6)

Command: npm test -- tests/multicurrency-migration.test.ts --run
Working directory: C:\Users\aa207\AppData\Local\Temp\border-ledger-verify
Exit code: 0
Output: Test Files 1 passed (1); Tests 5 passed (5)

Command: npm run typecheck
Working directory: C:\Users\aa207\AppData\Local\Temp\border-ledger-verify
Exit code: 0
Output: > cross-border-spending-tracker@0.1.0 typecheck; > tsc --noEmit
```

The local mirror was synced only with the scoped migration, bootstrap schema, db types, migration helper list, and focused test before these commands. The focused test now covers the populated pre-FX backfill/preservation path, omitted lock default, lock immutability, snapshot first-write-wins/read helper, snapshot immutability, provider check, all bounded CHECK boundaries, composite account/currency FK rejection, and executable bootstrap schema/triggers/default.

Earlier TDD evidence: the initial migration test was RED with the migration file missing; the helper cycle was RED with `TypeError: insertFxSnapshotIfAbsent is not a function`; both later passed.

The direct UNC command `npm test -- tests/fx-snapshot-migration.test.ts --run` remains blocked before collection because `CMD.EXE` rejects the UNC working directory and Vitest cannot create its API token. No UNC rerun was waited for. Process cleanup found no `node`/`npm` process; CIM process inspection was unavailable due client access restrictions.

## Concerns

- The UNC checkout remains unable to run Vitest directly; all requested final verification completed successfully in the local mirror.
