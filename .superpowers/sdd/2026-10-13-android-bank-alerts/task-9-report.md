# Task 9 report — upload/retry/cache synchronization

Date: 2026-10-13  
Status: **DONE_WITH_CONCERNS / STATIC_ONLY**

## Implementation

- Replaced the Task 7 `CaptureUploadWorker` no-op with an injectable, mutex-serialized `CaptureUploadCoordinator` used by the WorkManager worker and the owner-facing `LedgerRepository` seam.
- Kept the Task 7 unique `KEEP` WorkManager name and `CONNECTED` constraint; the notification listener still only schedules work and never performs HTTP.
- Added immutable, event-ID-validated JSON packing with 50-event and 128 KiB limits, no-store/capture-only HTTP, per-item 200 acknowledgement parsing, receipt/revision/error preservation, 401/403 pairing pause, 409 quarantine, 429/5xx/timeout/offline retry classification, bounded `Retry-After`, and exponential fallback.
- Unified the production upload DAO on `EncryptedCaptureIntakeStore`; acknowledgement state is durably written before the separate purge, missing acks stay queued, and rejection/conflict/review rows remain quarantined.
- Added owner-only cache read/write gates, lease-expiry clearing, capture-upload cache invalidation, health fields for last upload/cache snapshot/pairing renewal, and logout monitoring pause while retaining the encrypted queue.

## TDD/static evidence

RED was attempted after adding the focused Kotlin tests and before the implementation:

```text
Command: .\\gradlew.bat :app:testDebugUnitTest --tests '*UploadCoordinatorTest'
Exit code: 1
UNC paths are not supported. Defaulting to Windows directory.
Gradle wrapper JAR is missing. Generate it with a trusted Gradle 8.13 installation before building.
```

GREEN bounded checks:

```text
TASK9_STATIC_OK coordinator=injectable serialized=true batch=50 json=128KiB ack-before-purge=true partial-ack=true retry-classification=true pairing-pause=true cache-boundary=true logout-pause=true tests=present
TASK9_NOOP_AND_STATIC_OK
TASK9_LISTENER_BOUNDARY_OK no-http-in-callback=true scheduler-only=true
```

The final focused Gradle command was retried with `UploadCoordinatorTest`, `CaptureUploadHttpClientTest`, `LedgerRepositoryTest`, and the acknowledgement-persistence test; it hit the same pre-compilation blocker. `kotlinc`, standalone `gradle`, `adb`, emulator, and Pixel runtime evidence are unavailable. No Kotlin compilation, Android unit-test result, APK, device, or Pixel claim is made.

## Changed files

Production: `android/app/src/main/java/com/lofuyu/borderledger/api/CaptureUploadApi.kt`, `.../LedgerRepository.kt`, `.../AppContainer.kt`, `.../capture/CaptureHealth.kt`, `.../capture/NotificationIntake.kt`, `.../local/CaptureIntakeStore.kt`, `.../local/OutboxDao.kt`, `.../local/OwnerReadCache.kt`, `.../sync/UploadScheduler.kt`, `.../sync/UploadWorker.kt`, and `android/task9-static-check.ps1`.

Tests: `android/app/src/test/java/com/lofuyu/borderledger/sync/UploadCoordinatorTest.kt`, `.../api/CaptureUploadHttpClientTest.kt`, `.../LedgerRepositoryTest.kt`, and the focused acknowledgement test in `.../local/CaptureIntakeStoreTest.kt`.

No Worker/D1 files, Task 10+ files, commits, resets, or reverts were made.
