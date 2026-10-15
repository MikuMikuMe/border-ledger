# Task 7 report — production notification listener and durable intake

## Latest blocker resolution — 2026-10-13

- Capacity now counts only unacknowledged outbox event identities, `REVIEW` candidate identities, and eventless review observations. Acknowledged/confirmed candidates and eventful replay metadata do not consume the cap; the encrypted state write remains atomic and non-evicting.
- Added regressions for acknowledgement/confirmation capacity release and duplicate event IDs across distinct observations; existing 5,000/5,001 cap coverage remains in place. Same canonical event content is `AlreadyProcessed`; changed content is `Conflict` without a second candidate/outbox row.
- `EncryptedOutboxDao.nextBatch` now enforces `CaptureIntakeLimits.MAX_BATCH_EVENTS` (50). Its concurrency test reads 101 events through multiple bounded batches and acknowledges each batch.
- TDD RED test execution was attempted before the production fix but is blocked before compilation: the UNC workspace is unsupported by `cmd.exe`, and `android/gradle/wrapper/gradle-wrapper.jar` is absent. No native GREEN result is claimed.
- Bounded source check passed: `TASK7_SCOPED_STATIC_OK cap_identity_filters=ok duplicate_event_identity=ok outbox_batch_ceiling=50 regressions=present`. The older Task 5 checker remains blocked by its existing `NotificationListenerService` forbidden-pattern rule, which conflicts with the required production listener boundary.

Date: 2026-10-13  
Status: **P1_GAP_FIXED / STATIC_ONLY**

## P1 scheduler gap fixed

1. `WorkManagerCaptureUploadScheduler` now routes through `RetryingCaptureUploadScheduler`. A `WORK_MANAGER_UNAVAILABLE` result or thrown scheduler exception is converted into the same explicit failure result, records `CaptureHealthState.Upload.RETRY_PENDING` with attempt/max/next-retry metadata, and starts an automatic capped retry.
2. The retry policy performs at most three automatic attempts with bounded exponential backoff (5 s, 10 s, 20 s). Success clears retry metadata and reports `SCHEDULED`/`READY`; exhaustion stops scheduling and reports `RETRY_EXHAUSTED` with `work_manager_unavailable` so the failure remains visible.
3. Listener reconciliation now observes the scheduler result and records unexpected scheduler exceptions/failures instead of treating them as a silent no-op. Existing reconciliation remains on listener connection, queued/replayed intake, and usable-credential transition; the delayed retry does not require another notification or connection.
4. The retry uses a bounded background coroutine. No foreground service or exact alarm was added. Once WorkManager accepts the unique network-constrained work, its existing persistence remains the upload boundary; a process restart still re-enters the existing connection/credential reconciliation path.
5. Task 8/9 remains a no-network `CaptureUploadWorker` stub returning `Result.failure()`.

## Existing boundaries retained

- Unknown private-chat context remains fail-closed before financial parsing, and the 5,000 retained-intake cap remains atomic and fail-closed without evicting unsent events.
- Listener activation still precedes active-notification recovery; queued and replayed observations use the same stable identity; expired capture credentials pause upload only, not local intake.
- No AccessibilityService, SMS, UI scraping, raw payload upload, network worker, exact alarm, perpetual foreground service, or debug-probe production wiring was added.

## TDD and verification evidence

1. The scheduler regression was written before the production retry implementation. Synthetic coverage now includes a returned failure followed by automatic success, a thrown transient failure followed by success, bounded exhaustion, and a real queued `BankNotificationIntake` reconciliation path.
2. RED/focused native attempt before implementation and final focused attempt:

   `& '.\gradlew.bat' :app:testDebugUnitTest --tests '*UploadSchedulerPolicyTest' --tests '*CaptureNotificationIntakeTest'`

   Exit code `1` before Kotlin compilation: `UNC paths are not supported. Defaulting to Windows directory.` followed by `Gradle wrapper JAR is missing. Generate it with a trusted Gradle 8.13 installation before building.` No GREEN assertion run is claimed.
3. Bounded source gate exited `0`:

   `TASK7_STATIC_OK retry_state=ok bounded_backoff=ok automatic_retry=ok listener_observes_failure=ok task8_9_stub_no_network=ok no_forbidden_retry_alarm=ok synthetic_regressions=ok`

4. Task 0–6 preservation gate exited `0`:

   `TASK0_6_PRESERVED_OK extractor=present tracker=present parser=present synthetic_tests=present`

## Changed files and limits

- `android/app/src/main/java/com/lofuyu/borderledger/sync/UploadScheduler.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/capture/BankNotificationListener.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/capture/CaptureHealth.kt`
- `android/app/src/test/java/com/lofuyu/borderledger/sync/UploadSchedulerPolicyTest.kt`
- `android/app/src/test/java/com/lofuyu/borderledger/capture/CaptureNotificationIntakeTest.kt`

Gradle, `kotlinc`, the Gradle wrapper JAR, `adb`, and Pixel/emulator execution are unavailable. No Kotlin compilation, native unit-test result, APK, device, real notification, or source-profile acceptance is claimed. No reset or revert was performed; Tasks 0–6 and the Task 8/9 no-network boundary were preserved.
