# Task 6 report — bounded Android extraction/parser/tracker

Date: 2026-10-13  
Status: HANDOFF_BLOCKED / DONE_WITH_CONCERNS

## Scope delivered

The bounded Task 6 slice was added only under the requested Android capture/parser areas:

- Production: `android/app/src/main/java/com/lofuyu/borderledger/capture/SourceProfile.kt`
- Production: `android/app/src/main/java/com/lofuyu/borderledger/capture/NotificationExtractor.kt`
- Production: `android/app/src/main/java/com/lofuyu/borderledger/capture/ObservationTracker.kt`
- Production: `android/app/src/main/java/com/lofuyu/borderledger/parser/BankAlertEventInput.kt`
- Production: `android/app/src/main/java/com/lofuyu/borderledger/parser/BankAlertParser.kt`
- Production: `android/app/src/main/java/com/lofuyu/borderledger/parser/CurrencyRegistry.kt`
- Production: `android/app/src/main/java/com/lofuyu/borderledger/parser/BocCreditCardParser.kt`
- Synthetic tests/fixtures: `android/app/src/test/java/com/lofuyu/borderledger/capture/SyntheticNotificationFixtures.kt`
- Synthetic tests: `android/app/src/test/java/com/lofuyu/borderledger/capture/NotificationExtractorTest.kt`
- Synthetic tests: `android/app/src/test/java/com/lofuyu/borderledger/capture/ObservationTrackerTest.kt`
- Synthetic tests: `android/app/src/test/java/com/lofuyu/borderledger/parser/SyntheticBocCreditCardParserTest.kt`

The code is bounded to scalar notification evidence, profile/package/channel/sender/type checks, deterministic observation identity, replay/summary/child/reused-key/reconnect handling, explicit event-time and money parsing, and Task 2 DTO mapping. Generic or screenshot-only rich content remains unsupported/NeedsReview; no raw payload persistence/logging, production listener, network/outbox, AccessibilityService/SMS/UI scraping, or Task 7 wiring was added.

## TDD and verification evidence

1. Tests/fixtures were written first for extractor rejection/acceptance, summary-child and reused-key behavior, replay/removal/recreation, parser result classes, CAD/CNY/USD/HKD money safety, lifecycle semantics, time provenance, duplicate review, and equal-success distinctness.
2. RED attempt, run from `android`:

   `& '.\gradlew.bat' :app:testDebugUnitTest --tests '*NotificationExtractorTest' --tests '*ObservationTrackerTest' --tests '*SyntheticBocCreditCardParserTest'`

   Exit code `1`; exact blocker: `UNC paths are not supported. Defaulting to Windows directory.` followed by `Gradle wrapper JAR is missing. Generate it with a trusted Gradle 8.13 installation before building.` No Kotlin compilation or test assertions ran.
3. After the bounded production implementation was added, the same focused command was rerun. Exit code `1` with the same UNC-path and missing-wrapper-JAR blocker. This is not a GREEN/acceptance result.
4. Existing Task 5 boundary check:

   `& '.\task5-static-check.ps1'`

   Exit code `0`: `TASK5_STATIC_OK production_manifest=ok debug_probe_isolated=ok crypto_storage=ok auth_boundaries=ok ui_motion_onboarding=ok synthetic_tests=present`.
5. Bounded Task 6 source check: exit code `0`, exact result `TASK6_STATIC_OK bounded_sources=present no_listener_or_network=present dto_excludes_raw_payload=present synthetic_tests=present deterministic_identity=present`.
6. Bounded process check: exit code `0`, exact result `NO_GRADLE_NATIVE_PROCESS_RUNNING`.

## Limitations and handoff concerns

- `gradle`, `kotlinc`, `adb`, and the Gradle wrapper JAR are unavailable in this workspace. A Java executable is present, but that is insufficient for Android/Kotlin verification.
- Kotlin compilation, Android unit-test execution, Pixel/emulator capture, real BOC/source acceptance, and source-profile acceptance were not performed and must not be inferred from the static checks.
- The synthetic fixtures contain no real/private notification payloads. The implementation remains unverified against actual OS/source payload behavior.
- No production capture wiring, outbox, network upload, listener service, AccessibilityService, SMS path, or UI scraping was added.
- Git metadata is unavailable in this workspace, so no commit or diff-based acceptance claim is made.

## Task boundary

Tasks 0–5 and their debug/production boundaries were preserved. No reset, revert, or unrelated file change was performed by this handoff.
