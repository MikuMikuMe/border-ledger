# Capture-Scope Instrument Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the approved instrument tuple for every device capture scope and enforce exact source/account/currency/instrument authorization for device reads and alert ingestion.

**Architecture:** Add non-null `instrument_hint_kind`/`instrument_hint_value` columns to `device_source_scopes`, rebuild the table in migration 0014 so the old uniqueness key is replaced by the full scope tuple, and keep legacy rows as explicit `none`/empty values. Normalize the tuple at device-read, capture-authentication, in-memory authorization, SQL recheck, and ingestion-resolution boundaries so every layer makes the same decision.

**Tech Stack:** Cloudflare D1/SQLite SQL, TypeScript worker modules, Vitest/Miniflare focused tests, direct `tsc`/Vitest commands.

**Spec:** User request in the current chat; related design contract: `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md`.

## Global Constraints

- Modify only `worker/mobile-device-service.ts`, `worker/mobile-auth.ts`, `worker/alert-ingestion.ts`, `worker/schema.sql`, migration `0014`, and focused worker tests/fixtures required to exercise them.
- Preserve source/account/currency checks and owner/source-config revision plus compare-and-swap behavior.
- Preserve existing rows as explicit no-hint scopes during migration.
- Keep the in-memory scope check and SQL recheck on the same source/account/currency/instrument tuple.
- Use `apply_patch` for edits; do not revert unrelated shared-workspace changes.

## Review Focus

- Two approved instruments on one account and one currency must coexist and remain distinguishable in reads and writes — Task 1.
- A hinted scope must reject a different event hint even when source/account/currency match — Task 2.
- A no-hint scope must reject a hinted event unless an explicit approved mapping policy permits it; the default `none` mapping is exact, not a wildcard — Task 2.
- Legacy rows must authenticate and read back as explicit no-hint scopes after migration — Task 1.
- A stale capture context or deleted/paused scope must fail the SQL recheck even if its in-memory snapshot still contains the tuple — Task 2.

### Task 1: Persist and expose instrument-aware device scopes

**Files:**
- Create: `worker/migrations/0014-mobile-capture-scope-instrument-hints.sql`
- Modify: `worker/schema.sql`
- Modify: `worker/mobile-device-service.ts`
- Modify: focused migration/device tests and migration-list fixture support

**Interfaces:**
- Consumes: `SourceMappingInput.instrumentHint` and the existing source-account approval tuple.
- Produces: `CaptureScopeRecord.instrumentHint` and device read/source-config responses preserving each hint.

- [ ] Write failing tests for two same-account instrument mappings, read-back preservation, and legacy no-hint defaults; assert revision/CAS behavior remains unchanged.
- [ ] Run the focused device/migration tests and confirm the failures are caused by scope persistence/read collapse or the missing migration columns.
- [ ] Implement migration 0014 by rebuilding `device_source_scopes` with non-null `instrument_hint_kind` defaulting to `none`, non-null `instrument_hint_value` defaulting to `''`, and uniqueness over `(device_id, source_profile_id, account_id, currency, instrument_hint_kind, instrument_hint_value)`; copy existing rows with explicit no-hint values.
- [ ] Update `worker/schema.sql` to match the post-migration table and update device-scope writes/reads and grouping keys to persist and return the hint tuple.
- [ ] Run the focused tests and confirm both instrument mappings survive with their original hints and old rows return `instrumentHint: null`.

### Task 2: Enforce exact instrument tuple at authentication and ingestion

**Files:**
- Modify: `worker/mobile-auth.ts`
- Modify: `worker/alert-ingestion.ts`
- Modify: focused worker auth/ingestion/route tests

**Interfaces:**
- Consumes: hint-aware `CaptureScopeRecord` rows from Task 1.
- Produces: exact tuple checks for `authenticateCapture`, `assertCaptureEventScope`, event resolution, and the SQL recheck.

- [ ] Write failing tests for a matching hinted event, a wrong hinted event, a no-hint scope receiving a hint, and a context/SQL scope mismatch; assert rejected events do not create alert evidence.
- [ ] Run the focused tests and confirm the mismatch cases currently pass or resolve through the wrong approved mapping.
- [ ] Add the optional/nullable instrument tuple to `CaptureScopeRecord`, return it from capture authentication, and compare normalized hint kind/value alongside source/account/currency in both the in-memory and SQL checks.
- [ ] Make `scopesFor`/`resolveScopedEvent` select and match the persisted device hint, use the same approved mapping policy for no-hint scopes, and pass the exact event/scope hint into `assertCaptureEventScope`; retain existing currency/account/source filtering and projection behavior.
- [ ] Run focused auth/ingestion/route tests and verify matching events are accepted while mismatches are rejected before idempotency lookup or mutation.

### Task 3: Final focused verification

**Files:**
- No production files; only focused test/fixture adjustments if required by the completed implementation.

- [ ] Run direct TypeScript checking from the mapped drive.
- [ ] Run the focused worker test set with an explicit timeout that accommodates Miniflare/WebDAV startup.
- [ ] Run the full available test suite if the environment permits; report any unrelated or environment-only failures exactly.
- [ ] Inspect the final diff for scope, migration preservation, and unchanged owner/revision/CAS behavior.
