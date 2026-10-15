# Plaid Recurring Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, or superpowers:subagent-driven-development if the user chooses that method. Steps use checkbox syntax for tracking. This round produces the plan only.

**Goal:** Give Border Ledger trustworthy subscription and recurring-payment analysis, with supporting ledger history and clearly labeled estimates.

**Architecture:** Extend the existing Cloudflare Worker, Queue, and D1 database with durable recurring projections. The browser reads sanitized stored results; provider calls and token handling remain server-side. Actual spending, detected recurrence, and user classification have separate ownership and failure contracts.

**Tech Stack:** React 18.3.1, TypeScript 5.6.3, Vite 8.3.4, Vitest 5.0.4, Wrangler 4.149.0, D1/SQLite, Queues, Cloudflare Access, and Plaid Transactions plus its Recurring add-on.

**Spec:** [Proposed design](../specs/2026-10-13-plaid-recurring-analysis-design.md). The design contains the architecture alternatives, C4 container view, ownership, failure behavior, baseline evidence, and proposed product choices.

## Global Constraints

- Planning only in this round: no product implementation, deployment, bank authorization, Item recreation, or credential changes.
- Preserve the established stack, selected-account filtering, encrypted tokens, signed webhooks, same-origin mutation checks, Access authentication, and API no-store policy.
- CAD and CNY stay separate. Store signed integer minor units; preserve provider calendar dates.
- Default reporting timezone is America/Toronto; support the existing Asia/Shanghai and Monday/Sunday settings.
- New Items request transactions.days_requested: 730. Existing Items keep their lookback; do not automatically remove/recreate them.
- Actual spending comes from posted ledger transactions; estimates never create ledger rows or increase confirmed spending.
- Classification values: unclassified, subscription, bill, other, excluded. Recurring detection alone does not classify a subscription.
- Default list page size 50; maximum 100. Summary aggregation must not use the browser's 500-row ledger limit.
- Stale means a failed refresh or more than 24 hours since the last successful check; show the last successful data with that state.
- Next expected payments covers today through today plus 29 calendar days inclusive, with one predicted next payment per stream.
- Recurring provider request timeout: 30 seconds. Queue max_retries: 5, meaning the initial delivery plus at most five retries.
- Sandbox and production must use separate D1 databases, queues, dead-letter queues, and secrets before real-bank rollout.
- The WebDAV workspace has no Git metadata. At execution time use a normal local checkout for branch/commit work, or the verified isolated-snapshot method for checks. Never initialize a replacement repository in the mirror merely to satisfy a commit step.

## Review Focus

1. Pending removal plus posted addition, followed by a modification without pending_transaction_id: one posted record survives and joins the stream. Task 2 owns this test.
2. Empty, malformed, timestamp-less, or insufficient provider history: preserve last-good data and distinguish waiting, limited coverage, and a valid empty result. Tasks 3 and 4 own these tests.
3. New demand, account-scope change, or disconnect arriving during a provider request: no lost demand and no unauthorized publication. Task 4 owns these tests.
4. Annual amounts, leap days, DST, and timezone midnight: integer estimates and provider dates remain explainable. Tasks 1 and 5 own these tests.
5. Salary, transfers, credit-card repayments, refunds, and repeated membership across streams: no inflated outgoing totals or duplicated actual spending. Task 5 owns these tests.

## Baseline already checked

On 2026-10-13, the deployed Chrome session opened the public page and private workspace; all four current surfaces responded, and Plaid Link launched in Sandbox mode. After hydration, Transactions had zero records and both visible accounts were import-only. No Item was connected, so full ingestion and recurring entitlement remain rollout evidence to gather.

Current-source verification passed in a temporary copy using dependencies with an identical lockfile: 36/36 tests in 11 files, TypeScript check, and Vite production build. JSDOM logged its navigation limitation; the live browser check covered workspace navigation. Direct npm execution in the WebDAV checkout is blocked by the Windows UNC working-directory behavior and missing executable, rather than a demonstrated product-test failure.

## File and module boundaries

| Responsibility | Planned files |
|---|---|
| Live reporting clock and initial-data states | src/domain/reporting.ts; src/App.tsx |
| Provider transaction identity and additive schema | worker/plaid.ts; worker/index.ts; worker/schema.sql; worker/migrations/0000-ledger-base.sql; worker/migrations/0002-recurring.sql |
| Shared D1 interfaces and real local D1 test fixture | worker/db-types.ts; tests/helpers/d1.ts |
| Provider recurring response types and validation | worker/plaid-recurring.ts |
| Projection publication and database reads | worker/recurring-store.ts |
| Shared recurring DTOs and estimate rules | src/domain/recurring.ts |
| Routes, webhook dispatch, Queue orchestration, disconnect | worker/index.ts; worker/validation.ts; worker/security.ts |
| Recurring UI and details | src/components/RecurringView.tsx; src/components/RecurringDetails.tsx; src/App.tsx; src/styles.css |
| Integration fixtures, tests, rollout, operations | tests/fixtures/recurring/*; tests/*recurring*.test.ts; wrangler.jsonc; package.json; package-lock.json; .github/workflows/ci.yml; README.md |

Keep the existing Plaid transport in worker/index.ts; pass its typed fetch callback into recurring orchestration rather than introducing another credential implementation.

## Task 1: Make the live reporting foundation trustworthy

**Owner:** Frontend/domain implementer.

**Files:** Create src/domain/reporting.ts and tests/reporting.test.ts. Modify src/App.tsx, tests/button-interactions.test.ts, tests/account-card.test.ts, tests/mobile-navigation.test.ts, tests/landing-page.test.ts, and tests/ledger.test.ts where explicit API fixtures or dynamic windows change expectations. Add tests/workspace-loading.test.ts.

**Interfaces:** Produce getReportWindows(now: Date, timezone: 'America/Toronto' | 'Asia/Shanghai', weekStartsOn: 'monday' | 'sunday'): ReportWindow[]. Lift reporting settings into WorkspaceApp so reporting and recurring analysis use the same calendar. Workspace reads use explicit loading, loaded, and error states; an empty successful response is distinct from an inaccessible API.

- [ ] Write failing tests proving that 2026-10-13T16:00:00Z produces Toronto today 2026-10-13, Monday week start 2026-10-12, and month start 2026-10-01. At 2026-10-13T03:30:00Z, Toronto today is 2026-10-12 and Shanghai today is 2026-10-13. Cover Sunday start and a DST boundary.
- [ ] Add slow/error/empty API tests: private workspace never presents demo transactions as live; failed reads show a retry action; valid empty reads show zero actual records. Existing workspace interaction tests must supply explicit test-only API responses rather than depending on an implicit demo fallback. Public landing examples remain labeled representative.
- [ ] Run npm test -- tests/reporting.test.ts tests/workspace-loading.test.ts and confirm the new behaviors fail before implementation.
- [ ] Implement dynamic windows and refresh them on date rollover/focus. Derive the reporting date and sync-age labels. Compute the chart/review indicators from live data or suppress unsupported placeholder values, including the static percentages observed in the smoke test.
- [ ] Run the targeted tests and npm run typecheck. Expected: all targeted tests pass and TypeScript exits 0. Create a focused commit in the execution checkout.

## Task 2: Preserve source identity and introduce the projection schema

**Owner:** Backend/data implementer.

**Files:** Modify worker/plaid.ts, worker/index.ts, worker/schema.sql, wrangler.jsonc, package.json, package-lock.json, and .github/workflows/ci.yml. Create worker/db-types.ts, worker/migrations/0000-ledger-base.sql, worker/migrations/0002-recurring.sql, tests/helpers/d1.ts, and tests/recurring-storage.test.ts. Extend tests/plaid.test.ts and tests/worker-route.test.ts.

**Interfaces:** Export D1Database, D1Statement, and D1Result from worker/db-types.ts without changing their existing semantics. Produce createD1Fixture(): Promise<{ db: D1Database; dispose(): Promise<void> }> backed by actual local Miniflare D1. mapPlaidTransaction continues producing the existing ledger identity, with current provider, pending provider, and Item identity retained for storage.

- [ ] Promote the already locked miniflare 5.20261006.1-alpha to an explicit dev dependency for the local D1 fixture, without changing its version. Match CI to Node 24, the major used in baseline verification. The fixture must exercise real SQL and D1 batch rollback, rather than checking SQL strings in a fake database. [Cloudflare D1 test support](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/)
- [ ] Write failing tests: pending P followed by posted T with pending P and removed P leaves one confirmed row; later modified T without a pending ID updates that row; removing current T removes it. Assert that raw T resolves recurring history even though the local row ID remains stable.
- [ ] Write migration tests starting with an existing ledger: accounts, amounts, dates, notes, and local IDs survive. A tracked second migration application is skipped. A fresh chain of 0000, 0001, and 0002 yields the same current schema.
- [ ] Run npm test -- tests/plaid.test.ts tests/recurring-storage.test.ts and confirm the missing identity/schema behaviors fail.
- [ ] Implement current-provider-ID matching and safe upserts/removals. Add the three provider identity columns and a unique Item/current-ID index. Backfill only proven IDs; leave ambiguous legacy membership unresolved and visible rather than guessing a match.
- [ ] Add recurring_streams, recurring_stream_transactions, recurring_classifications, and recurring_sync_state. Include unique Item/stream identity, source fields, latest-snapshot presence, requested/completed generations, source/check times, last error, history metadata, and Item lifecycle/scope version. Classification writes remain separate from provider projection writes. Add selective account/predicted-date and provider-ID join indexes.
- [ ] Add a harmless CREATE IF NOT EXISTS baseline migration for the original ledger tables before existing migration 0001. Set migrations_dir to worker/migrations for both D1 bindings. Treat worker/schema.sql as the current schema reference; execution uses tracked migrations, not schema.sql followed by duplicate ALTER statements.
- [ ] Run the targeted tests and npm run typecheck. Expected: preservation, identity, fresh bootstrap, repeat tracked application, and SQL rollback tests pass. Commit the independently testable data foundation.

## Task 3: Translate Plaid recurring data into a validated snapshot

**Owner:** Backend/domain implementer.

**Files:** Create worker/plaid-recurring.ts, the shared types in src/domain/recurring.ts, tests/plaid-recurring.test.ts, and sanitized deterministic fixtures under tests/fixtures/recurring/. Modify buildPlaidLinkTokenPayload in worker/index.ts and its tests.

**Interfaces:** Produce PlaidRecurringResponse and NormalizedRecurringSnapshot in worker/plaid-recurring.ts. Produce normalizeRecurringSnapshot(response: PlaidRecurringResponse, itemId: string, accountMappings: ReadonlyMap<string, string>): NormalizedRecurringSnapshot. Shared DTOs are RecurringStream, RecurringFrequency, RecurringClassification, RecurringQuery, RecurringSummaryQuery, RecurringPage, RecurringDetailPage, RecurringEstimateSummary, and RecurringSummary. Preserve nullable source time until the orchestration readiness check.

- [ ] Write failing tests for selected CAD and CNY accounts, signed minor-unit conversion, inflow versus outflow, all source status/frequency values, nullable merchant and predicted date, missing source timestamp, membership IDs, malformed amounts/dates, and incompatible currencies. A CAD outflow average of 12.34 maps to -1234; an inflow amount of -1200 maps to +120000.
- [ ] Add a Link-payload assertion for products: ['transactions'] and transactions: { days_requested: 730 }; keep Canadian country and selected account-type constraints.
- [ ] Run npm test -- tests/plaid-recurring.test.ts tests/plaid.test.ts and confirm the new assertions fail.
- [ ] Implement whole-response structural validation, safe-integer amounts, source category/version retention, and both request-side and response-side approved-account filtering. Unsupported currency contributes a coverage warning; malformed supported data prevents publication. Never save raw response bodies, access tokens, or private bank details in fixtures or logs.
- [ ] Run the targeted tests and npm run typecheck. Expected: valid snapshots normalize; unsupported/unapproved data cannot enter totals; invalid snapshots have a specific safe failure. Commit the provider adapter.

## Task 4: Refresh and publish recurring data durably

**Owner:** Backend/data implementer.

**Files:** Create worker/recurring-store.ts and tests/recurring-sync.test.ts. Modify worker/index.ts, worker/validation.ts, tests/worker-route.test.ts, and relevant webhook-security tests.

**Interfaces:** Produce publishRecurringSnapshot(db: D1Database, itemId: string, generation: number, scopeVersion: number, snapshot: NormalizedRecurringSnapshot, checkedAt: string): Promise<'published' | 'superseded' | 'disconnected'>. Extend the Queue command union with plaid-recurring-sync while preserving plaid-sync. Recurring fetch consumes the existing server transport callback and the current approved provider account IDs.

- [ ] Write failing tests for historical completion triggering the first snapshot; recurring update webhook triggering a recurring refresh; unrelated/wrong-environment/unknown-Item events doing no work; and existing queued plaid-sync commands remaining compatible.
- [ ] Use the real D1 fixture to assert one snapshot after duplicate delivery, preserved classifications, complete membership replacement, valid empty snapshots, and rollback of every projection/success field after an injected failing batch statement.
- [ ] Test a new requested generation during a delayed provider call: completing generation N leaves N+1 pending. Test older source timestamps, equal source timestamps with newer demand, missing source time, failed enqueue, the 30-second aborted request, retry exhaustion after five retries, and separate transaction-versus-recurring success.
- [ ] Test disconnect/scope-change races with a paused provider call: no publication after the lifecycle/scope fence changes. Test remote revoke success plus local cleanup failure: the connection stays disconnecting, token remains protected for repair, and no queue work reactivates it.
- [ ] Run npm test -- tests/recurring-sync.test.ts tests/worker-route.test.ts and confirm the new scenarios fail.
- [ ] Implement persistent history completion and requested/completed generations. Publish all projection fields and success metadata in one guarded D1 batch. Already completed demand is a no-op; demand that arrives during a fetch survives. Fetch only approved accounts. Handle absent/disconnecting Items as terminal no-ops.
- [ ] Preserve last-good data on provider errors; classify product-unavailable/login-required as actionable terminal states and transient/not-ready cases as bounded retries. Enqueue failures leave demand durable and return a failure so webhook/manual callers can retry. Manual all-data refresh and operator dead-letter replay provide recovery; do not add a background scheduler in this slice.
- [ ] Implement the disconnecting fence before remote revocation, then guarded local cleanup after confirmation. Document the operator-verification path for ambiguous remote success followed by unavailable storage; never infer revocation from a generic error or restore an active state automatically.
- [ ] Run the targeted tests and npm run typecheck. Expected: all ordering, privacy, atomicity, retry, and partial-failure scenarios pass. Commit the asynchronous integration.

## Task 5: Provide complete analysis through private APIs

**Owner:** Domain/API/data implementer.

**Files:** Complete src/domain/recurring.ts and worker/recurring-store.ts. Modify worker/index.ts, worker/validation.ts, and worker/security.ts. Create tests/recurring-domain.test.ts and tests/recurring-api.test.ts.

**Interfaces:** Produce equivalentMinor(amountMinor: number, frequency: RecurringFrequency, period: 'month' | 'year'): number | null and analyzeRecurring(streams: readonly RecurringStream[], today: string): RecurringEstimateSummary. Repository methods are readRecurringPage(db: D1Database, query: RecurringQuery): Promise<RecurringPage>, readRecurringDetail(db: D1Database, id: string, cursor?: string): Promise<RecurringDetailPage | null>, readRecurringSummary(db: D1Database, query: RecurringSummaryQuery): Promise<RecurringSummary>, and setRecurringClassification(db: D1Database, id: string, classification: RecurringClassification): Promise<boolean>. RecurringSummaryQuery includes validated startDate/endDate, server-derived today in the allowed timezone, and matching list filters. RecurringSummary adds actual cost and coverage to the pure estimate result.

- [ ] Write failing domain assertions, including:

  ```ts
  expect(equivalentMinor(-1200, 'WEEKLY', 'month')).toBe(-5200);
  expect(equivalentMinor(-2000, 'BIWEEKLY', 'month')).toBe(-4333);
  expect(equivalentMinor(-2000, 'BIWEEKLY', 'year')).toBe(-52000);
  expect(equivalentMinor(-12000, 'ANNUALLY', 'month')).toBe(-1000);
  expect(equivalentMinor(-1200, 'UNKNOWN', 'month')).toBeNull();
  ```

- [ ] Test average amounts for commitment equivalents and last amounts for next-payment estimates. Test today/day-29/day-30 boundaries, missing/past prediction, month end, leap day, early/inactive/tombstoned streams, salary, transfer/credit-card payment, refund, and unresolved history. User-excluded streams never count; subscription subtotal requires user classification. A stale last-good result remains labeled stale. Latest-payment differences require two resolved distinct dated expense/fee members in the same currency; a snapshot replay cannot produce a new difference.
- [ ] Test actual cost using distinct linked posted ledger rows and membership-linked refunds: the same transaction in two streams counts once, transfers do not count, and a refund-dominated net cost can be negative. Estimates leave ledger row count and confirmed spending unchanged.
- [ ] Test Access and same-origin protection, invalid query/classification bodies, unknown IDs, safe DTOs, stable 50/100 pagination, and complete summary aggregation with more than 500 ledger records. Include observed-history metadata without claiming continuous or fully requested coverage.
- [ ] Run npm test -- tests/recurring-domain.test.ts tests/recurring-api.test.ts and confirm the expected gaps fail.
- [ ] Implement the four recurring routes from the spec and add PATCH to the allowed-method contract where needed. Extend POST /api/plaid/sync with optional transactions/recurring/all scope, defaulting to all while preserving its existing fields. GET reads never call Plaid or enqueue work.
- [ ] Aggregate over the database's full qualifying set; use provider ID joins and distinct ledger IDs for actual spending. Validate calendar strings and currencies. Run SQLite EXPLAIN QUERY PLAN on the list/history paths and record whether the intended indexes are used, without importing PostgreSQL-specific syntax.
- [ ] Run targeted tests, npm run typecheck, and the existing Worker security tests. Expected: complete, private, currency-separated results with tested inclusion rules. Commit the API/domain slice.

## Task 6: Add the recurring analysis experience

**Owner:** Frontend implementer.

**Files:** Create src/components/RecurringView.tsx, src/components/RecurringDetails.tsx, and tests/recurring-view.test.ts. Modify src/App.tsx, src/styles.css, tests/mobile-navigation.test.ts, and src/domain/api.ts only if typed response support needs it.

**Interfaces:** RecurringView reads RecurringPage/RecurringSummary via ledgerApi and offers account, currency, and classification filters. RecurringDetails reads RecurringDetailPage and saves a validated classification. Both consume the shared reporting date from Task 1; neither recalculates financial summaries from a truncated browser ledger.

- [ ] Write failing interaction tests for loading, no connected feed, waiting history, valid empty data, stale/error, product unavailable, unsupported/incomplete coverage, and classification persistence after refresh. Assert that forecast copy never appears as confirmed spending or automatic merchant cancellation.
- [ ] Test stream inspection, history pagination, keyboard activation/focus return, filter reset, CAD/CNY separation, and navigation at a phone width after adding the fifth view.
- [ ] Run npm test -- tests/recurring-view.test.ts tests/mobile-navigation.test.ts and confirm the new behavior fails.
- [ ] Add Recurring navigation, monthly/yearly commitment rows, subscription subtotal, next expected payment list, latest-payment changes, and source-status/detail presentation. Unclassified recurrence stays reviewable; classification changes are local ledger preferences. Show the provider/source and checked timestamps plus clear inclusion/exclusion reasons.
- [ ] Reuse the existing typography, ruled panels, spacing, textual status labels, and responsive patterns. Keep recurring components separate from the already large App.tsx. Expose a retry/refresh action for recoverable states and a clear next step for an unavailable product or disconnect repair.
- [ ] Run targeted tests, npm run typecheck, and npm run build. Verify keyboard use and desktop/phone layouts in Chrome using synthetic data. Expected: readable summaries, reliable state transitions, no clipped navigation, and accurate labels. Commit the UI slice.

## Task 7: Prove the Sandbox flow and prepare controlled rollout

**Owner:** Platform/backend implementer, with the user owning deployment selection.

**Files:** Modify wrangler.jsonc and README.md. Add a synthetic Sandbox custom-user configuration under tests/fixtures/recurring/ and a runbook under docs/. Expand integration tests only when the full-flow exercise exposes a missing contract.

- [ ] Configure the recurring feature gate, initially disabled for production, plus distinct production D1, Queue, and dead-letter Queue bindings. Keep the default Sandbox and production tokens separate. Keep the current Queue serialization and bounded retry policy; document replay and reconnect guidance.
- [ ] Apply the tracked migration chain to local D1 and exercise an existing-database upgrade. Verify schema/reference alignment and preserve a schema-compatible previous Worker as the rollback target. Disabling the recurring gate must leave transaction synchronization usable.
- [ ] In Sandbox Studio, use user_transactions_dynamic for provider behavior. Also save a compact custom CAD user with recurring monthly subscriptions, variable bills, an inflow, a transfer/credit-card repayment, an early candidate, and two annual instances across the requested history. Provider detection is an integration test; deterministic fixtures from Tasks 3-5 remain the exact numeric oracle. Studio configuration does not substitute for the application's Link payload. [Sandbox Studio](https://plaid.com/docs/sandbox/studio/)
- [ ] After implementation, run the actual application path: authenticated Link with only intended test accounts selected; exchange; initial/historical sync; recurring snapshot; private API list/summary/detail; classification; repeated webhook; refresh/retry; disconnect. Use the documented Sandbox recurring webhook trigger and inspect Queue/D1 state. [Sandbox webhook API](https://plaid.com/docs/api/sandbox/#sandboxitemfire_webhook)
- [ ] Compare provider stream IDs, amounts, dates, and approved accounts to the persisted projection and UI. Verify one posted record after pending replacement, no replay duplication, stale last-good data under a forced provider error, durable pending demand after enqueue failure, and no resurrection after disconnect.
- [ ] Run npm run typecheck, npm test, and npm run build once after the final changes. Expected: all required checks exit 0. Repeat only if a change or unresolved failure warrants it.
- [ ] Record Chrome desktop/phone evidence and the full-flow outcome. Confirm that source tokens, private payloads, and sensitive records are absent from browser storage, logs, and artifacts. Enable the Sandbox feature only after this evidence is complete; a real-bank rollout additionally requires verified production entitlement and isolated bindings.
- [ ] Commit the runbook/configuration slice. Present the concrete reviewed deployment result for the later deployment decision; do not deploy during this planning round.

## Completion criteria and review result

The feature is ready for rollout when the baseline trust issues are corrected, provider identity supports recurring history, snapshots are private and recoverable, replay/race/failure scenarios pass against actual local D1, forecasts are separate from actual spending, the full Sandbox path is demonstrated, and the final quality gates pass. Entitlement or insufficient provider coverage must produce an explicit state rather than fabricated subscriptions.

The fresh builder review raised five material questions. The design resolves them with generation/scope fences, a disconnecting repair state, manual/DLQ recovery for this release, observed-history metadata, and explicit average-versus-last amount selection. These are proposed choices, not user-approved implementation decisions. Self-review must check spec coverage, interface/type consistency, the five Review Focus cases, and task scope before execution. No product code has been changed in this round.
