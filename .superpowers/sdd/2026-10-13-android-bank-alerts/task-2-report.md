# Task 2 report — remaining review-blocker fixes

Status: **DONE_WITH_CONCERNS**. The two remaining Task 2 fixes are implemented and directly smoke-verified. No Git commit was created; `git` reports `fatal: not a git repository` on this WebDAV mount. Vitest remains blocked before collection by the incomplete mounted dependency tree, so no Vitest behavior pass is claimed.

## Fixes

- `validLifecycleEndpoint` now reuses the strict live `resolveEventTime` path. An impossible timestamp such as `2026-02-30T04:00:00.000Z` invalidates the cancellation before it can void the purchase or classify the reversal as non-spending.
- Confirmation supersession now requires exactly one valid `confirms` link and exactly one unique compatible canonical target. Two valid links/targets remain `needs_review` with `awaiting_bank_credit`.
- Existing one-confirm supersession and earlier cancellation safeguards remain intact: valid partial cancellation counts 7,000 minor units, valid full cancellation voids the purchase and keeps the reversal non-spending, and over-cancellation remains reviewable.
- Existing strict Gregorian live/historical time handling and other Task 2 behavior are unchanged.

## TDD and verification evidence

1. RED timestamp smoke: before the endpoint gate, the malformed reversal produced `voided` for the purchase and `non_spending` for the reversal; the new regression requires both `needs_review`.
2. GREEN timestamp smoke: the same compiled-domain assertion exited 0 with `needs_review/needs_review` and `invalid_cancellation`.
3. RED confirmation smoke: before the cardinality check, two individually valid confirmation links produced `superseded`; the new regression requires `needs_review`.
4. GREEN confirmation smoke: two valid targets produced `needs_review`, while one valid target preserved `superseded`.
5. Final isolated compiled-domain smoke exited 0 for invalid timestamp, partial/full/over-cancellation, two confirmations, and one confirmation.
6. Direct TypeScript: `node node_modules/typescript/lib/tsc.js --noEmit --pretty false` exited 0 with no TypeScript diagnostics. The shell emitted only the existing `InitializeDefaultDrives` warning.
7. Focused Vitest: `node node_modules/vitest/vitest.mjs run tests/alerts-domain.test.ts` exited 1 before collection because `node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs` is missing, imported by `node_modules/vitest/node_modules/@vitest/mocker/dist/chunk-hoistMocks.js`. No assertions ran.
8. Full Vitest: `node node_modules/vitest/vitest.mjs run` hit the same pre-collection missing-module error; the project suite could not execute.

## Files changed in this follow-up

- `src/domain/bank-alerts.ts`
- `tests/alerts-domain.test.ts`
- `.superpowers/sdd/2026-10-13-android-bank-alerts/task-2-report.md`

No `alert-lifecycle.ts`, Task 3, Android, Worker, UI, or unrelated files were edited in this follow-up. The temporary compiled smoke directory was removed after verification.
