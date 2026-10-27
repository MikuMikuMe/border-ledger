Implementation status: Tasks 1-4 are implemented and independently reviewed. Task 5 release tooling and synthetic rehearsal are implemented; final whole-branch validation/review and commit are recorded separately. Production rollout is not executed. See [the rollout runbook](../../hosted-users-rollout.md).

# Closed-registration hosted users implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task with independent reviews.

**Goal:** Isolate hosted users and their financial data, support each user's Lunch Flow connection, and keep registration disabled while preserving the owner's data.
**Architecture:** Verified identities resolve to provisioned users and owned ledgers. Explicit ledger contexts scope every data access and background operation; provider credentials belong to connections. Existing personal data remains assigned to the owner.
**Tech Stack:** TypeScript, Cloudflare Workers/D1/Queues, React, Android Kotlin, Vitest.
**Spec:** docs/superpowers/specs/2026-10-24-closed-registration-multi-user-design.md

## Global Constraints
- Public registration must remain disabled.
- No production data mutation or Access-policy broadening during implementation.
- Preserve the existing personal ledger ID and all historical financial records.
- Unknown identities never create users, ledgers, sessions or connections.
- Never fall back to the existing owner's Lunch Flow API key for another user.
- No secret values in clients, logs, exports, repository or reports.
- Keep Android tooling, caches and testing on D:; do not commit local configuration.
- Run per-file CodeScene reviews, pre-commit safeguard, and base-ref change-set gate before readiness claims.
- Work in D:/Projects/border-ledger-production as explicitly requested; preserve unrelated untracked Android files.

## Review Focus
1. Two users using identical external IDs and idempotency keys remain isolated (Tasks 2 and 3).
2. Disabled user, revoked session and stale queue deliveries cannot publish data (Tasks 2 and 3).
3. Owner-data migration preserves counts, balances, relationships and imported history (Task 1).
4. Callback/session swaps and logout races cannot attach or display another user's data (Tasks 3 and 4).
5. Every legacy authorization or unscoped database path fails closed rather than bypassing isolation (Task 2).

## Task 1: Schema ownership and closed user identity foundations
**Files:** Create worker/tenant-context.ts, worker/migrations/0021-hosted-users.sql, tests/tenant-context.test.ts, tests/hosted-users-migration.test.ts; modify worker/schema.sql and worker/db-types.ts. Existing verified URL fix is included as baseline task work.
**Interfaces:** Export LedgerContext { userId: string; ledgerId: string }; resolveLedgerContext(db: D1Database, identity: {issuer:string; subject:string}): Promise<LedgerContext> which rejects unknown/disabled identities. Export an explicit, idempotent owner-provisioning function accepting verified owner identity bindings; never auto-enroll from HTTP requests. LedgerId becomes string.
- [ ] Write failing tests for known, unknown and disabled identities, and owner provisioning refusing takeover or inconsistent mappings.
- [ ] Write migration tests starting from existing schema/migrations with representative owner data. Assert old row IDs, counts, amount totals, FK relationships and personal ledger survive unchanged; a second user can have a different ledger.
- [ ] Add users and identity mappings, ledger ownership and ledger ownership columns/constraints for financial roots currently missing them. Preserve personal defaults only as transitional compatibility; Task 2 removes implicit runtime context. Do not reset/drop financial data. Identity seed is explicit operator tooling, never first-login registration.
- [ ] Match worker/schema.sql to migrated schema and document exact tables/columns in the report for Task 2. Add composite ownership constraints/triggers as needed; remove single-person-only constraints where they block safe multi-user data.
- [ ] Run focused tests (npm test -- tests/tenant-context.test.ts tests/hosted-users-migration.test.ts), typecheck and CodeScene checks. Full suite before task commit. Commit only owned task files and report results.

## Task 2: End-to-end ledger isolation and registration-closed authentication
**Files:** worker/index.ts, worker/mobile*.ts, worker/*-store.ts, worker/*-service.ts, worker/owner-ledger-snapshot.ts, worker/ledger-reports.ts, worker/alert-ingestion.ts, worker/device-pairing.ts, worker/db-types.ts; authentication/route/migration test fixtures and new tests/tenant-isolation.test.ts. Additional migrations if required to preserve provider identities safely.
**Interfaces:** Consume LedgerContext and resolveLedgerContext from Task 1. All financial service/store entry points require a trusted context (explicit argument or immutable context-bound repository); no SQL string rewriting or mutable global context. Native credentials and jobs carry userId/ledgerId and connection identity. DB reads remain explicitly scoped by ledger predicates and relationship checks.
- [ ] Inventory every route, SQL store, queue, cron, webhook, cache, global API-key consumer and hardcoded personal reference; save checklist in the task report.
- [ ] Write failing two-user adversarial tests for accounts, transactions, imports/exports, reports, recurring, devices/capture, annotations/reconciliation, operations/replays and jobs. Unknown login and disabled user must fail without provisioning; test guessed IDs and same external IDs.
- [ ] Resolve verified web identity through provisioned mapping. Bind mobile authorization, access/refresh/replay/pairing/capture to the context. Unknown identities cannot register through any endpoint. Remove global ledger-key access to user data or replace necessary consumers with scoped service identity; keep health independent.
- [ ] Thread trusted context through all financial paths, scope all queries and mutation preconditions, composite references and dedup identities. Cron enumerates active tenant connections; queues revalidate active user/connection/revision before fetch and publish; legacy payloads cannot select an arbitrary tenant.
- [ ] Ensure existing personal data continues working through explicit owner context. Never broaden production Access policy. Add/update operator provisioning and maintenance runbook, no production mutation.
- [ ] Run focused isolation/auth/provider tests, full suite and typecheck. CodeScene review changed supported sources; safeguard before commit. Report exact context signatures for Task 3.

## Task 3: Per-user Lunch Flow OAuth and encrypted connections
**Files:** worker/lunchflow-platform.ts, worker/lunchflow-connections.ts, worker/lunchflow-oauth.ts, worker/lunchflow*.ts, worker/index.ts, worker/mobile.ts, required new migration and worker/schema.sql; tests/lunchflow-oauth.test.ts, tests/lunchflow-connections.test.ts, existing Lunch Flow tests; docs/lunchflow.md.
**Interfaces:** Use Task 2 authenticated context. Provide authenticated connection status/start/disconnect and provider callback routes; clients consume status with configured/connected/reconnectRequired fields and authorization URL, never tokens. Personal legacy connection is explicitly owner-bound; Platform connections are tenant-owned.
- [ ] Verify official provider authorization/token/refresh/revoke API contracts and PKCE support before implementing.
- [ ] Write failing tests for unknown user, callback state/session swaps, expiry/replay, refresh races, disconnected jobs, same provider IDs across connections and missing configuration.
- [ ] Implement single-use server state and fixed allowlisted callback; server-side OAuth exchanges, authenticated token encryption bound to user/ledger/connection, versioned refresh publication and revocation. Unknown callback never provisions users. Do not log credentials or provider bodies.
- [ ] Use separate Personal/Platform adapters. Preserve legacy personal feed only for owner. Do not assume provider account IDs map between APIs; require explicit verified cutover or block conflicting replacement safely.
- [ ] Connect account discovery/selection/manual sync/cron to the authenticated connection; disconnect invalidates queued generations and preserves financial history. Define actionable disabled/configuration states until developer credentials installed.
- [ ] Focused tests, full suite/typecheck, CodeScene and safeguard before task commit. Document configuration names and provisioning without secret values.

## Task 4: Web and Android connection controls and session isolation
**Files:** src/lunchflow.tsx and associated API types/components; mobile API/auth/cache modules; android connection/auth/repository/viewmodel code identified through route inventory; tests/lunchflow-web.test.ts, tests/mobile-lunchflow.test.ts and native focused tests.
**Interfaces:** Consume Task 3 connection APIs under existing authenticated session, no tenant ID in trust boundary.
- [ ] Write failing tests for not configured/disconnected/connected/reconnect-required states, logout/account switch and stale in-flight response handling.
- [ ] Add Connect, Reconnect, Disconnect and private account selection on maintained web/native clients. Use system browser OAuth with validated callback handoff. No signup/invite UI.
- [ ] Clear user-specific caches and local financial data on logout/switch; old in-flight results cannot repopulate a different session. Unsupported legacy clients fail closed with actionable update/re-login response.
- [ ] Run focused web/native tests and appropriate Kotlin checks using D: tooling. CodeScene checks and safeguard before task commit.

## Task 5: Migration rehearsal, whole-change review and release preparation
**Files:** migration/isolation integration tests; docs/lunchflow.md; docs/hosted-users-rollout.md; any fixes assigned to preceding task owner.
- [ ] Rehearse upgrade from existing owner schema with representative data, record exact counts/totals/FK check and verify web/native/exports/sync under bound owner.
- [ ] Verify registration remains closed even for a valid unprovisioned identity. Verify two synthetic isolated users, provider collisions and all route inventory entries.
- [ ] Produce production runbook: owner bindings prerequisite, backup/restore proof, scoped service migration, maintenance pause/drain/resume, owner re-login, compatible client deployment and rollback prohibition after multi-user writes. Do not execute production migration yet.
- [ ] Run final required tests/typecheck/build, independent broad review, CodeScene safeguard and analyze_change_set against origin/main. Resolve actionable findings, disclose external OAuth/production validation prerequisites precisely.
- [ ] Report implementation and validation state with no claim of live migration or successful real bank connection without observed production evidence.
## Execution refinement (2026-10-24)
Task 2 is split into independently reviewed checkpoints: 2A authentication/session foundation (including tenant-unbound pending login/pairing), 2B core financial/report/import APIs, 2C providers/jobs/capture/review plus complete inventory audit. Explicit required LedgerContext is the common interface. Completion of 2A is not a claim that all runtime data paths are isolated; no additional production users or deployment until all checkpoints pass.
The deployment workflow currently auto-applies D1 migrations; Task5 must add a fail-closed cutover preflight before automatic hosted-user migration, with owner binding and maintenance/backup prerequisites documented and tested.
