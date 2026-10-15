# Task 5 report — Android review-finding follow-up

Date: 2026-10-13  
Status: **DONE_WITH_CONCERNS / scoped review findings fixed**

## Findings fixed

- Added the missing `compose-foundation` version-catalog alias. The existing `implementation(libs.compose.foundation)` now resolves through the Compose BOM; no version override was introduced.
- Capture onboarding now reads the injected `OwnerSessionManager` state through `OwnerSessionStateProvider`. `AppContainer` uses `HttpWorkerCaptureApi` by default, with explicit API-health state; `UnavailableMobileApi` remains only a fail-closed test double.
- Replaced the source-test “record Passed” button with a request that remains `Awaiting` or `Unavailable`. Only `SourceTestEvidence` matching the selected source/profile, account, and currency can produce `Passed`; app-posting permission remains separate from notification-listener access.
- Serialized encrypted outbox enqueue, batch/read, acknowledgement, purge, and count operations with one `Mutex`, preserving read-modify-write atomicity under concurrent callbacks.
- `OwnerSessionManager.accessToken()` now uses the existing mutex-protected refresh path. `OwnerAuthInterceptor` therefore refreshes expired access once and still fails closed when refresh is offline/unauthorized; capture continues through its separate interceptor.
- `LoginFlowBackdrop` derives ribbon/rule colors from `MaterialTheme.colorScheme`, preserving its 18-second cycle, reduced-motion fallback, and lifecycle visibility pause.

## TDD/static evidence

The bounded regression check was intentionally run RED before implementation:

```text
Command: powershell -NoProfile -ExecutionPolicy Bypass -File .\android\task5-static-check.ps1
Exit code: 1
Compose Foundation catalog alias is missing.
```

After the scoped changes, the same check ran GREEN:

```text
Exit code: 0
TASK5_STATIC_OK production_manifest=ok debug_probe_isolated=ok crypto_storage=ok auth_boundaries=ok ui_motion_onboarding=ok synthetic_tests=present
```

Additional bounded checks ran GREEN:

```text
SOURCE_TEST_UI_OK awaiting_without_user_asserted_pass
AUTH_OUTBOX_STATIC_OK refresh_single_flight=present outbox_mutex=present
```

New/adjusted Kotlin regressions are present for signed-out capture gating, evidence-gated source tests, blocked app-posting permission remaining separate, owner-interceptor single-flight refresh, and concurrent outbox enqueue. They were not compiled or executed because the Android toolchain is unavailable here.

## Exact toolchain and hardware limitation

```text
Command: .\gradlew.bat :app:testDebugUnitTest
Exit code: 1
'\\raidrive-aa207\WebDAV\Projects\Personal-Finance\android'
CMD.EXE was started with the above path as the current directory.
UNC paths are not supported.  Defaulting to Windows directory.
Gradle wrapper JAR is missing. Generate it with a trusted Gradle 8.13 installation before building.
```

No Gradle compilation, Android unit-test execution, APK build/install, ADB/emulator run, or Pixel result is claimed. No Task 6/7 parser, listener, or production notification service was added; a real source test remains visibly Awaiting/Unavailable until a later listener event supplies evidence. No debug/probe files, Tasks 0–4 files, web files, Worker files, or unrelated Android files were edited.

## Changed files

- `android/gradle/libs.versions.toml`, `android/task5-static-check.ps1`
- `android/app/src/main/java/com/lofuyu/borderledger/api/OwnerLoginClient.kt`, `MobileDtos.kt`, `HttpWorkerCaptureApi.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/AppContainer.kt`, `MainActivity.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/auth/OwnerSessionManager.kt`, `CaptureOnboarding.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/local/OutboxDao.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/login/LoginFlowBackdrop.kt`, `ui/onboarding/CaptureOnboardingScreen.kt`
- `android/app/src/test/java/com/lofuyu/borderledger/auth/OwnerSessionManagerTest.kt`, `CaptureOnboardingCoordinatorTest.kt`, `local/OutboxConcurrencyTest.kt`
