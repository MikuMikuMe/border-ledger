# Border Ledger Android Bank Alerts Implementation Plan

Revision 2 — 2026-10-13: animated login, full website feature parity, shared Border Ledger styling and complete System/Light/Dark themes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user chooses delegated execution. Implement this plan task by task; steps use checkbox syntax for tracking. Read the linked spec before implementation.

**Goal:** Deliver a signed Pixel 10 Pro application with every website function, an authored animated login, matching light/dark identity, and reliable BOC WeChat capture with correct original local notification time/currencies; add CMB after source verification.

**Architecture:** Kotlin/Compose, encrypted Room/SQLCipher and WorkManager use the existing Worker/D1 as one ledger authority. Access-backed interactive owner sessions authorize complete native ledger/recurring/import/export/bank/settings workflows; separate narrow capture credentials handle background notification uploads. Official Android Plaid Link and system-browser identity/bank authorization integrate with native screens; website feature pages are not substitutes for native completion.

**Tech Stack:** Kotlin, Compose/Material 3 animation/Canvas, Coroutines/Flow, Room/SQLCipher, Keystore, WorkManager, Android Plaid Link SDK, Custom Tabs/verified App Links, document picker/Save/Share, HTTP client/serialization; existing TypeScript/React/Vite, Worker/D1/Queues/Vitest; Gradle/GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md`.

## Global constraints

- Original notification posting time is the live transaction time. A new alert at 12:00 a.m. `America/Toronto` belongs to that new local day. Reconnect/callback time and bank-card wall time cannot replace it.
- Default report timezone is `America/Toronto`; week starts Monday. All instant conversion uses IANA zones, never a fixed twelve-hour adjustment.
- WeChat/source notifications accept any currency in the validated ISO registry, including CAD, CNY, USD, HKD and other registered codes. Registry minor-unit metadata permits additional registered currencies without another table rebuild.
- Failed, held, voided, ignored, unresolved or superseded projections contribute zero. `撤销` is not a generic refund. Source notifications never create bank-confirmed records.
- One credit account may contain several currencies. Bank, approved source profile and instrument identify an account; currency or a card suffix alone does not.
- Notification access is the only special capture capability. No AccessibilityService, root, WeChat database access, bank passwords, READ_SMS, exact alarm or perpetual foreground service.
- Capture pairing: ten-minute session, eight-character code, minimum five-second polling; capture credential is 32 random bytes with hash-only server binding, 90-day life and selected-source `alerts:write` only. It cannot authorize financial screen reads/review/bank management.
- Owner login: Access-backed ten-minute request, PKCE S256/state, two-minute one-use code and verified HTTPS callback; owner access 15 minutes, rotating refresh 24 hours or explicit Stay signed in 30 days. Identical exchange/refresh response replay is encrypted and limited to 60 seconds; check revocation every request.
- Explicit Sign out pauses local monitoring, revokes owner/capture grants, hides/clears financial read cache and preserves unsent alerts encrypted. Offline remote revocation is visibly pending. Ordinary session expiry does not silently cancel consented background capture.
- Ingest: at most 50 events and 128 KiB JSON. List pages default 50, maximum 100. Report aggregates are independent of pagination.
- Idempotency key is `(ownerLedgerId, eventId)` with a persistent random event UUID, independent of credential renewal. Same identity with different immutable content is a conflict.
- Acknowledged local evidence expires within 24 hours; unresolved approved-source raw text expires after seven days; replay metadata retention is 90 days. Keep unsent normalized events; pause intake visibly at 5,000 pending events.
- Raw screenshots, real transaction fixtures, private chat text, credentials and signing material never enter GitHub/logs. Financial local storage is encrypted and excluded from OS backup/transfer.
- Proposed minimum Android API is 26; phones are the shipped class; physical acceptance targets Pixel 10 Pro. Resolve and pin a compatible stable toolchain at Task 1.
- Every native/web UI change goes through Impeccable; preserve the existing Border Ledger identity using native Material structure.
- Release requires all F01–F18 parity rows in the spec. Native import/export, recurring and bank/account/settings workflows cannot be deferred or replaced by opening website feature pages.
- Appearance is System by default, with Light/Dark override on Login and Settings. Apply it to every owned UI surface and preserve input/navigation/auth/capture state on theme changes.
- Login flowing ink ribbons are explicitly required: 16–24-second cycles, steady controls, static reduced-motion/Battery Saver path and paused hidden/backgrounded animation. Routine feedback is 100–150 ms; transitions 150–300 ms.

## Review focus

1. Rich WeChat template cards may expose only a generic Android notification; Tasks 1/6/7 must prove actual accessible fields and fail visibly when absent.
2. Successful purchases, failed attempts, orphan cancellations and identical repeated messages must remain different financial events; Tasks 2/6/10 exercise this.
3. Midnight, reused notification keys, summary updates and reconnects must not move older transactions to the new delivery/processing day; Tasks 2/6/7/11 exercise this.
4. Renewed pairing must not duplicate an upload; stray login callbacks, refresh replay and capture-token substitution must not grant owner/bank authority; Tasks 4/5/8/9/14 exercise this.
5. Currency-table replacement can trigger foreign-key/cascade loss, and amount fingerprints can erase two legitimate equal purchases; Tasks 3/10 prove populated-copy preservation and distinct statement rows.

## Repository baseline and file map

Workspace: `Z:/Projects/Personal-Finance`. Current files were inspected, rather than assuming the original greenfield proposal still describes the repository. No Android project currently exists. The filesystem view does not currently contain Git metadata; recover/attach the intended repository at implementation time before recording commits. Do not manufacture a new unrelated repository or change production just to execute this plan.

| Area | Create | Modify and preserve |
|---|---|---|
| Shared contract/currency | `contracts/mobile-v1.openapi.yaml`, `contracts/currencies.json`, `src/domain/currencies.ts`, `src/domain/bank-alerts.ts`, `src/domain/alert-lifecycle.ts` | `src/domain/types.ts`, `format.ts`, `ledger.ts`, `reporting.ts`, `imports.ts`, `export.ts`, `recurring.ts`; existing provider and recurring behavior |
| Persistence | `worker/migrations/0003-multicurrency.sql`, `0004-mobile-alerts.sql`, `worker/alert-store.ts`, `worker/device-store.ts`, `worker/annotation-store.ts` | `worker/schema.sql`, `worker/db-types.ts`; never rewrite applied migrations. Allocate later sequence numbers if new migrations have landed. |
| Native parity persistence | `worker/migrations/0005-native-parity.sql`, `worker/owner-session-store.ts`, `worker/import-store.ts`, `worker/preferences-store.ts` | Shared ledger/identities and existing imports/recurring/Plaid tables; session replay is encrypted and TTL-bound |
| Worker APIs | `worker/mobile.ts`, `worker/mobile-auth.ts`, `worker/device-pairing.ts`, `worker/alert-reconciliation.ts`, `worker/ledger-reports.ts` | `worker/index.ts`, `security.ts`, `validation.ts`, `plaid.ts`, `plaid-recurring.ts`; retain canonical-origin, browser and webhook guards |
| Owner/mobile feature services | `worker/mobile-owner-auth.ts`, `worker/mobile-owner-routes.ts`, `worker/connection-service.ts`, `worker/import-service.ts`, `worker/export-service.ts`, `worker/recurring-service.ts` | Reuse relevant existing handlers/domain rules; no duplicate provider sync or generic privileged proxy |
| Existing web flows | `src/components/DevicePairingView.tsx`, `DeviceManagementView.tsx`, `AlertReviewView.tsx`, `src/domain/bank-statement-adapters/boc.ts` | `src/App.tsx`, `src/domain/api.ts`, imports/reports and recurring displays; adapt through Impeccable |
| Android build/app | `android/settings.gradle.kts`, `build.gradle.kts`, `gradle/libs.versions.toml`, Gradle wrapper, `app/build.gradle.kts`, manifest, `app/src/main/java/com/lofuyu/borderledger/BorderLedgerApplication.kt`, `MainActivity.kt`, `AppContainer.kt` | New module; production package `com.lofuyu.borderledger`, test/debug suffix so probes do not overwrite a future installed release |
| Android capture/storage | Under the Kotlin package: `capture/BankNotificationListener.kt`, `NotificationExtractor.kt`, `ObservationTracker.kt`, `SourceProfile.kt`, `parser/BankAlertParser.kt`, `BocCreditCardParser.kt`, `local/LedgerDatabase.kt`, `OutboxDao.kt`, `KeyStoreVault.kt` | Add CMB parser only after its source gate; follow feature ownership and avoid a single giant activity/service |
| Android API/sync | `api/MobileApi.kt`, `MobileDtos.kt`, `PairingClient.kt`, `sync/UploadWorker.kt`, `UploadScheduler.kt`, `LedgerRepository.kt` | Versioned DTOs from contract; pinned allowed API origins per tested environment |
| Android owner login | `auth/OwnerSessionManager.kt`, `OwnerSessionStore.kt`, `OwnerLoginClient.kt`, `AuthCallbackActivity.kt`, `ui/login/LoginScreen.kt`, `LoginFlowBackdrop.kt`, `LoginViewModel.kt`; public `public/.well-known/assetlinks.json` | Verified callback/canonical routing; separate capture credential and owner-session storage/interceptors |
| Native full-parity features | `ui/recurring/`, `ui/imports/`, `ui/export/`, `ui/accounts/`, `ui/settings/`, `ui/about/`, `bank/PlaidLinkCoordinator.kt`, `imports/StatementDocumentReader.kt`, `exports/LedgerExportCoordinator.kt`, feature repositories/ViewModels | Same stored recurring/provider/domain semantics; native staging, scoped document URIs and export scales |
| Android UI | `ui/theme/BorderLedgerTheme.kt`, `ThemePreferences.kt`, `MotionPolicy.kt`, role files, onboarding/overview/activity/review/connections ViewModels | Android product/design context; root web identity stays intact; five destinations with Recurring and native Import/Accounts subflows |
| Verification/delivery | `tests/alerts-*.test.ts`, `tests/mobile-*.test.ts`, `tests/currencies.test.ts`, `tests/multicurrency-migration.test.ts`, Android unit/instrumented tests, `.github/workflows/android-ci.yml`, `android-release.yml`, `docs/android-validation.md` | Existing tests, `.github/workflows/ci.yml`, `README.md`; no secret-bearing fixtures |

This is one coordinated plan because capture identity, event lifecycle, currency migration and reporting share correctness invariants. Implement serially at their dependency boundaries. A commit is a checkpoint after a task's checks pass; it is not a separate need for production deployment.

## Interfaces to keep consistent

| Contract | Signature / fields |
|---|---|
| Currency registry | `getCurrencyMeta(code: string): { code: CurrencyCode; minorUnitDigits: number } \| null`; `parseMoneyMinor(value: string, currency: CurrencyCode): number` rejects invalid scale/overflow. Android consumes the same registry. |
| Event DTO | `BankAlertEventInput`: `schemaVersion: 1`, `eventId`, `observationId`, `sourceProfileId`, `parserVersion`, `notificationPostedAt`, `capturedAt`, `eventTimeBasis`, `eventType`, `direction`, `instrumentHint`, `eventMoney: Money \| null`, `primaryMoneyRole`, `amounts: MoneyComponent[]`, `feeTreatment`, `bankReference: string \| null`, `bankDisplayedTime`, `merchant: string \| null`, `completeness`. |
| Event types | `purchase_notice`, `authorization_reversal`, `declined`, `refund_notice`, `hold_notice`, `adjustment_notice`, `repayment_notice`, `transfer_notice`, `fee_notice`, `unknown`. |
| Projection | `deriveAlertProjection(event: BankAlertEventInput, mapping: InstrumentMapping \| null, links: AlertLink[]): AlertProjectionResult`; result has state, reason codes, optional normalized transaction and no automatic confirmed state. |
| Time | `reportingDateForInstant(instant: string, zone: string): string`; `resolveEventTime(input: EventTimeInput): ResolvedEventTime` explicitly reports its basis/precision. Live mode uses original notification time. |
| Pairing | `startPairing(input: PairingStartInput): Promise<PairingSession>`; `approvePairing(input: PairingApprovalInput): Promise<void>`; `claimPairing(input: PairingClaimInput): Promise<PairingClaimResult>`. Claim binds the app-generated credential hash and returns device/scope/expiry metadata, not a global secret. |
| Ingest | `ingestAlertBatch(context: DeviceContext, events: BankAlertEventInput[]): Promise<AlertBatchAck>`; each ack has event ID, receipt status, canonical transaction ID when present, revision and reason codes. |
| Reports | `readLedgerSummary(db: D1Database, input: ReportQuery): Promise<LedgerSummary>`; result includes window/timezone, per-currency confirmed/provisional totals, excluded-review counts, generated-at time and source freshness. |
| Review | `applyAlertReview(context: ReviewContext, eventId: string, expectedRevision: number, action: AlertReviewAction): Promise<AlertReviewResult>`; unsupported or changed state returns structured 409. |
| Owner auth | `startOwnerLogin(input: OwnerLoginStart): Promise<OwnerLoginRequest>`; `exchangeOwnerCode(input: OwnerCodeExchange): Promise<OwnerTokenResponse>`; `refreshOwnerSession(input: OwnerRefreshInput): Promise<OwnerTokenResponse>`; `authenticateOwner(request, requiredScope): Promise<OwnerContext>`. Exact lifetimes/replay policy come from spec. |
| Native sessions | `OwnerSessionManager.state: StateFlow<OwnerSessionState>`; `beginLogin(staySignedIn: Boolean)`, `handleCallback(uri: Uri)`, `withOwnerAuthorization`, `signOut`; single-flight rotation, restore/cancellation and pending revocation. Capture uses another credential provider. |
| Feature services | `createImportPreview(owner, input): Promise<ImportPreview>`; `stageImportChunk(owner, id, index, rows): Promise<ImportChunkAck>`; `commitImport(owner, id, selection, operationId): Promise<ImportCommitResult>`; `exportLedgerCsv(owner, query): Promise<Response>`; recurring/native Plaid methods reuse core services. |
| Preferences/theme | `readReportingPreferences(owner)` / `updateReportingPreferences(owner, expectedRevision, input)`; Kotlin `ThemePreferences.mode: Flow<System|Light|Dark>` and `MotionPolicy` respect visibility, OS animations and Battery Saver. Theme is device-specific. |
| Native parser | `BankAlertParser.parse(message: ObservedBankMessage, profile: SourceProfile): ParseResult` where result is Complete, NeedsReview or Ignored. |
| Native outbox | `enqueue(event: BankAlertEventInput): EnqueueResult`; `nextBatch(limit: Int): List<QueuedAlert>`; `applyAcknowledgements(ack: AlertBatchAck)`; immutable queued payload survives restarts. |

Freeze schema names in the OpenAPI/DTO task before adjacent implementations. Additive v1 fields are optional with explicit defaults; breaking changes require another namespace. Opaque cursor pagination must have deterministic tie-breaking. Money null is not zero. Device scope and source confirmation are server-owned.

Use the fixed spec contracts: ledger `personal`, canonical accounts and approved source/currency mappings, interactive owner full-parity scopes versus capture-only credentials, provider/file-row/alert identities, money roles, audited links and zero-impact untimestamped bundles. Every F01–F18 row is a release requirement.

## Task 0 — Establish the authoritative source and database baseline

**Owner/dependencies:** Implementation/platform owner; before any product/schema edit.

**Files:** No product changes. Record a sanitized baseline in `docs/android-validation.md` when source authority is established.

- [ ] Identify the intended existing project/repository through app attachments, saved project context and available repository metadata; inspect current checkout/branch and uncommitted changes. Attach/recover the authoritative checkout while preserving the current workspace edits. If this project has never been a repository, initialize this same project during authorized implementation rather than creating an unrelated replacement.
- [ ] Record the authoritative revision and relevant source inventory. Verify the deployed sandbox/production Worker environment, database binding and actually applied migration history before designing an executable upgrade. A README/schema file is not proof of remote database state.
- [ ] Gate schema changes and release work on this baseline; plan artifact creation itself does not require modifying Git or a remote database. Checkpoint only after source authority is resolved.

## Task 1 — Prove capture on the Pixel before committing to parsers

**Owner/dependencies:** Android owner + user-operated device/permissions; first task.

**Files:** Android build/application skeleton, `debug/NotificationProbeScreen.kt`, `debug/ProbeNotificationListener.kt`, `android/PRODUCT.md`, `docs/android-validation.md`.

**Consumes/produces:** The spec's privacy and time rules; produces a reproducible debug APK, pinned toolchain and sanitized source-capability report. The probe is debug-only, memory-only for payloads, and does not upload financial data.

- [ ] Record installed Android/WeChat versions, source conversation identifiers and source packages, CMB account/channel when available, and actual BOC credit/debit export options. Existing screenshots alone cannot satisfy the notification-field gate.
- [ ] Load Impeccable Android guidance; define the simple probe/onboarding states before editing UI. Pin stable compatible dependencies in the version catalog; record actual resolved versions/JDK/SDK in validation notes.
- [ ] Build the smallest installable probe with an Android-protected notification listener, permission state, scalar field preview, and explicit sanitized local export action. A synthetic parser test is visibly labeled synthetic.
- [ ] Verify real new BOC delivery on Pixel: locked/unlocked, WeChat background/foreground, silent versus muted, content-preview settings, permission revocation/regrant and listener reconnect. Compare `sbn.postTime`, any individual message timestamp, callback time and the user's clock.
- [ ] Obtain one usable example per accessible source/template variant without committing private values; make synthetic equivalents for purchase, failure, cancellation and foreign currencies. Inspect an actual bank export and determine CSV/XLSX/text-PDF/image-PDF behavior.
- [ ] Run from `android`: `./gradlew :app:assembleDebug` (`.\gradlew.bat` on Windows); expected successful APK. Install with `adb install -r <built-debug-apk>` and verify an actual BOC callback. Record field availability and any delivery gaps.
- [ ] Gate: require approved source/type, labeled amount/currency, resolvable instrument and original individual posting time for purchase capture; merchant and bank wall time are optional. Untimestamped bundles are review-only. If WeChat is generic, test BOC app notifications. If both fail, mark the source import-only and automatic-monitoring acceptance unmet; keep health diagnostics without fabricating projections. Save the feasibility outcome and checkpoint commit.

## Task 2 — Define currency, event, lifecycle and time behavior with tests

**Files:** shared contract/currency files above; `tests/currencies.test.ts`, `tests/alerts-domain.test.ts`, `tests/alerts-time.test.ts`; affected domain/provider/recurring helpers.

**Consumes/produces:** Verified capability report and design; produces all DTO/domain signatures in the interface table, validated currency registry, and pure projection/time functions. Keep existing CAD/CNY callers compatible while removing fixed two-currency assumptions.

- [ ] Write failing synthetic currency tests: CAD/CNY/USD/HKD coexist, extra registered currency appears without new UI branches, unknown symbol/code stays unresolved, exact minor-unit scale and safe-integer bounds. Exercise zero/three-decimal metadata with injected synthetic registry entries.
- [ ] Write lifecycle assertions: `declined => 0`; `orphan reversal => 0 + review`; full linked unposted cancellation => 0; synthetic purchase 10,000 minor units minus verified partial cancellation 3,000 => one provisional projection 7,000; over-cancellation/cross-currency cancellation => review. Unrelated success survives a same-amount failure; holds do not sum with completion; confirmed partial refunds count once; two distinct equal purchases remain two.
- [ ] Pin the user's time rule with these exact assertions:

```text
posting 2026-10-13T04:00:00.000Z, Toronto => 2026-10-13 00:00
posting 2026-10-13T03:59:59.999Z, Toronto => 2026-10-12 23:59:59.999
posting 2026-11-02T05:00:00.000Z, Toronto => 2026-11-02 00:00
original posting at midnight, callback/reconnect at 09:00 => original midnight
different bank-displayed date/time => original notification reporting day unchanged
statement match with later posting date => known live occurrence time retained
```

- [ ] Add missing-year, New Year, historical-paste and ambiguous-summary tests: live year comes from the original notification timestamp; old historical material needs explicit date context; a bundled update cannot assign today's timestamp to old messages.
- [ ] Run `npm test -- tests/currencies.test.ts tests/alerts-domain.test.ts tests/alerts-time.test.ts`; observe failures for the missing behavior. Implement registry, DTO schema, `deriveAlertProjection`, `resolveEventTime` and lifecycle decisions. Preserve source money separately from billing money.
- [ ] Add money component roles/direction/fee treatment, exact link relations/transitions, structured reason/error codes and OpenAPI scope/limit/ack/revision shapes from the fixed spec contracts. Test that balances and included fees cannot create extra spending, and `possible_duplicate` links do not silently merge events. Type-check all existing currency/provider consumers.
- [ ] Run the same targeted tests and `npm run typecheck`; expected pass. Commit the contract/domain slice.

## Task 3 — Preserve populated D1 and add native-parity storage

**Files:** next versioned currency/mobile/native-parity migrations, schema/db types, alert/device/owner-session/import/preference/annotation stores; migration/storage/auth fixtures.

**Consumes/produces:** Task 2 contracts; produces currency-aware instruments/events/links/source identities, capture mappings, owner-session families/refresh/replay records, staged imports/chunks and versioned shared preferences.

- [ ] Seed failing populated migration tests with accounts, provider IDs/cursors, recurring streams/memberships/classifications and annotations. Assert IDs/counts/FKs survive, one credit account accepts multiple approved currencies and new auth/import/preference tables do not alter existing money.
- [ ] Add fixed ledger personal, currency_mode/account_currencies and approved profile/hint mappings. Remove globally unique resemblance fingerprint; retain nonunique candidate index. Preserve provider identity/pending lineage, assign unknown legacy identity without rewriting transaction IDs, and test two equal provider purchases plus later modifications.
- [ ] Allocate 0003-multicurrency, 0004-mobile-alerts and 0005-native-parity or next unused names after Task 0's authoritative applied-migration check. Rebuild legacy CHECK tables with preserved dependent/cascading rows and indexes; use tested D1 deferred FK enforcement, not unsupported disabling. [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [ ] Persist owner request/code hashes, session/refresh generations, exact expiry/revocation fields and encrypted 60-second response-replay TTL. Capture credentials have separate hash/type/scope. Store import preview/chunk identity and final publication status, and shared preferences with revision.
- [ ] Add immutable ledger/event UUID identity, digest, source-record keys, lifecycle link/cycle rules, annotations and effective-report indexes. Use prepared statements and atomic D1 batches; expired staging/replay records are cleaned without deleting unsent native events or confirmed history.
- [ ] Run migration/storage/provider-identity tests on populated fixtures, verify FKs/row identities, then rehearse migration and restore on a synthetic/sandbox copy. Production is not changed in this task. Commit the passing storage slice.

## Task 4 — Owner login broker, capture pairing and credential boundaries

**Files:** worker/mobile-owner-auth.ts, owner-session-store.ts, mobile-auth.ts, device-pairing.ts, guards/routes/OpenAPI, owner-authorization/pairing components, public/.well-known/assetlinks.json; owner-auth/rotation/capture-pairing/security tests.

**Consumes/produces:** Tasks 2/3; produces startOwnerLogin, exchangeOwnerCode, refreshOwnerSession, authenticateOwner, capture pairing/authorization and exact scope/revocation behavior.

- [ ] Write failing tests for wrong PKCE/state/host/path, unapproved Access identity, expired/consumed code, duplicate callback, lost exchange response, conflicting concurrent claims, rotated refresh replay inside/outside 60 seconds, logout and environment mismatch.
- [ ] Assert capture tokens cannot read the whole ledger or call owner import/export/recurring/bank/device-management routes; owner tokens cannot fall through the old browser/global-key guard. Preserve raw-host 404, verified webhook path and same-origin Access-backed approval.
- [ ] Implement ten-minute Access-backed login request, explicit owner approval, two-minute single-use code bound to PKCE/state/device and verified HTTPS callback. Exchange opaque owner tokens only over HTTPS; hashes at rest, encrypted bounded identical-response replay and atomic code consumption. Keep configured Access identity methods and approved personal ledger scope.
- [ ] Implement 15-minute access, rotating 24-hour refresh or explicitly selected 30-day Stay signed in, absolute expiry and family revocation. Single-flight caller plus identical request digest recovers one response for 60 seconds; conflicting reuse revokes family. Use dedicated session encryption key, never Plaid's key.
- [ ] Implement narrow 90-day capture credential/pairing and native owner consent for selected source/account/currency mappings. Login cannot grant OS notification permission or silently opt into capture. Hint collisions/hintless mappings follow the spec.
- [ ] Require recent Access-backed owner approval within ten minutes for full export, bank disconnect and another-device revocation. Logout revokes owner/capture authority; encrypted offline revocation intents can invoke only revocation and cannot restore interactive authority.
- [ ] Issue/hash separate random 32-byte revocation-only capabilities for each owner-session family and capture-credential generation, lasting only through that grant's expiry. Offline logout erases access/refresh credentials and keeps only these capabilities encrypted until acknowledged. Test denial of read/refresh/other mutations, idempotent revocation and delayed requests that cannot revoke newly issued grants.
- [ ] Through Impeccable, implement protected broker/capture approval pages with device/scope/consent explanation. Public callback/assetlinks resources contain no financial data and redact one-time codes/state from logs. Prepare narrowly scoped Access path exceptions and preserve all existing protected routes.
- [ ] Run owner-auth/rotation/pairing/security tests and typecheck, then verify actual browser/App Link return on sandbox/Pixel. Expected: legitimate owner succeeds; every substitution/replay/guard violation fails; lost legitimate responses recover once. Commit.

## Task 5 — Encrypted storage, native login and capture onboarding

**Files:** Room/Keystore, auth/OwnerSessionManager.kt, OwnerLoginClient.kt, OwnerSessionStore.kt, AuthCallbackActivity.kt, credential interceptors, theme/motion primitives, ui/login/LoginScreen.kt, LoginFlowBackdrop.kt, LoginViewModel.kt, capture onboarding/backup rules; native auth/storage/theme tests.

**Consumes/produces:** Tasks 1–4; produces real signed-in owner state, separate capture credential, encrypted financial/outbox state, immutable event IDs, System/Light/Dark and reduced-motion primitives.

- [ ] Write failing tests for login return/cancel/expiry/offline/unapproved identity, duplicate callbacks, process death during exchange/rotation, lost response, wrong DB key, backup exclusion and normal app upgrade.
- [ ] Implement OwnerSessionManager state flow, single-flight refresh, remembered-grant expiry, restore/pending destination and idempotent rotation metadata. Owner and capture HTTP providers are separate and choose only allowed canonical environment/origins; no demo fallback on auth/data failures.
- [ ] Through Impeccable shape/Android/animate/craft guidance, implement steady Sign in securely, Stay signed in, appearance and About controls with the spec's flowing ink backdrop. Pause it offscreen/in browser/background; static reduced-motion/Battery Saver; authentication actions never wait for animation.
- [ ] Implement verified App Link manifest/host/path/state handling and actual Custom Tab return, restoring native destination/draft. A failed return stays recoverable without logging a token or claiming sign-in succeeded.
- [ ] Encrypt Room, owner/refresh/capture credentials and financial cache with Keystore protection. Background capture must not require a foreground biometric prompt after first unlock. Storage failure never falls back to plaintext or destructive automatic reset.
- [ ] After owner login, implement explicit source/instrument/currency consent and narrow capture-hash issuance, OS notification settings/resume checks and a real source test. Separate app-posting notification permission from listener access.
- [ ] Implement explicit logout: pause monitoring, clear/hide read cache and owner credentials, retain encrypted unsent same-ledger events, queue revocation-only intent when offline and show its state. Test remembered offline cache policy and newly approved scope before replay.
- [ ] Run native unit/instrumented tests; expected encrypted/wrong-key/backup proofs, actual signed-in state, correct animation/theme lifecycle and no financial content while signed out. Record hardware/emulator provenance and commit.

## Task 6 — Source-specific extraction, parser and observation identity

**Files:** extractor/tracker/source profile/parser files, native DTO mapper; unit tests and synthetic BOC notification fixtures.

**Consumes/produces:** Tasks 1/2/5; produces `ObservedBankMessage`, `ParseResult`, `NotificationExtractor.extract`, `ObservationTracker.diff` and `BocCreditCardParser.parse`.

- [ ] Write failing extractor tests for unrelated packages/private WeChat chats, matched bank sender but unrelated promo/OTP, approved BOC credit source, group summary plus child, reused key with new messages, removed/recreated notification and stable identity replay.
- [ ] Write table-driven parser tests for spec E01–E15/E18–E20. Evaluate failure/type before amount; labeled currency/amount is distinct from balance, limit or FX amount. Normalize supported Chinese/full-width forms without guessing a missing currency or merchant.
- [ ] Assert distinct equal-amount successes survive, all failed attempts count zero, separate reversal amounts remain distinct, and ambiguous identical messages produce a duplicate-review reason rather than deletion or two confident charges.
- [ ] Implement exact template adapters from actual accessible payload structure, using the source labels and keys found in Task 1. A generic OS body must produce NeedsReview/unsupported capability, not a parser for the richer screenshot fields it never received.
- [ ] Preserve original individual posting timestamp. Untimestamped summary children remain zero-impact date/duplicate review and cannot borrow summary/bank time. Existing pre-activation messages, or newly discovered messages older than seven days without local identity, need historical review. Freeze known event time across key updates/reconnect; source-bank wall time remains secondary.
- [ ] Run `./gradlew :app:testDebugUnitTest --tests '*BocCreditCardParserTest' --tests '*ObservationTrackerTest' --tests '*NotificationExtractorTest'`; expected case matrix passes with no real financial fixtures. Commit.

## Task 7 — Production listener and durable intake

**Files:** `BankNotificationListener.kt`, manifest/settings helpers, local observation/candidate/outbox DAOs, upload scheduler; native service/outbox tests.

**Consumes/produces:** Tasks 5/6; produces a listener that saves eligible source evidence and `enqueue` atomically, plus observable capture/queue status.

- [ ] Write tests: callback does no DB/network work on main thread; approved event commits before Queued is displayed; transaction failure does not mark queued; unrelated text never reaches storage; a 100-event synthetic burst preserves all committed identities.
- [ ] Add restart/reconnect/active-notification tests using original posting timestamps, as well as revoked listener permission, first unlock, muted/generic source, 5,000-event cap and expiry/retention behavior.
- [ ] Declare a system-bindable service protected by `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`. Copy bounded scalar inputs, then parse/persist off the main thread. Persist tracker state and immutable outbox payload together.
- [ ] Use `onListenerConnected` before active-notification recovery. Recovered currently active notifications go through the same identity logic, not a bulk replay/backfill promise. No WeChat history or UI scraping.
- [ ] Schedule unique network-constrained work through WorkManager. Local capture and upload authorization are separate; token expiry pauses uploading while eligible intake continues within the documented cap.
- [ ] Run native unit/instrumented tests, then Pixel tests for silent/locked capture and permission changes. Record callback/storage timing and known gaps. Commit; remove the debug probe from production wiring.

## Task 8 — Atomic Worker ingestion with replay-safe acknowledgement

**Files:** `worker/mobile.ts`, `alert-store.ts`, lifecycle projection/store code, validation; `tests/alerts-ingestion.test.ts`, `tests/alerts-idempotency.test.ts`, `tests/mobile-route.test.ts`.

**Consumes/produces:** Tasks 2–4 and 7 DTO output; produces `ingestAlertBatch` and authenticated mobile event/status routes.

- [ ] Write failing D1 tests for duplicate requests, concurrent retries, lost response after commit, renewed credential submitting the same UUID, changed payload under one UUID, out-of-scope instrument, invalid scale, unrelated claimed source and immutable source/confirmation fields.
- [ ] Add mixed-batch assertions: one invalid item does not discard valid items; malformed/over-128-KiB envelope is rejected wholly; over-50-event input is rejected; no receipt is returned when DB commit fails.
- [ ] Implement canonical validated-content digest and ledger-scoped event uniqueness. Authenticate/scope-check before replay lookup. Atomically write evidence and eligible normalized projection/link state; failed/held/reversal-without-link notices cannot create counted purchases.
- [ ] Implement per-event accepted/duplicate/needs-review/non-spending/rejected acknowledgements, stable reason codes and immutable receipt identity. Keep raw notification text out of server payload, logs and D1.
- [ ] Run `npm test -- tests/alerts-ingestion.test.ts tests/alerts-idempotency.test.ts tests/mobile-route.test.ts`; expect one counted projection per event even under renewed pairing/retry. Commit.

## Task 9 — Upload/retry/cache synchronization end to end

**Files:** `UploadWorker.kt`, `UploadScheduler.kt`, `LedgerRepository.kt`, HTTP/DAOs; Kotlin unit/instrumented tests against a deterministic mock server and sandbox integration.

**Consumes/produces:** Tasks 5/7/8; implements `nextBatch`, `applyAcknowledgements` and repository read/refresh states.

- [ ] Write tests for offline enqueue, process kill/restart, timeout after commit, partial acknowledgement, 429/Retry-After, 5xx backoff, permanent per-item rejection, credential expiry/re-pair and concurrent foreground/background sync.
- [ ] Implement bounded immutable batches and one upload coordinator. Apply ack state in a local transaction before deleting rows; errors do not erase unsent records or regenerate UUIDs.
- [ ] Treat 401/expired/revoked as pairing action, 409 content mismatch as quarantined review and temporary network/server errors as retries. Resume queued identities after re-approval only within newly approved scope.
- [ ] Keep encrypted report/activity/recurring cache through owner-authorized reads, with snapshot timestamps and the spec's remembered-offline lease. Capture upload only invalidates it; a background token cannot refresh financial screens. Signed-out/expired/revoked-known grants expose no financial cache. No demo fallback or adding queued local money on top of server totals.
- [ ] Run native test suite and a sandbox exercise: capture synthetic burst offline, restart, restore network, force response loss and renew pairing. Expect every committed eligible event once, correct exclusion of non-spending events, and preserved original transaction time. Commit.

## Task 10 — Working BOC statements and financial reconciliation

**Files:** actual-format statement adapters, `src/domain/imports.ts`, Worker reconciliation/annotations, web review component, projection provenance; `tests/alerts-reconciliation.test.ts`, `tests/statement-identity.test.ts`, existing import tests.

**Consumes/produces:** Tasks 1–3/8; produces `applyAlertReview`, strong-reference matching/candidate ranking, canonical confirmed projections and annotation preservation.

- [ ] Inspect the user's actual export identified in Task 1. Implement only the required structured/text-PDF adapter, with explicit preview and date/currency mapping. If the available PDF has no text, report the unsupported format and document the verified alternative; do not claim CSV solves it automatically.
- [ ] Write import identity tests: two equal rows in one statement are two real transactions; re-importing the identical file adds none; overlapping exports without bank row IDs produce review candidates, not amount-based automatic merges. Keep file/row or provider identity distinct from a candidate fingerprint.
- [ ] Write lifecycle/reconciliation tests: reversal arrives before purchase; two possible equal originals; partial reversal; successful charge plus failure; statement before alert; statement match after categorization; cross-currency settlement with reference; different banks/cards with same amount; confirmed refund after posting.
- [ ] Implement bank-reference auto-linking and explicit user matching when identity is weak. Enforce ledger/instrument/link-cycle rules. Full cancellation voids a linked unposted purchase; same-currency partial cancellation reduces its remaining provisional magnitude; out-of-range allocations and orphan/cross-currency cancellations stay in review. A confirmed charge requires bank-credit evidence before reduction.
- [ ] Atomically supersede the notification projection when a confirmed record matches. Keep original alert, money/time evidence and annotation provenance, including the user's live notification time. Never delete source history to repair totals.
- [ ] Through Impeccable, provide candidate/impact/revision behavior in common services and both clients; Task 12 completes the native picker/preview/commit. Existing web import commits must call the same durable service rather than local-only merge. A feature-page browser detour does not satisfy native import.
- [ ] Run `npm test -- tests/alerts-reconciliation.test.ts tests/statement-identity.test.ts tests/import-parser.test.ts tests/ledger.test.ts`; expect exact known-statement totals and no erased identical legitimate purchases. Commit.

## Task 11 — Complete reports, theme system and native ledger shell

**Files:** worker/ledger-reports.ts, owner-authorized read/annotation APIs, native theme/motion/login/overview/activity/review/accounts shell/ViewModels, existing web currency/report views; report/Compose/contrast/motion tests.

**Consumes/produces:** Tasks 2–10; produces full-window summaries/charts, filtered activity/detail/review, five-destination shell and all-owned-surface theme/motion behavior. Tasks 12–15 complete remaining parity screens before release.

- [ ] Write failing tests with 501+ transactions, several currencies, excluded failures/voids/review, cross-source matches, negative refund period and exact local midnight/week/month/DST rules. Reports/chart data cover the full query, never a 50/100/500-row list page.
- [ ] Implement effective reads/aggregates once, returning time basis, source coverage/freshness and known live occurrence time after confirmation. Add owner scope/revision assertions; no edits to immutable evidence or device-side confirmed status.
- [ ] Through Impeccable, implement System/Light/Dark Material roles across all owned surfaces, system bars, charts, rows, fields, sheets/dialogs/snackbars/previews and states. Preserve existing Border Ledger paper/ink/ruled identity and readable dark green-charcoal/teal/copper counterpart.
- [ ] Implement Overview, Recurring, Activity, Review, Accounts navigation. Review owns Import/Alerts/Matches; Accounts owns banks/capture/devices/settings. Native Back/IME/insets/state restoration and large-font compact labels remain usable. No incomplete destination ships as a substitute feature.
- [ ] Implement reporting lens, daily/weekly/monthly chart range, Activity search/currency/category/state/source filters, detail/provenance and review. Bind repository Flows/ViewModels; theme change preserves input/filter/draft and auth/capture state.
- [ ] Implement native category/note editing and Save through the owner-authorized annotation PATCH with expected revision. Cover validation/network errors, expired-session draft recovery, and 409 conflicts showing current values alongside the retained draft for an explicit retry. Keep raw bank evidence and confirmation state immutable; test Light/Dark, keyboard/insets and large-font edit/save states.
- [ ] Add Compose/semantic tests for 48-dp targets, TalkBack, 200% fonts, bilingual overflow, contrast roles, live System-theme changes, login reduced-motion/Battery Saver and animation pause/resume without financial-value count-up.
- [ ] Run targeted report/theme/motion/Compose tests and existing web typecheck/build; commit common theme/ledger slice. Full visual/a11y/motion review and final android/DESIGN.md occur once all parity screens are complete at Task 17.

## Task 12 — Native statement import, durable commit and CSV export

**Files:** worker/import-service.ts, import-store.ts, export-service.ts, mobile owner routes/OpenAPI; native imports/StatementDocumentReader.kt, ImportRepository.kt, ui/imports/, exports/LedgerExportCoordinator.kt, ui/export/; existing web/domain import/export hooks; native and Worker import/export parity tests.

**Consumes/produces:** Tasks 3/4/5/10/11; produces createImportPreview, stageImportChunk, commitImport, exportLedgerCsv and native file/account/row-review/Save/Share workflows (F05–F07).

- [ ] Write failing native tests for canceled picker, lost URI permission, 10-MiB limit, unsupported/corrupt format, Chinese/quoted CSV, required columns/currency scales, real account selection and rows/errors/duplicate-candidate preview. Use shared synthetic fixture assertions for native and web; actual BOC format is determined at Task 1.
- [ ] Implement Android document-picker URI reading with bounded IO and scoped persisted URI access when needed. CSV is required; add the verified BOC structured/text-PDF reader or source-preserving normalized adapter from Task 10. Unsupported image-only PDF remains explicit, never a fake successful import.
- [ ] Send extracted minimal source rows/file hash/index to common Worker validation; do not upload whole private documents unnecessarily. Return canonical preview/count/errors/identity candidates and selected-account mapping. Native UI lets the user select accepted rows and resolve candidates before commit.
- [ ] Implement staged chunks with immutable preview/file/row identities, operation IDs and 24-hour preview lifetime. Interrupted/session-expired commits resume idempotently after login; staged data stays invisible to spending until the final commit/publication barrier. Cancel before publication clears staging, not existing ledger history.
- [ ] Wire both clients to durable import services and Task 10 reconciliation. Confirmation is an explicit owner import action; capture credentials cannot create confirmed records through an import route.
- [ ] Implement canonical streaming CSV export of All records or Current filter, including rows beyond pagination, currency-specific minor units, notes/state/source, correct quoting/Chinese encoding and safe formula-like text cells. Require recent owner approval for full ledger export.
- [ ] Through Impeccable, implement native preview/progress/errors/matches and Save/Share sheets; user-selected export files are an explicit data export, not an unencrypted app cache. Cancel/failure cleans temporary data and preserves draft.
- [ ] Run native/Worker import-export parity, interruption/retry/visibility and existing import/export tests. Compare canonical expected rows/counts/totals from both clients and verify on Pixel without opening website feature pages. Commit.

## Task 13 — Native recurring-payment analysis and classification

**Files:** worker/recurring-service.ts, mobile owner recurring routes, native RecurringRepository.kt, ui/recurring/RecurringScreen.kt, RecurringDetailScreen.kt, ViewModels, recurring DTOs; native/Worker recurring parity tests.

**Consumes/produces:** Tasks 4/5/11 and existing recurring read/classification modules; produces F11–F13 through owner-authorized native APIs using the same stored source projection.

- [ ] Write failing fixture comparisons for per-currency monthly/yearly/source estimates, actual distinct posted expense/fee/refund cost, subscription/bill/other/excluded classifications, upcoming 30 days, amount changes and stream payment history.
- [ ] Add native owner wrappers for list/summary/detail/classification using existing service queries/validation. Reads do not trigger a provider call; source estimates cannot insert ledger transactions. Preserve freshness/coverage/error semantics and bounded cursor pagination.
- [ ] Implement native currency/classification filters, Load more, summary, upcoming/change sections, detail/history and classification edit/save. Guard stale revisions and show unsupported product/source, waiting, incomplete, stale, empty, load-more error and save-error states.
- [ ] Through Impeccable, provide dark/light Material rows/charts/sheets and clear Expected versus Actual labels. Preserve selection/back navigation through theme changes and re-authentication; source limitations stay visible rather than producing zero as an unsupported estimate.
- [ ] Run existing recurring-domain/storage/API tests plus native fixture-parity/Compose tests. Expected: both clients agree with the same source snapshot, edits refresh appropriate views and excludes cannot change raw bank membership. Verify the flow on Pixel and commit.

## Task 14 — Native Plaid connect, account selection, sync and disconnect

**Files:** worker/connection-service.ts, mobile owner connection routes, native bank/PlaidLinkCoordinator.kt, AccountRepository.kt, ui/accounts/connection/; existing browser Plaid handlers; native/mock-provider/Worker operation tests.

**Consumes/produces:** Tasks 4/5/11 and existing Plaid services; produces complete F08–F10 native bank management without giving capture tokens broader authority.

- [ ] Write failing owner-scope tests for Link token/exchange/account verification, canceled Link/account selection, refresh, reconnect/update mode, disconnect and lost operation response. Device capture token substitution and client-chosen unverified bank IDs fail.
- [ ] Extract narrow shared bank service methods from existing handlers. Create Android Link tokens server-side with registered applicationId/android_package_name; use the official pinned SDK and its configured provider-required OAuth return. Never ship a bank access token/secret to Android. [Plaid Android](https://plaid.com/docs/link/android/)
- [ ] Implement native Link results and backend pending connection: server exchanges public token, encrypts temporary provider access token, retrieves authoritative accounts and returns metadata for native confirmation. Verify selected IDs before publishing mappings. Pending selection expires in 15 minutes; cancel/expiry cleans known provider Items and tracks uncertain cleanup for retry/review. Do not claim Link creates no provider Item or restores quotas on cancel. Implement required update/reconnect with existing Item identity.
- [ ] Implement refresh/sync request and source/job status without promising immediate provider freshness. Disconnect uses recent owner approval, explicit native confirmation and idempotent operation tracking; revoke provider access before dropping credentials and retain ledger history.
- [ ] Through Impeccable, implement account/currency/status cards and provider failure/reconnect/selection/disconnect states in both themes. Provider-owned authorization may use browser/SDK UI; the app's account management remains native.
- [ ] Run bank-service/native SDK result/cancellation/selection/retry/security tests and existing Plaid tests. Verify Sandbox flows on Pixel; preserve separate production approval/RBC-live gates. Commit.

## Task 15 — Native settings, device management, About and parity closure

**Files:** preference-store/mobile owner preference/device endpoints; native ReportingPreferencesRepository.kt, ui/settings/, ui/accounts/devices/, ui/about/, encrypted revocation-only outbox; existing web preference hooks; preference/device/parity tests.

**Consumes/produces:** Tasks 4–14; completes F01/F14–F18, shared report preferences and native sign-out/device/capture management.

- [ ] Write failing cross-client preference tests for timezone/week start/preferred summary currency, revision races, unsupported values and actual persisted refresh. Defaults remain America/Toronto/Monday; changing a preference does not silently reinterpret original notification instants.
- [ ] Implement shared ledger preferences in Worker and both clients. Preferred currency controls focus/order without inventing FX rates; theme/filter/motion choices remain device-specific in DataStore and work on Login as well as Settings.
- [ ] Implement native capture consent/renew/pause/source test, approved source/currency mappings, device list/revocation and separated owner/capture expiry. Another-device revocation requires recent owner approval; old queued events preserve UUID/time but need newly approved upload scope.
- [ ] Implement explicit sign-out and pending offline revocation behavior, session recovery and identity/profile/help/reporting-rule information. Retain encrypted same-ledger pending uploads; no signed-out financial-cache exposure.
- [ ] Implement native About and optional clearly labeled isolated sample ledger corresponding to the public website introduction. Demo never contacts real providers, enables capture or replaces an authenticated error state.
- [ ] Through Impeccable, finish every settings/device/help theme/state and keyboard/Back/large-font path. Re-read the website inventory; maintain a parity ledger with one reachable native path and test for every F01–F18 row. A newly added website function without an Android equivalent remains a release blocker.
- [ ] Run preference/device/logout/demo-isolation and cross-client parity tests; verify persisted settings and complete native navigation on Pixel. Commit.

## Task 16 — Add CMB only after its independent source gate

**Files:** `parser/CmbCreditCardParser.kt` or a separately verified debit parser, source registry/profile configuration, synthetic fixtures and CMB validation notes. Shared Worker logic changes only if new documented event semantics require it.

**Consumes/produces:** Working BOC path plus real CMB sample/capability report; produces a supported source profile or a clearly labeled unsupported/not-yet-verified state.

- [ ] Confirm whether CMB is credit/debit and whether the intended channel is its WeChat account, CMB app or Palm Life app. Research supports credit-card channels; no debit-format promise follows from that notice.
- [ ] Repeat Task 1 capture tests for actual CMB fields/time. Compare WeChat versus bank-app visibility and enroll one primary source per instrument initially.
- [ ] Write source-specific tests for purchase/cancel/failure/refund/repayment/FX fields and event time. Never point CMB payloads at a BOC regex or assume the same card/account suffix identifies an instrument.
- [ ] Implement and expose through approved pairing scope when tests pass. If source evidence is missing/generic, leave the adapter disabled and explain the needed source in Connections; BOC release can proceed with this limitation explicit.
- [ ] Run parser + shared lifecycle/ingestion tests and real Pixel capture. Record supported templates/known gaps and commit only verified support.


## Task 17 — Full-parity visual verification, signed release and recovery

**Files:** Android CI/release workflows, backup rules, validation/parity runbook, android/DESIGN.md, README and required existing CI/security hooks.

**Consumes/produces:** Tasks 0–15 plus verified/explicitly unavailable conditional CMB outcome; produces F01–F18 acceptance evidence, Impeccable verdict, signed APK/checksum/fingerprint and actual install/update/recovery results.

- [ ] Run existing npm typecheck/test/build and pinned Android lint/unit/build variants in CI; add relevant emulator/instrumented checks without replacing Pixel source testing. Secure signing material in owner custody/protected CI secrets; verify stable package/registered App Link fingerprint.
- [ ] Verify packaged release with apksigner and checksum; inspect allowed origins/manifest/service permissions and separate owner/capture authorization. No debug probe, credential logging or source samples appear in the release.
- [ ] Walk every F01–F18 row on Pixel: animated login/session/logout; reports/charts; search/filter/detail; native file preview/commit/review and full CSV export; recurring/detail/classification; official Link/account selection/sync/disconnect; shared reporting prefs/theme/devices/capture/About. No placeholder or website feature-page detour counts as completion.
- [ ] Run one batched Impeccable review across all complete screens/overlays in Light/Dark/System, 200% fonts/narrow/Pixel sizes, TalkBack/IME, adverse states and login static reduced-motion/Battery Saver. Record actual motion frame timing and identity/provider returns. Fix once and perform at most one confirmation batch; document final native design/verdict.
- [ ] Execute synthetic end-to-end money/time/reconciliation and full parity fixtures on native/web. Include owner refresh/callback replay, offline/logout revocation, remembered-cache expiry, capture through ordinary owner expiry versus explicit logout, interrupted import and theme change. Both clients agree on authoritative totals/records.
- [ ] Verify category/note edit/save, validation/network failure and concurrent revision conflict end to end on native and web. Refresh both clients to confirm saved values and unchanged source evidence/report amounts. Preserve authorized drafts across theme change and reauthentication; expose no financial edit state after explicit sign-out.
- [ ] Install signed APK via actual route, verify listener/restricted settings, enqueue offline, upgrade with same signing key/new version code and reconnect. Credentials, queued identity and original event times survive a normal update.
- [ ] Rehearse populated sandbox migration/export/restore and invalidate restored owner-session/capture grants before re-pair/login; restoration cannot resurrect revoked devices. Document database/signing-key recovery and known source gaps.
- [ ] Verify current direct-install rules for actual region/OS and native/Plaid redirect registrations. Prepare exact tested production changes only after sandbox identity/auth/currency/import/reconciliation/full-parity checks; maintain distinct Plaid/RBC production prerequisites.
- [ ] When implementation/release is requested, deliver the private signed APK/checksum/version with installation/renewal instructions, all-feature acceptance record, source limitations and theme/motion evidence. Commit release/runbook slice.

## Completion and verification matrix

| Requirement | Owning tasks | Acceptance evidence |
|---|---|---|
| Signed Pixel app and usable WeChat source | 1, 5, 7, 17 | Actual notification callback/fields and signed install |
| All registered ISO currencies, repeated purchases and safe lifecycle | 2, 3, 6, 8, 10, 11 | Registry/populated migration/state matrix/statement comparison |
| Original midnight equals new local transaction day | 2, 6, 7, 10, 11 | Exact timestamp/reconnect/confirmation assertions |
| Genuine animated login and secure owner sessions | 4, 5, 11, 17 | Access return/PKCE/App Link/rotation/revocation tests and motion record |
| Every website function F01–F18 | 10–15, 17 | Feature inventory, reachable native paths and native/web fixture comparisons |
| Native import/commit/export beyond page limits | 10, 12 | File/row identity, staged visibility/resume and complete CSV comparison |
| Recurring estimates/actual cost/history/classification | 13 | Source snapshot and all native recurring state/action tests |
| Native Plaid connect/selection/refresh/disconnect | 4, 14 | Official SDK Sandbox plus owner-scope/cancel/retry/revocation checks |
| Shared report settings and native device/logout/help | 15 | Persistence/cross-client/revision/logout/demo-isolation tests |
| All-app System/Light/Dark, reduced motion | 5, 11, 12–15, 17 | Role/contrast/state tests and batched genuine native screenshots/motion |
| Scoped private capture and offline delivery | 4–9, 17 | Unrelated-message/encryption/token-boundary/lost-ack/restart/renewal tests |
| Conditional CMB support | 1, 16 | Independent actual payload; otherwise explicit limitation |
| Recovery and signed update | 3, 5, 17 | Populated-copy restore, no revived grants and queue-preserving update |

## Handoff

Recommended execution is native task-by-task work with an independent final review, because financial lifecycle, timestamp and migration interfaces are closely coupled. Delegated execution remains an option if the user requests it. This turn produces planning artifacts only.

The first concrete deliverable is the Task 1 feasibility APK and field inventory on the Pixel. The architecture is actionable now, while exact BOC/CMB notification templates, statement layouts, installed OS and source timezone remain explicit discovery evidence rather than invented facts. Never claim complete monitoring or final release acceptance until the corresponding hardware and reconciliation checks have been performed.

## Planning review history

Revision 1's fresh builder check resolved initial fingerprint/lifecycle/account/time/gate/source-authority gaps and checked its fourteen tasks. Revision 2's fresh builder check reviewed native owner authentication, all website functions, themed login motion and whole-app dark mode. Its category/note editing finding is resolved explicitly in Tasks 11 and 17; the final pass also specifies pending provider-item cleanup and revocation-only offline logout capabilities. Artifact verification covers 18 sequential tasks, 18 feature-parity rows, 20 bank-event cases, retained notification-time rules and document consistency. These are planning checks; no application build, hardware capture or product test is claimed.

