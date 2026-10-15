# Task 4 — Canonical writers preserve the FX lock date

Read the design and plan, then inspect every production `INSERT INTO transactions` and transaction-date update. Own only the production writer files and focused regression tests:

- `worker/plaid.ts`
- `worker/reconciliation-store.ts`
- `worker/alert-ingestion.ts`
- `worker/mobile-import.ts` / `worker/mobile-review.ts` only if a production write path requires it
- any other production transaction writer found by `rg`, plus the applicable existing tests

The checkout is shared: do not revert unrelated edits, do not edit the FX provider/report module, migration/schema, web, Android, or CI, do not spawn subagents, and do not commit because the mapped checkout has no usable Git object database.

Every first insert must explicitly set `fx_lock_date` to the canonical transaction/accounting date where the row mapping has a clear date, or safely rely on the migration insert trigger. A pending-to-posted Plaid update, statement replay, alert confirmation/review, adjustment, or supersession must never replace an established lock date. Preserve source amount/currency/date behavior and idempotency. Do not fetch Frankfurter or reject ingestion when a provider quote is unavailable.

Add regression assertions to the existing focused tests for statement, alert, Plaid pending-to-posted, mobile import, and review/reconciliation flows as applicable. Run affected focused tests and `npm run typecheck` (use the local mirror if Vitest cannot run from the UNC-mapped working directory). Write `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-4-report.md` with files changed, commands/output, and concerns. Return only status/report path/test summary/concerns.
