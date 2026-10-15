# Reporting Currency and Purchase-Time FX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owner-selected reporting-currency totals backed by immutable Frankfurter purchase-date observations, a truthful BOC ±1.5% settlement band, native/web parity, and app-only GitHub build triggers.

**Architecture:** Keep the Worker/D1 ledger authoritative. A cohesive Worker FX module validates and caches Frankfurter v2 daily EUR quotes, while `readLedgerReport` computes source and converted aggregates from immutable transaction lock dates using exact integer arithmetic. Web and Android render the same additive report contract; neither client calls Frankfurter or performs financial conversion.

**Tech Stack:** TypeScript, Cloudflare Worker/D1/cron, React/TypeScript/Vite, Vitest/Miniflare, Kotlin/Compose, Gradle/Android SDK/ADB, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-14-reporting-currency-fx-design.md`

## Global Constraints

- The existing `preferredCurrency` field remains the compatible preference/storage name and means the selected reporting currency.
- `currency` in report queries remains the source-currency filter; `reportingCurrency` selects conversion.
- Frankfurter requests are fixed to `https://api.frankfurter.dev/v2/rates?date=YYYY-MM-DD&base=EUR`; clients never supply provider URLs.
- The first valid provider response for a requested date is immutable; transport/malformed/empty responses do not create snapshots.
- Every transaction retains its original currency and amount; `fx_lock_date` is immutable and starts from its canonical purchase/accounting date.
- Cross-rates use the stored EUR pivot, integer arithmetic, one round-half-up at target minor-unit precision, and no persisted binary floating point.
- BOC settlement uncertainty is ±150 basis points for eligible non-CNY rows, follows the report's provisional toggle, and is omitted when its component is incomplete.
- A missing provider quote is unavailable—not zero, an invented rate, or a reason to reject the source transaction.
- App-build paths include `android/**`, `src/**`, `index.html`, `contracts/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `public/**`, and the app-build workflow; backend-only paths do not trigger it.
- No real financial notifications, statements, credentials, provider tokens, or signing material enter source control or logs.

## Review Focus

1. A report over more than 500 rows must aggregate every matching row while Activity remains paginated; the report task proves this with a full-window fixture.
2. Two reports for the same locked date after a changed provider response must return identical totals; the FX snapshot task proves first-valid-response immutability.
3. A BOC account containing both CNY and foreign-currency spending must include only eligible non-CNY rows in the dashed band and follow the provisional toggle; report tests pin both branches.
4. Unsupported/malformed/oversized Frankfurter data must leave source totals usable and label converted output partial/unavailable; provider tests pin all failure paths.
5. Android/web must never silently display a partial converted total as final; decoder/UI/browser tests pin the warning and source-currency audit trail.

---

### Task 1: Exact FX arithmetic and bounded Frankfurter client

**Files:**
- Create: `worker/fx-rates.ts`
- Test: `tests/fx-rates.test.ts`
- Modify: `worker/db-types.ts` only if a typed snapshot row is needed by the module

**Interfaces:**
- Produces `parseFrankfurterRates(payload: unknown): ValidatedFxRates`, `convertMinorUnits(input: FxConversionInput): number | null`, `fetchFrankfurterSnapshot(requestedDate: string, fetcher?: typeof fetch): Promise<FxProviderSnapshot>`, and `isSupportedFxDate(value: string): boolean`.
- `ValidatedFxRates` contains the provider effective date and a map of registered quote code to decimal-rate string. `FxConversionInput` carries amount minor units, source/target codes, and registry minor-unit metadata.
- Consumers must be able to inject a fetcher in tests and must not pass an arbitrary host/path.

- [ ] **Step 1: Write the failing tests** for valid v2 rows, EUR identity/inversion, cross-rate arithmetic, one-time target rounding, signed refunds, unknown/non-finite/negative/duplicate rates, invalid dates, fixed endpoint construction, timeout/HTTP failure, and bounded response rejection.
- [ ] **Step 2: Run `npm test -- tests/fx-rates.test.ts --run` and verify the new tests fail for missing exports/behavior.**
- [ ] **Step 3: Implement the minimal validated provider client and BigInt decimal-rational arithmetic.** Read the response with a bounded byte reader, reject malformed rows, allow only registered ISO codes, use an `AbortController` timeout, and never log provider bodies.
- [ ] **Step 4: Run the focused test file and then `npm run typecheck`; expected PASS.**
- [ ] **Step 5: Review the module against the STRIDE input-validation controls before handing it to Task 2.**

### Task 2: Immutable transaction lock date and D1 snapshot storage

**Files:**
- Create: `worker/migrations/0018-fx-snapshots.sql`
- Modify: `worker/schema.sql`, `worker/db-types.ts`
- Test: `tests/fx-snapshot-migration.test.ts`

**Interfaces:**
- Produces `fx_rate_snapshots(requested_date, effective_date, provider, rates_json, content_digest, fetched_at)` and a nullable/backfilled `transactions.fx_lock_date` with insert/backfill/immutability triggers.
- Produces `readFxSnapshot(db, requestedDate)` and `insertFxSnapshotIfAbsent(db, snapshot)` helpers with first-valid-response semantics.

- [ ] **Step 1: Write failing migration tests** using a populated pre-FX fixture: existing transactions receive `fx_lock_date = date`; source identities, Plaid IDs, recurring links, and notes survive; hand-written inserts that omit the new column receive the canonical date; changing an established lock date is rejected; snapshot update/delete is rejected.
- [ ] **Step 2: Run `npm test -- tests/fx-snapshot-migration.test.ts --run` and verify the expected schema/trigger failures.**
- [ ] **Step 3: Add the additive migration and matching bootstrap schema.** Keep the lock column nullable only for compatibility with legacy rows, enforce canonical-date backfill, index requested dates, bound JSON/digest fields, and make snapshot rows immutable.
- [ ] **Step 4: Run the focused migration test plus the existing multicurrency migration test; expected PASS with foreign keys intact.**
- [ ] **Step 5: Add typed row interfaces and keep all SQL parameterized.**

### Task 3: Worker report aggregation, periodic refresh, and route contract

**Files:**
- Modify: `worker/fx-rates.ts`, `worker/ledger-reports.ts`, `worker/index.ts`, `wrangler.jsonc`, `worker/mobile.ts`, `contracts/mobile-v1.openapi.yaml`
- Test: `tests/ledger-reports-fx.test.ts`, `tests/fx-scheduled.test.ts`, route assertions in `tests/worker-route.test.ts` or a new focused route test

**Interfaces:**
- Extend `LedgerReportQuery` with `reportingCurrency?: string | null` and `readLedgerReport(db, input, dependencies?)` with injectable FX fetch/clock dependencies.
- Add `reportingCurrency`, `convertedTotals`, `convertedDailyTotals`, and `fx` to the report response. Preserve `currency` as the source filter.
- Add `OwnerReportQuery.reportingCurrency` and pass it as a bounded query parameter in the Android/mobile route.

- [ ] **Step 1: Write failing D1/report tests** for CAD target from USD/CNY/EUR transactions, complete and partial snapshots, source totals unchanged, full-window aggregation beyond Activity's 500-row page, provider outage degradation, BOC identification, CNY exclusion, provisional inclusion, refund sign, unavailable BOC omission, and report target validation.
- [ ] **Step 2: Run the focused report tests and verify they fail because the response has no converted fields.**
- [ ] **Step 3: Implement snapshot resolution in `readLedgerReport`.** Select all counted rows with account institution and `COALESCE(fx_lock_date, date)`, resolve each distinct lock date through the immutable cache, aggregate source totals as before, compute converted totals/daily totals with Task 1, and return explicit incomplete/unavailable metadata.
- [ ] **Step 4: Implement the BOC component.** Match only normalized `bank of china`, `boc`, `中国银行`, or `中國銀行`; use the same status inclusion as the report; exclude CNY; omit the band if any eligible BOC source currency lacks a rate; return `percentageBasisPoints: 150`.
- [ ] **Step 5: Add the daily Worker `scheduled` handler and `triggers.crons` entry.** Warm today's snapshot without rewriting an existing row; retry provider failures on the next scheduled run; keep the existing fetch/queue handlers unchanged.
- [ ] **Step 6: Extend owner/mobile route validation and OpenAPI/additive DTOs.** Reject unregistered target codes, never accept provider URLs, retain authorization/origin checks, and keep omitted target in source-only mode.
- [ ] **Step 7: Run focused report/schedule/route tests and the full `npm test`; expected PASS.**

### Task 4: Ensure all canonical write paths preserve the lock date

**Files:**
- Modify: `worker/plaid.ts`, `worker/reconciliation-store.ts`, `worker/alert-ingestion.ts`, `worker/mobile-import.ts`, `worker/mobile-review.ts`, and any other production `INSERT INTO transactions`/date-update path found by `rg`
- Test: add regression cases to `tests/plaid.test.ts`, `tests/reconciliation-storage.test.ts`, `tests/alerts-ingestion.test.ts`, and `tests/mobile-import-export-task12.test.ts` as applicable

**Interfaces:**
- Every production writer either supplies `fx_lock_date = canonical transaction date` on first insert or relies on the migration insert trigger; posted/reconciled updates must never change an established lock.

- [ ] **Step 1: Add failing regression assertions** that statement, alert, Plaid pending-to-posted, mobile import, and review/reconciliation flows preserve the original lock date and do not duplicate transaction rows.
- [ ] **Step 2: Run each focused test and verify the new assertions fail on the unmodified write path.**
- [ ] **Step 3: Update only the canonical write SQL/row mapping needed to preserve the lock; do not change source amounts or transaction dates beyond existing behavior.**
- [ ] **Step 4: Run all affected focused tests and the full TypeScript suite.**

### Task 5: Web report semantics and dashed uncertainty presentation

**Files:**
- Modify: `src/App.tsx`, `src/styles.css`, `src/domain/reporting.ts` only if chart helpers need a pure conversion-aware model
- Test: `tests/overview-report.test.ts`, `tests/button-interactions.test.ts`, `tests/preferences-api-route.test.ts`, plus a new report mapping test if needed

**Interfaces:**
- `OverviewReport` maps the additive Worker report fields with safe-integer validation.
- `reportRequestPath(window, includeProvisional, timeZone, reportingCurrency)` always sends the selected target when non-null.

- [ ] **Step 1: Write failing mapping/UI tests** for a complete converted report, partial unavailable source codes, selection persistence, source lanes remaining visible, and BOC/CNY dashed-box visibility/copy.
- [ ] **Step 2: Run the focused web tests and verify failure before changing production UI.**
- [ ] **Step 3: Change Accounts & settings copy/control to “Total spending currency”; keep registered ISO options and source-preserving null option.**
- [ ] **Step 4: Make Overview use converted totals/daily totals as the primary total/chart when selected, retain source lanes/activity, and show provider lock-date provenance plus partial warnings.**
- [ ] **Step 5: Add an accessible dashed-border BOC estimate box with exact lower/upper target amounts and explicit CNY exclusion; add responsive/high-contrast CSS without relying on color alone.**
- [ ] **Step 6: Run focused tests, `npm run typecheck`, `npm run build`, and a real browser smoke that changes the reporting currency, window, and provisional toggle.**

### Task 6: Android report DTO, settings selector, and native Overview parity

**Files:**
- Create: `android/app/src/debug/java/com/lofuyu/borderledger/debug/FxReportPreviewActivity.kt` and its deterministic fixture/screen support
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/api/OwnerLedgerApi.kt`, `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerSnapshot.kt`, `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt`, `android/app/src/main/java/com/lofuyu/borderledger/ui/settings/SettingsScreen.kt`, `android/app/src/main/java/com/lofuyu/borderledger/ui/settings/ReportingPreferencesRepository.kt`, `android/app/src/debug/AndroidManifest.xml`
- Test: `android/app/src/test/java/com/lofuyu/borderledger/ui/ledger/LedgerRemoteDecoderTest.kt`, new/updated settings tests, and relevant navigation/UI model tests

**Interfaces:**
- `OwnerReportQuery.reportingCurrency: String?` is validated through `CurrencyRegistry` and serialized as `reportingCurrency`.
- `LedgerReport` adds nullable reporting target, converted totals/daily totals, and validated `ChineseBankBand(percentageBasisPoints: Int = 150)`; all monetary fields remain `Long` safe integers.

- [ ] **Step 1: Write failing Kotlin tests** for additive JSON decoding, `percentageBasisPoints == 150`, partial unavailable codes, invalid currency rejection, and report query serialization.
- [ ] **Step 2: Run `.\gradlew.bat :app:testDebugUnitTest --tests ...` and verify the new tests fail.**
- [ ] **Step 3: Implement bounded decoder fields and query serialization.** Unknown future fields remain skipped; new currency strings are registry-validated; decimal percentages are not accepted on the wire.
- [ ] **Step 4: Replace the source-only Overview lens with a reporting-target selector and converted primary total/daily totals while retaining source-currency audit cards.**
- [ ] **Step 5: Add the Compose dashed uncertainty card with a content description, partial-rate warning, and CNY exclusion text.**
- [ ] **Step 6: Add a debug-only `FX_REPORT_PREVIEW` activity/intent fixture that reuses the production total/range composables and supports `available`, `partial`, `unavailable`, and BOC/CNY cases without network or credentials.**
- [ ] **Step 7: Run all Android unit tests, lint, and unsigned release assembly.**

### Task 7: App-only GitHub build triggers

**Files:**
- Create or modify: `.github/workflows/app-build.yml`, `.github/workflows/ci.yml`, `.github/workflows/android-ci.yml`
- Test/inspection: a workflow path assertion script or `tests/workflow-paths.test.ts`

**Interfaces:**
- The app workflow runs web build/typecheck plus Android lint/unit tests for app-owned paths and `workflow_dispatch`.
- Backend-only `worker/**`, `wrangler.jsonc`, and backend-only test changes do not match the app workflow path list.

- [ ] **Step 1: Write a failing path-list test/script** with representative app and backend-only paths.
- [ ] **Step 2: Run it and verify the current workflow triggers Android/web build on backend-only changes or lacks an app path filter.**
- [ ] **Step 3: Add the exhaustive path filters and keep general backend verification separate from the app build.** Do not add signing secrets or claim a production APK.
- [ ] **Step 4: Run the path assertion and YAML/static checks; inspect the diff for least-privilege workflow permissions.**

### Task 8: Security audit, end-to-end verification, and release evidence

**Files:**
- Create: `docs/security/2026-10-14-reporting-currency-fx-stride.md`
- Modify: `docs/android-validation.md` and `README.md` with sanitized FX/provider/QA notes if needed

- [ ] **Step 1: Run the STRIDE review across browser/mobile → Worker → Frankfurter → D1/snapshot boundaries.** Cover spoofing, tampering, repudiation, information disclosure, DoS, and elevation of privilege with control, evidence, residual risk, and owner.
- [ ] **Step 2: Run fresh `npm test`, `npm run typecheck`, and `npm run build`; record exact counts/exit codes.**
- [ ] **Step 3: Run Android lint/unit/release assembly with the installed toolchain; verify the APK with `apksigner` if available, without claiming production signing.**
- [ ] **Step 4: Start the real web app and use the browser harness to select a target, verify converted total/source lanes/dashed band/partial warning, then clean up the server/browser.**
- [ ] **Step 5: Use the `android-emulator-qa` skill: install the debug APK on the connected emulator, launch the release app for real auth/settings/report behavior where the local environment permits, and launch the debug-only `FX_REPORT_PREVIEW` fixture for deterministic available/partial/BOC/CNY coverage; drive it from UI-tree coordinates, capture screenshots, inspect UI XML/content descriptions, and collect crash logcat.**
- [ ] **Step 6: Review all acceptance rows in the spec and report any unavailable production evidence (for example, protected signing secrets or provider data) explicitly rather than inferring it.**

