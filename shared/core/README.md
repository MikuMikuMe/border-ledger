# Border Ledger common core

Gradle project `:sharedCore` is registered by `android/settings.gradle.kts`. It uses Kotlin 2.4.21 and Google's AGP 9.2.1 Android-KMP library plugin with Java 17, Android SDK 37/min 26, `iosArm64`, and `iosSimulatorArm64`. Each iOS target declares a static `BorderLedgerCore` framework for the later macOS link gate.

The common source owns the existing ledger read models, transaction filtering/confirmed totals, owner auth API models, session state, and `OwnerSessionCore` orchestration. Existing Kotlin package names are retained so Android callers use the same types without translation. Monetary values remain native `Long`; use `minorUnitsToDecimalString` at the future bridge boundary. Dates and timestamps remain the existing ISO strings. No backend DTO field or endpoint is changed.

`OwnerLoginClient` is the typed auth HTTP port; `OwnerSessionStore`, `CaptureCredentialProvider`, and `LocalDataPolicy` are native secure storage/logout ports. `CoreClock` and `CoreCrypto` supply platform time/ISO parsing and cryptography. `HttpPort`, `SecureRecordPort`, `BrowserPort`, and `FilePort` define the lower-level native adapter contracts for later consumers. Browser launch and files remain Android-owned; file handles are opaque and reads are bounded native chunks, not JavaScript document blobs. Android `EncryptedRecordStore` implements `SecureRecordPort` while its existing codecs remain native.

`OwnerSessionManager` is the Android adapter around the common state machine. URI origin/parameter validation remains inside the state machine's mutex through a native validation callback. The original timeout, persistence order, refresh single-flight, persisted refresh idempotency key, callback marker, unchecked stay-signed-in input, destination consumption, revocation queue, capture pause, and outbox retention rules are retained. Native credentials/PKCE/token records are not bridge models: Task 3 must expose only non-secret session snapshots and never serialize these records into JavaScript.

`ownerRead` performs one authorized repository read and maps existing offline/unauthorized/unavailable outcomes, invoking native cache invalidation before publishing an authorization failure. It has no retry loop and is used by Android report/activity reads. Financial writes and lost-promise reconciliation remain later bridge work; do not replay writes to reconstruct a JavaScript promise.

All installed Android bytes remain owned by `EncryptedOwnerSessionStore`, `EncryptedCaptureCredentialProvider`, `EncryptedOwnerReadCache`, `EncryptedOutboxDao`, `FileEncryptedRecordStore`, and `AndroidKeyStoreVault`. This module must not replace their codecs, aliases, filenames, preference names/keys, device identity, or queue layouts with common serialization. Compatibility fixtures live under `android/app/src/test/resources/legacy-v1`.

From `android/`, with the specified D-drive SDK/caches and JDK 17:

```
gradlew :sharedCore:testAndroidHostTest :app:compileDebugKotlin :app:testDebugUnitTest
gradlew :sharedCore:compileKotlinIosArm64 :sharedCore:compileKotlinIosSimulatorArm64
```

Common tests execute as Android host tests, so no extra JVM target is needed. Kotlin 2.4.21 compiled both iOS KLIB targets on Windows during Task 2, while the simulator framework link was skipped on that host. A skipped link/test is not successful platform verification. The migration's later macOS 26/Xcode 26.4.1 CI gate must compile both and link `:sharedCore:linkDebugFrameworkIosSimulatorArm64`.
