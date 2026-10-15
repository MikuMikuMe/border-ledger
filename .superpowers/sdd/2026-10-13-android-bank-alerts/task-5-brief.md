# Task 5 — encrypted native storage, owner login, and capture onboarding

## Scope

Build the production Android foundation on top of the debug probe and accepted Worker auth/pairing boundaries: encrypted local persistence, owner-session state, separate capture credentials, verified callback handling, login/onboarding UI, appearance/motion primitives, and explicit logout/cache policy. Preserve the debug probe as debug-only and do not claim an APK, device, or Pixel result without the unavailable Android toolchain/hardware.

## Files and boundaries

Own `android/app/src/main/java/com/lofuyu/borderledger/**`, production manifest/build configuration, Android unit tests, and synthetic validation notes. Keep owner and capture providers/stores separate; do not put raw credentials, financial fixtures, screenshots, or real callback values in source. Do not implement Task 6 parser/listener, broad feature parity, or Worker route behavior beyond the already accepted Task 4 contracts.

## Required behavior (tests first)

- Owner session state: login return/cancel/expiry/offline/unapproved identity, duplicate callbacks, process death during exchange/rotation, lost-response replay, single-flight refresh, remembered-grant expiry, pending destination restoration, and idempotent rotation metadata. Owner access/refresh and capture credentials use separate canonical environment/origin providers and interceptors.
- Encryption: Keystore-protected key material; encrypted Room/SQLCipher-compatible local store for owner/refresh/capture credentials, financial read cache, normalized evidence, and outbox. Wrong key/storage failure fails closed with no plaintext fallback or destructive reset. Exclude financial DB/cache/credentials from backup/transfer; preserve same-ledger unsent encrypted events across logout and normal upgrade.
- Callback/login: verified HTTPS App Link host/path/state, recoverable failed/cancelled return, no token/code/state logging, and no claim of sign-in until exchange is committed. Animation never gates auth; System/Light/Dark setting survives configuration/theme changes.
- Login UI: authored flowing ink backdrop with steady controls, 16–24 second cycle, 100–150 ms routine feedback/150–300 ms transitions, static reduced-motion/Battery Saver path, paused when hidden/backgrounded. Apply Border Ledger identity and accessible Material structure through Impeccable guidance.
- Capture onboarding: explicit source/profile/instrument/currency consent, narrow hash-only credential issuance, separate app-posting notification permission versus notification-listener access, permission/resume/source-test health state, and no silent capture opt-in after owner login.
- Logout: pause monitoring; clear/hide owner/read cache; retain encrypted unsent same-ledger evidence; queue revocation-only intent offline; expose pending state; never let capture credential authorize owner reads/mutations or let a stale revocation remove a newly issued grant.

## Verification/report

Write `.superpowers/sdd/2026-10-13-android-bank-alerts/task-5-report.md` with TDD RED/GREEN evidence, static checks, toolchain/hardware limitations, changed files, and concerns. Run direct Kotlin/source checks if available; Gradle/ADB/Pixel checks are expected to be blocked on this host and must be recorded precisely. Return under 15 lines with status/report path.
