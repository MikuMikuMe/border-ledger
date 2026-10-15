# Native Integration Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. This run stays in the user-requested shared workspace; do not create a replacement checkout or revert other workers' edits.

**Goal:** Make the existing Task 12–15 native implementations reachable from the signed-in Android shell with owner-authenticated repository construction and honest provider/device/service states.

**Architecture:** Keep Task 12 import/export and capture onboarding paths unchanged. Construct Task 13 recurring, Task 14 account/Plaid, and Task 15 preferences/device repositories in `AppContainer`; use a small connection view-model only for account list/sync/disconnect state, and route existing Compose screens through `LedgerShell` using local destination state rather than introducing a navigation dependency. Plaid remains an injectable `PlaidLinkLauncher`; the default launcher reports unsupported and never fabricates a provider result.

**Tech Stack:** Kotlin, Android Compose/Material 3, coroutines/StateFlow, existing owner-authenticated `MobileRequest`/`OwnerAuthInterceptor` boundaries, existing Worker mobile v1 routes, JUnit/coroutines test APIs, TypeScript/Vitest checks.

**Spec:** `docs/superpowers/plans/2026-10-13-android-bank-alerts.md`, Tasks 12–15, plus the user request for the final native integration surface.

## Global Constraints

- Preserve existing Task 12 import/export navigation and capture onboarding.
- Do not modify Worker routes, migrations, or core feature semantics.
- Every Worker-backed adapter uses `OwnerAuthInterceptor`; no provider access token/secret crosses into Android storage or UI.
- Plaid Link cancellation, unavailable SDK configuration, network/auth failures, and pending account selection remain explicit states; no fake success.
- Native screens expose loading, error, empty, stale/incomplete, and unsupported states where the underlying contracts provide them.
- Work in the shared checkout without resetting, overwriting, or reverting unrelated worker edits.
- Android Gradle validation is gated by the missing `android/gradle/wrapper/gradle-wrapper.jar`; report this precisely if still unavailable.

## Review Focus

- A signed-in shell route must not instantiate owner-backed repositories before the `OwnerSessionManager` boundary exists.
- A missing Plaid launcher must produce a visible unsupported state and must never call account exchange.
- A device response must retain source mappings/revision and send only owner-authenticated JSON to the existing device routes.
- Existing Task 12 Import/Export and capture setup routes must remain reachable after adding destinations.
- Bank list/sync/disconnect and recurring detail/classification actions must refresh or surface errors rather than showing optimistic success.

### Task 1: Adapter and container wiring

**Files:**
- Create: `android/app/src/main/java/com/lofuyu/borderledger/ui/accounts/devices/DeviceManagementRepository.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/bank/PlaidLinkCoordinator.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/AppContainer.kt`
- Test: `android/app/src/test/java/com/lofuyu/borderledger/ui/accounts/devices/DeviceManagementRepositoryTest.kt`

- [ ] Add failing tests for owner bearer/device JSON decoding and unsupported Plaid launcher behavior.
- [ ] Implement the narrow HTTP device adapter and unsupported-by-default injectable Plaid launcher.
- [ ] Construct recurring, account, Plaid coordinator, reporting-preferences, and device repositories from the existing owner session in `AppContainer`.
- [ ] Run focused tests where the Android toolchain permits; otherwise retain the test and record the Gradle gate.

### Task 2: Signed-in shell navigation and feature state

**Files:**
- Create: `android/app/src/main/java/com/lofuyu/borderledger/ui/accounts/connection/ConnectionViewModel.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerUiModel.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt`
- Modify: `android/app/src/main/java/com/lofuyu/borderledger/MainActivity.kt`
- Test: `android/app/src/test/java/com/lofuyu/borderledger/ui/ledger/LedgerDestinationTask12Test.kt`

- [ ] Add failing destination assertions for existing Task 12 Import/Export plus recurring detail, bank connections, devices, settings, and About.
- [ ] Wire remembered recurring list/detail view-models, account/Plaid coordinator, connection view-model, settings view-model, and device view-model into the shell.
- [ ] Add account sub-navigation actions while keeping primary bottom navigation bounded; preserve capture setup and Task 12 picker callbacks.
- [ ] Add bank list/sync/disconnect controls and route existing ConnectionScreen through the coordinator, with truthful loading/error/unsupported states.
- [ ] Route recurring detail and classification back/save flows, settings preference state, device revocation, capture setup, and About.
- [ ] Run TypeScript/static checks and the available Android-focused checks; report Android Gradle limitation.

### Task 3: Final verification

**Files:** Existing changed files only.

- [ ] Inspect the final source set for Worker/migration changes and provider-secret exposure.
- [ ] Run `npm run typecheck`, `npm test`, and `pwsh -NoProfile -File android/task17-static-check.ps1` from a supported local working directory.
- [ ] Attempt the pinned Android Gradle command only if the wrapper JAR/SDK are available; otherwise record the exact limitation.
- [ ] Report exact files changed, checks/results, and any remaining unsupported runtime boundary.
