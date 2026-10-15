# Task 4 report

## Status

`COMPLETE`

The three canonical production transaction inserts now supply `fx_lock_date` explicitly from their existing canonical transaction/accounting date. Existing update paths were left unchanged so they cannot replace an established lock. No commit was created.

## Production write inventory

Commands run from `Z:\Projects\Personal-Finance`:

```text
rg -n -i --glob '*.ts' 'insert\s+(or\s+\w+\s+)?into\s+transactions' worker
```

Result: exactly three production transaction inserts were found:

- `worker/plaid.ts:229`
- `worker/alert-ingestion.ts:282`
- `worker/reconciliation-store.ts:505`

```text
rg -n -i --glob '*.ts' 'update\s+transactions\s+set' worker
```

Result: ten production transaction updates were found:

- `worker/plaid.ts:225`
- `worker/alert-ingestion.ts:315,323`
- `worker/mobile-review.ts:592`
- `worker/reconciliation-store.ts:543,546,837,840,911,919`

Only the Plaid update changes `date`; it does not write `fx_lock_date`, so a pending row retains its original lock when the posted date changes. The other updates change status and/or amount only. `worker/mobile-import.ts` delegates publication to `commitStatementRows`; it does not insert or update transactions directly. `worker/mobile-review.ts` changes status/notes only, so neither production mobile file required a write-path edit.

## Files changed

Production writers:

- `worker/plaid.ts` — first insert binds `fx_lock_date = mapped.date`; conflict/update clauses do not update the lock.
- `worker/alert-ingestion.ts` — alert projection insert binds `fx_lock_date = transaction.date`.
- `worker/reconciliation-store.ts` — statement insert binds `fx_lock_date = item.row.date`; replay and review updates do not update the lock.

Focused regression tests:

- `tests/plaid.test.ts`
- `tests/reconciliation-storage.test.ts`
- `tests/alerts-ingestion.test.ts`
- `tests/mobile-import-export-task12.test.ts`
- `tests/mobile-review-task16.test.ts`

Report:

- `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-4-report.md`

No FX provider/report module, migration/schema, web, Android, or CI file was changed. No subagent was spawned.

## Test and typecheck evidence

### Mapped-checkout focused test attempt

```text
npm test -- tests/plaid.test.ts tests/reconciliation-storage.test.ts tests/alerts-ingestion.test.ts tests/mobile-import-export-task12.test.ts tests/mobile-review-task16.test.ts --run
```

Working directory: `Z:\Projects\Personal-Finance`

Result: exit code 1 before test collection. Vitest could not create its API token after `CMD.EXE` rejected the UNC current directory:

```text
Startup Error
Error: Failed to create Vitest API token ...
```

### Local-mirror RED run before production edits

The working tree was copied to `C:\Users\aa207\AppData\Local\Temp\border-ledger-verify` without replacing its installed dependencies, then this command ran:

```text
npm test -- tests/plaid.test.ts tests/reconciliation-storage.test.ts tests/alerts-ingestion.test.ts tests/mobile-import-export-task12.test.ts tests/mobile-review-task16.test.ts --run
```

Result: exit code 1; 5 test files failed; 6 tests failed and 54 passed.

Expected writer failures:

- Plaid pending-to-posted row: `fx_lock_date` was `null` instead of `2026-10-09`.
- Statement insert/replay row: `fx_lock_date` was `null` instead of `2026-10-08`.
- Mobile statement publication row: `fx_lock_date` was `null` instead of `2026-10-13`.
- Alert insert/replay row: `fx_lock_date` was `null` instead of `2026-10-09`.

The tests deliberately dropped only `transactions_fx_lock_date_default` so they exercised each writer's explicit mapping against the real D1 schema. One mobile-review assertion also failed because a confirmed, unannotated alert row is intentionally deleted during supersession; that assertion was narrowed to verify the surviving statement lock and the expected alert deletion. One pre-existing alert-ingestion case failed with Undici `TypeError: fetch failed`, caused by `Error: bad port`; it was unrelated to the lock assertion.

### Local-mirror GREEN attempt after production edits

```text
npm test -- tests/plaid.test.ts tests/reconciliation-storage.test.ts tests/alerts-ingestion.test.ts tests/mobile-import-export-task12.test.ts tests/mobile-review-task16.test.ts --run
```

The run was stopped with Ctrl+C at the user's request and exited 1. Partial output before termination:

```text
tests/reconciliation-storage.test.ts: 14 tests, 11 failed
tests/alerts-ingestion.test.ts: 12 tests, 5 failed
tests/mobile-import-export-task12.test.ts: 16 tests, 2 failed
```

The displayed failures were in existing cases that still construct pre-`0018-fx-snapshots.sql` schemas while invoking the now-explicit writers. Detailed assertion/error output for this interrupted run was not emitted before termination, and `tests/mobile-review-task16.test.ts` / `tests/plaid.test.ts` did not report final file summaries. Therefore no passing focused-test claim is made.

### Typecheck

```text
npm run typecheck
```

Working directory: `C:\Users\aa207\AppData\Local\Temp\border-ledger-verify`

Result: exit code 0.

```text
> cross-border-spending-tracker@0.1.0 typecheck
> tsc --noEmit
```

### Local-mirror GREEN run after fixture repair

The focused fixtures were upgraded to the current `0018-fx-snapshots.sql` schema wherever they invoke the current transaction writers. Historical migration-installation assertions intentionally retain their older migration sets. The partial-cancellation regression now asserts that the original `fx_lock_date` remains unchanged while the amount is adjusted.

```text
npx vitest run tests/plaid.test.ts tests/reconciliation-storage.test.ts tests/alerts-ingestion.test.ts tests/mobile-import-export-task12.test.ts tests/mobile-review-task16.test.ts --pool=threads --maxWorkers=1 --testTimeout=15000 --reporter=verbose
```

Working directory: `C:\Users\aa207\AppData\Local\Temp\border-ledger-verify`

Result: exit code 0; 5 test files passed, 60 tests passed.

```text
npm run typecheck
```

Working directory: `C:\Users\aa207\AppData\Local\Temp\border-ledger-verify`

Result: exit code 0.

## Concerns

- The mapped checkout cannot start Vitest because of the UNC/API-token limitation; the green evidence above uses the local mirror with the current source/test files copied into it.
- No commit was created because the mapped checkout exposes an incomplete Git object database.
