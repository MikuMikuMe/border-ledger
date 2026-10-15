# Native Review Destination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded owner-authenticated Android Review repository, revision-aware ViewModel/actions, and truthful Compose UI wired only into LedgerShell’s Review destination.

**Architecture:** Add a focused `review` package containing contract DTOs, a small injectable HTTP transport, strict bounded JSON decoding, and owner-interceptor-backed repository methods for alert reads, alert review decisions, and transaction annotation edits. The ViewModel treats server acknowledgements as authoritative, refreshes after mutations, preserves rows on failures/conflicts, and exposes exact disabled reasons when the snapshot lacks an event/transaction revision. LedgerShell receives the repository through existing constructor wiring; only its Review branch/imports/parameter are changed, while a separate ReviewScreen owns the new UI.

**Tech Stack:** Kotlin, Android Compose/Material 3, coroutines/StateFlow, `org.json`, existing `MobileRequest`/`OwnerAuthInterceptor`, JUnit/coroutines test APIs, PowerShell static evidence.

**Spec:** `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md`, Task 11 requirements, the existing `contracts/mobile-v1.openapi.yaml` alert/review/annotation routes, and the user-provided Review-only scope.

## Global Constraints

- Owner Review requests use the existing short-lived owner session and `OwnerAuthInterceptor`; capture credentials never authorize Review reads or mutations.
- Alert pages are bounded to the contract’s maximum 100 items; malformed, unknown, empty, or oversized responses are rejected without inventing rows or amounts.
- Every mutation sends the caller’s `expectedRevision`; a local revision mismatch and a Worker `409` leave the attempted change unapplied and retain/refresh authoritative data.
- A mutation is successful only after a valid `200` `RevisionAck` is decoded; transport errors, malformed acknowledgements, unavailable routes, and refresh failures never become fake success.
- Existing snapshot review rows are render-only because `LedgerSnapshot.ReviewItem` lacks alert event identity/revision and transaction revision; actions must show exact disabled reasons instead of no-op callbacks.
- LedgerShell changes are limited to Review imports/constructor wiring and the `ReviewDestination` call/body; device, export, import, recurring, and other destination sections remain untouched.
- Do not modify Worker routes, migrations, or the existing snapshot contract in this Android-only slice; report that the current Worker checkout lacks the owner Review route branches if it remains so.
- The shared WebDAV checkout has no usable Git `HEAD`/`config`; preserve all existing edits and do not claim commit/diff-based verification.

## Review Focus

- Malformed or over-bounded `AlertView`/page JSON must fail closed rather than render partial financial data — `ReviewRepositoryTest.decodeRejectsMalformedOrOversizedAlertPage`.
- `GET /api/mobile/v1/alerts` must be owner-authorized while capture `POST /api/mobile/v1/alerts` remains rejected by the owner interceptor — `OwnerSessionManagerTest.ownerCanReadAlertsButCannotPostCaptureAlerts`.
- A stale local revision or Worker `409` must not remove or rewrite the alert; the ViewModel must surface conflict and refresh the authoritative page — `ReviewViewModelTest.conflictRetainsRowsAndRefreshesAuthoritativePage`.
- A malformed `200` acknowledgement or offline/unavailable response must not produce a saved message — `ReviewRepositoryTest.malformedAckIsNotSuccess` and `ReviewViewModelTest.offlineActionDoesNotClaimSuccess`.
- Snapshot-only review rows must expose exact disabled reasons for alert decisions and annotation because their event/transaction revisions are absent — `ReviewScreen` static evidence and `ReviewViewModelTest.snapshotActionGateReasonIsExplicit`.

---

### Task 1: Review contract DTOs, repository, and owner route boundary

**Files:**
- Create: `android/app/src/main/java/com/lofuyu/borderledger/review/ReviewRepository.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/auth/CredentialInterceptors.kt`
- Modify: `android/app/src/test/java/com/lofuyu/borderledger/auth/OwnerSessionManagerTest.kt`
- Create: `android/app/src/test/java/com/lofuyu/borderledger/review/ReviewRepositoryTest.kt`

**Interfaces:**
- Produces `ReviewAlertDto(eventId, eventType, state, countedMoney, reportingDate, revision)`, `ReviewPageDto(items, nextCursor, limit)`, `ReviewDecision`, `ReviewRelation`, `ReviewMoney`, `ReviewRevisionAck`, `ReviewRepository`, `ReviewHttpTransport`, and `ReviewRevisionConflict`/unavailable/error types.
- `OwnerReviewApi.readAlerts(cursor, limit)`, `reviewAlert(eventId, expectedRevision, decision, targetId, relation, allocatedMoney)`, and `annotateTransaction(transactionId, expectedRevision, category, note)` all remain suspendable and injectable for ViewModel tests.

- [ ] **Step 1: Write failing tests** for strict alert-page DTO decoding, exact alert/annotation request JSON bodies, valid revision acknowledgement parsing, malformed acknowledgement rejection, `409 currentRevision` mapping, bounded paging, and owner GET-alert versus capture POST-alert interceptor behavior.
- [ ] **Step 2: Run the focused Android test command** `& '.\gradlew.bat' :app:testDebugUnitTest --tests '*ReviewRepositoryTest' --tests '*OwnerSessionManagerTest'`; record the expected missing-wrapper/UNC limitation if compilation cannot start.
- [ ] **Step 3: Implement `ReviewRepository.kt`** with strict bounded `ReviewJson` decoding, owner-intercepted GET/PATCH requests, URL-segment encoding, exact body construction for all three contract routes, 15-second IO transport, response-size caps, and typed mapping for offline/unauthorized/unavailable/revision-conflict/retryable/malformed failures.
- [ ] **Step 4: Change only `OwnerAuthInterceptor`’s alert path rule** so `GET /api/mobile/v1/alerts` is an owner route while non-GET alert capture requests remain forbidden; keep all other credential boundaries unchanged.
- [ ] **Step 5: Re-run the focused tests/static source checks** and confirm no repository method reports success without a valid decoded acknowledgement.

### Task 2: Revision-aware ViewModel and Review-only UI/wiring

**Files:**
- Create: `android/app/src/main/java/com/lofuyu/borderledger/review/ReviewViewModel.kt`
- Create: `android/app/src/main/java/com/lofuyu/borderledger/ui/review/ReviewScreen.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/AppContainer.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/MainActivity.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt` (imports, constructor parameter, and ReviewDestination area only)
- Create: `android/app/src/test/java/com/lofuyu/borderledger/review/ReviewViewModelTest.kt`

**Interfaces:**
- Consumes the Task 1 `ReviewRepository` and `ReviewAlertDto` interfaces.
- Produces `ReviewViewState`, `ReviewViewModel.refresh()`, `resolve(alert, decision)`, and `saveAnnotation(transactionId, expectedRevision, category, note)`; UI consumes the StateFlow and action methods.

- [ ] **Step 1: Write failing ViewModel tests** for local stale-revision rejection without an API call, successful acknowledgement followed by authoritative refresh, `409` conflict retention/refresh, offline error without success text, and explicit snapshot gate reason.
- [ ] **Step 2: Run the focused ViewModel test command** `& '.\gradlew.bat' :app:testDebugUnitTest --tests '*ReviewViewModelTest'`; record the exact environment blocker if the wrapper cannot run.
- [ ] **Step 3: Implement `ReviewViewModel.kt`** with bounded page replacement/load-more state, one in-flight action per row, expected-revision guards, no local canonical mutation before acknowledgement, refresh after success/conflict, retained drafts/action errors, and exact transport/conflict messages.
- [ ] **Step 4: Implement `ReviewScreen.kt`** with loading/error/empty/refresh states, enabled Keep separate/Ignore actions only for authoritative `needs_review` alerts, visibly disabled Link/Classify actions when required target/classification data is absent, and an explicit annotation-disabled reason when only the snapshot model is available; do not attach no-op callbacks.
- [ ] **Step 5: Add only Review constructor wiring**: construct the owner Review repository in `AppContainer`, pass it through `MainActivity` to `LedgerShell`, create/remember the ViewModel, and replace only the existing ReviewDestination placeholder body/call. Do not edit device/export/import/recurring branches.
- [ ] **Step 6: Run focused tests/static boundary checks** and inspect the LedgerShell diff textually to verify unrelated destination sections are unchanged.

### Task 3: Bounded static evidence and final verification

**Files:**
- Create: `android/task-review-static-check.ps1`
- Existing changed files only for verification.

- [ ] **Step 1: Add a static check** that asserts the review package, owner GET-alert allowance, all three exact route strings, expectedRevision handling, conflict/error state strings, snapshot gate copy, AppContainer/MainActivity wiring, and Review-only LedgerShell markers exist; assert capture/device/export/import/recurring route text is not added to the new review package.
- [ ] **Step 2: Run `pwsh -NoProfile -File android/task-review-static-check.ps1`** and read the full result.
- [ ] **Step 3: Run available project checks**: `npm run typecheck`, focused Worker contract/static checks if practical, and the Android Gradle command only if the wrapper JAR/toolchain is available; report exact failures rather than inferring native compilation or Pixel acceptance.
- [ ] **Step 4: Re-read the plan and changed-file list**, record limitations (including absent Worker route branches, missing Gradle wrapper JAR, and absent device evidence), and hand off the exact changed files.
