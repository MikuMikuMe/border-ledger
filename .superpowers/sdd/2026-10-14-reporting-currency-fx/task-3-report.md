# Task 3 report

## Status

`DONE_WITH_CONCERNS`

Task 3 is implemented in the requested backend report/provider integration scope. No commit was created. The focused report, scheduled-handler, browser-route, and mobile-route tests pass, and TypeScript typechecking passes. The full TypeScript suite was not completed before the final interruption, so this report does not claim a clean full-suite result.

## Files changed

- `worker/ledger-reports.ts`
- `worker/index.ts`
- `worker/mobile.ts`
- `wrangler.jsonc`
- `contracts/mobile-v1.openapi.yaml`
- `tests/ledger-reports-fx.test.ts`
- `tests/fx-scheduled.test.ts`
- `tests/fx-routes.test.ts`
- `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-3-report.md`

`worker/fx-rates.ts` was inspected and its Task 1 exports were reused without modification. Task 2 migration/schema/helper files were not changed.

## Implemented behavior

- `LedgerReportQuery.reportingCurrency` is separately validated through the shared currency registry while `currency` remains the source-currency filter.
- Source-only reports perform no FX fetch and return `reportingCurrency: null`, `convertedTotals: null`, empty converted daily totals, and explicit complete/empty FX metadata.
- Targeted reports aggregate all counted canonical rows independently of Activity pagination, join account institution, use `COALESCE(fx_lock_date, date)`, resolve immutable snapshots through Task 2 helpers, and use Task 1 exact integer conversion.
- Partial conversion retains source totals, includes only convertible rows, and reports sorted unavailable source currencies.
- Same-source/target rows use exact identity conversion without requiring or fetching a provider snapshot; an outage cannot remove those rows or mark them incomplete.
- The narrow case-insensitive BOC match uses only `bank of china`, `boc`, `中国银行`, or `中國銀行`; CNY is excluded, provisional inclusion follows the report toggle, refunds retain their sign, and incomplete eligible components suppress the band.
- The daily Worker scheduled handler warms the scheduled UTC date, preserves first-write-wins snapshots, and logs only a safe error name.
- Root and production Wrangler environments use `15 6 * * *`.
- Browser and owner/mobile report routes forward and validate `reportingCurrency`; the mobile wrapper and nested report expose all additive fields.
- The mobile OpenAPI contract defines the reporting query and additive converted totals, daily totals, FX provenance, observed range, and BOC band with consistent required/additional-property rules.

## Verification

Initial RED run before Task 3 production changes:

```text
Command: cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/ledger-reports-fx.test.ts tests/fx-scheduled.test.ts tests/fx-routes.test.ts --run"
Exit code: 1
Result: Test Files 3 failed (3); Tests 11 failed (11)
Expected failures: converted report fields absent, scheduled handler absent, cron absent, and route forwarding/wrapper fields absent.
```

Initial report GREEN run:

```text
Command: cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/ledger-reports-fx.test.ts --run"
Exit code: 0
Result: Test Files 1 passed (1); Tests 6 passed (6)
```

Identity/no-provider RED run added after the edge requirement:

```text
Command: cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/ledger-reports-fx.test.ts --run"
Exit code: 1
Result: Test Files 1 failed (1); Tests 1 failed, 6 passed (7)
Expected failure: the identity-only CAD report made one unnecessary Frankfurter request.
```

Identity/no-provider GREEN run after limiting provider resolution to non-identity rows:

```text
Command: cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/ledger-reports-fx.test.ts --run"
Exit code: 0
Result: Test Files 1 passed (1); Tests 7 passed (7)
```

Final schedule and route focused run:

```text
Command: cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/fx-scheduled.test.ts tests/fx-routes.test.ts --run"
Exit code: 0
Result: Test Files 2 passed (2); Tests 5 passed (5)
```

TypeScript typecheck:

```text
Command: cmd /d /c "pushd Z:\Projects\Personal-Finance && npm run typecheck"
Exit code: 0
Output: > cross-border-spending-tracker@0.1.0 typecheck; > tsc --noEmit
```

Final focused evidence totals 3 passing files and 12 passing tests across the last report and schedule/route runs.

## Concerns

- The requested full `npm test` suite was not completed. A local-mirror sync/run was about to begin when the turn was interrupted; no full-suite result is claimed.
- The mapped checkout prints the known `CMD.EXE` UNC-current-directory warning even when `pushd Z:` succeeds. The focused tests and typecheck nevertheless completed with exit code 0 from the mapped project.
- No fresh-context/subagent review was run because the task explicitly prohibited subagents.
## Review-fix pass (2026-10-14)

### Status

DONE_WITH_CONCERNS

### Review findings addressed

- Monetary aggregation now uses `bigint` for converted totals, daily totals, counts, and BOC calculations; conversion to `number` is checked against the JavaScript safe-integer range. BOC +/-150 bps operates on exact integer magnitudes. The overflow fixture uses individually safe rows whose combined total cannot be represented safely and verifies an explicit safe failure from the D1 adapter rather than a corrupted result.
- Source SQL aggregate values are validated through the safe-integer helper before returning source totals, daily totals, counts, reviews, excluded counts, and source coverage. Source monetary OpenAPI fields have safe min/max bounds, and count fields have safe upper bounds.
- Stored snapshot `content_digest` is recomputed from the canonical `effectiveDate\n` plus `rates_json` payload before rates are trusted. Mismatches and malformed stored snapshots raise `FxSnapshotIntegrityError`; valid manually inserted fixtures use the matching digest.
- Provider degradation catches only the typed Task 1 provider transport/validation error. D1, crypto, integrity, malformed-data, and programming errors propagate through the normal route/scheduled error path.
- Browser missing-credential/disallowed-origin and mobile missing/invalid-credential/insufficient-scope authorization regressions assert 401/404/403 responses and no provider fetch.
- OpenAPI preference text now identifies `preferredCurrency` as the reporting target and says `null` keeps source-currency mode.
- The lock-date regression uses a transaction date different from `fx_lock_date` and distinct snapshots to verify the lock-date snapshot is selected.

### Exact verification commands and results

The following TDD RED checks were run before the corresponding fixes:

```text
cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/ledger-reports-fx.test.ts tests/fx-routes.test.ts --run"
```

Result: exit 1, as expected. The report test file had 6 failures because the digest helper/integrity implementation was not yet present; the route tests passed.

```text
cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/fx-scheduled.test.ts --run"
```

Result: exit 1, as expected. 1 test failed and 3 passed because the scheduled handler still swallowed the injected D1 failure.

Final focused verification:

```text
cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- tests/ledger-reports-fx.test.ts tests/fx-scheduled.test.ts tests/fx-routes.test.ts --run"
```

Result: exit 0; 3 test files passed, 17 tests passed.

```text
cmd /d /c "pushd Z:\Projects\Personal-Finance && npm run typecheck"
```

Result: exit 0; typecheck completed without errors.

Mapped-checkout full suite:

```text
cmd /d /c "pushd Z:\Projects\Personal-Finance && npm test -- --run"
```

Limitation: Vitest printed `RUN v5.0.4 Z:/Projects/Personal-Finance` and produced no further output for approximately 90 seconds. The command was stopped with Ctrl+C and reported exit 1; no full-suite result count is available. This is the known WebDAV/Miniflare stall.

Local-mirror full suite:

```text
npm test -- --run
```

Working directory: `C:\Users\aa207\AppData\Local\Temp\border-ledger-verify`.

Limitation: Vitest printed `RUN v5.0.4 C:/Users/aa207/AppData/Local/Temp/border-ledger-verify`; the command was stopped with Ctrl+C before any test result output and reported exit 1. No full-suite result count is available.

The review-fix pass changed only the Task 3 implementation/tests and this report: `worker/fx-rates.ts`, `worker/ledger-reports.ts`, `worker/index.ts`, `contracts/mobile-v1.openapi.yaml`, `tests/ledger-reports-fx.test.ts`, `tests/fx-scheduled.test.ts`, and `tests/fx-routes.test.ts`. No commit was created.

### Remaining concerns

- The focused report, schedule, and route tests plus typecheck pass.
- The full suite was attempted in both the mapped checkout and local mirror but was not completed, so the final status remains `DONE_WITH_CONCERNS`.

### Final nullable OpenAPI fix

Confirmed `Preferences.preferredCurrency` is modeled as `anyOf: [CurrencyCode, null]`, matching runtime source-currency mode. No product code changed. No tests were run for this final confirmation, per request.
