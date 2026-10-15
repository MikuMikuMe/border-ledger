# Task 2 — Define currency, event, lifecycle and time behavior with tests

## Scope

Implement the shared TypeScript contract/domain slice for the Android bank-alert design. Preserve existing CAD/CNY callers while removing fixed two-currency assumptions where the new behavior requires it.

## Files

Create or modify the plan’s shared contract/domain files as needed: `contracts/mobile-v1.openapi.yaml`, `contracts/currencies.json`, `src/domain/currencies.ts`, `src/domain/bank-alerts.ts`, `src/domain/alert-lifecycle.ts`; compatible updates to `src/domain/types.ts`, `format.ts`, `ledger.ts`, `reporting.ts`, `imports.ts`, `export.ts`, `recurring.ts`; add `tests/currencies.test.ts`, `tests/alerts-domain.test.ts`, and `tests/alerts-time.test.ts`.

Do not implement Worker persistence, mobile routes, Android code, auth, or UI in this task.

## Required contracts

- `getCurrencyMeta(code: string): { code: CurrencyCode; minorUnitDigits: number } | null`.
- `parseMoneyMinor(value: string, currency: CurrencyCode): number`; reject invalid scale and unsafe integer overflow.
- `BankAlertEventInput`: `schemaVersion: 1`, immutable `eventId`, `observationId`, approved `sourceProfileId`, `parserVersion`, `notificationPostedAt`, `capturedAt`, `eventTimeBasis`, `eventType`, `direction`, optional `instrumentHint`, `eventMoney: Money | null`, `primaryMoneyRole`, `amounts: MoneyComponent[]`, `feeTreatment`, optional `bankReference`, `bankDisplayedTime`, optional merchant, and completeness.
- Event types: `purchase_notice`, `authorization_reversal`, `declined`, `refund_notice`, `hold_notice`, `adjustment_notice`, `repayment_notice`, `transfer_notice`, `fee_notice`, `unknown`.
- `deriveAlertProjection(event: BankAlertEventInput, mapping: InstrumentMapping | null, links: AlertLink[]): AlertProjectionResult`; no automatic confirmed state.
- `reportingDateForInstant(instant: string, zone: string): string`.
- `resolveEventTime(input: EventTimeInput): ResolvedEventTime`; live mode uses the original notification time and explicitly reports basis/precision.

## Behavioral requirements (tests first)

Write a minimal failing test, run it and record the expected RED failure before each production behavior, then implement the smallest passing change and run the focused test plus the full project suite when the task is complete.

- CAD/CNY/USD/HKD coexist. A registered extra currency works without a new UI branch. Unknown symbol/code is unresolved/review. Support injected zero- and three-decimal registry metadata. Reject invalid scale and unsafe integer bounds.
- `declined` => zero spending; orphan reversal => zero plus review; full linked unposted cancellation => zero/voided; original 10,000 minor units minus verified same-currency partial cancellation 3,000 => one provisional 7,000; over-cancellation or cross-currency cancellation => review, never negative.
- An unrelated successful purchase survives a same-amount failure. Holds do not sum with completion. Confirmed partial refunds count once. Two distinct equal purchases survive.
- Exact Toronto time vectors: `2026-10-13T04:00:00.000Z` => `2026-10-13 00:00`; `2026-10-13T03:59:59.999Z` => `2026-10-12 23:59:59.999`; `2026-11-02T05:00:00.000Z` => `2026-11-02 00:00`. Original midnight remains original midnight despite callback/reconnect at 09:00. Bank-displayed date/time never replaces live notification reporting day. Later statement posting retains known live occurrence time.
- Missing-year live data derives year from the original notification instant; historical pasted/bundled material without an individual timestamp remains date/duplicate review and contributes zero. Do not borrow summary-update, callback, reconnect, or bank wall time.
- Money components preserve transaction/authorization/billing/fee roles; balances and available limits are not components; included fees cannot create a second expense; no FX estimate establishes equivalence; `possible_duplicate` has no automatic financial effect.
- Preserve existing public behavior for current domain/tests unless the new contract explicitly supersedes a fixed two-currency restriction. Existing `Transaction` fields/result shapes should remain source-compatible.

## Authority/constraints

Use the approved spec at `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md` as authority. Ledger is fixed to `personal`; device scope and confirmation are server-owned. Raw notification/chat text must not enter the DTO. `Money` null is not zero. Report default timezone is `America/Toronto`, Monday week start. No secrets/private fixtures.

## Environment

The project lives on a WebDAV mount. npm child commands currently fail because the UNC working directory falls back in `cmd.exe`, and the pre-existing `node_modules` is incomplete. Try direct toolchain invocation or a safe local workaround; do not alter production data. Record exact verification limitations rather than claiming green tests.

## Report

Write the full report to `.superpowers/sdd/2026-10-13-android-bank-alerts/task-2-report.md`, including TDD RED/GREEN commands and outputs, full-suite result or environment blocker, files changed, and concerns. No Git commit can currently be created; do not claim one. Return under 15 lines with status, commit-unavailable note, one-line tests, concerns, and report path.
