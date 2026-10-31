# Recurring planning Implementation Plan

> **For agentic workers:** Use executing-plans, with tests written and observed failing before implementation.

**Goal:** Provider-independent recurring planning, conservative matching and currency-safe projections for web and Android.
**Architecture:** Persist ledger-scoped plans in D1. Compute bounded projections from authoritative ledger transactions and freshness at read time. Publish explicitly versioned owner APIs; native bridge mirrors those contracts. Keep provider streams and FX snapshots separate.
**Tech Stack:** TypeScript, D1/Worker, React, React Native and Kotlin.
**Spec:** docs/superpowers/specs/2026-10-29-recurring-planning-design.md

## Global Constraints
- No secrets, real financial data, AI calls or production deployment. Preserve tenant isolation, source money, review status and provider data.
- Match conservatively and do not create or mutate ledger transactions.

## Review Focus
- Month end and leap-day recurrences preserve the anchor.
- Candidates cannot satisfy overlapping plans without ambiguity.
- Pending, stale and disconnected sources cannot be labelled missed.
- Cross-ledger and disallowed account currency requests fail closed.
- Forecast currency totals never mix currencies or impersonate historical FX.

### Task 1: Recurrence and matching domain
**Files:** src/domain/recurring-plans.ts; tests/recurring-plans.test.ts
**Interfaces:** `occurrences(plan, from, to)` returns bounded ISO dates; `assessOccurrences(plans, transactions, freshness, today, from, to)` returns status and candidate IDs. Types specify currency, account, direction, amount, cadence, revision and dates.
- [ ] Test anchored month-end, leap years, date bounds, exact matching, competing candidates, provisional and missing/freshness cases; run to confirm failure.
- [ ] Implement pure deterministic functions and rerun targeted tests.

### Task 2: Storage and authenticated APIs
**Files:** worker/migrations/0028-recurring-plans.sql, worker/recurring-plans.ts, worker/index.ts, worker/mobile.ts, tests/recurring-plans-api.test.ts.
**Interfaces:** ledger-scoped plan list/create/update/disable with revisions and idempotency; projection list returns bounded occurrences and evidence.
- [ ] Test tenant scope, account-currency validation, idempotency, stale revisions, matching after transaction changes, and bounded inputs before implementation.
- [ ] Implement storage and web/mobile API using existing authorization and error conventions; test migration and routes.

### Task 3: Web recurring planning
**Files:** src/components/RecurringView.tsx, focused recurring-plan components/styles, web tests.
- [ ] Test create/edit/disable, projection states, source currency and errors; implement keyboard-accessible views while preserving provider streams.

### Task 4: Android recurring planning
**Files:** Android recurring repository, DTOs and native bridge; mobile/src/native/specs and mobile/src/features/finance; corresponding tests.
- [ ] Test wire validation, revision conflicts, pending and unavailable states; implement the same owner flow and local currency display.

### Task 5: Validation and PR
- [ ] Run full test suite, typecheck, web build, Android tests and actual-size visual checks; diagnose failures.
- [ ] Run per-file CodeScene reviews, pre-commit safeguard, and change-set analysis against the PR base; address regressions.
- [ ] Review changes, commit, push branch, open PR and verify required checks before reporting success.
