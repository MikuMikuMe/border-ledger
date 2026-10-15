# Task 1 — Prove capture on the Pixel before committing to parsers

## Scope

Create the smallest debug-only Android capture probe and the sanitized validation record. Do not implement production parsers, upload, financial projections, or real-source fixtures.

## Files

Android build/application skeleton, `debug/NotificationProbeScreen.kt`, `debug/ProbeNotificationListener.kt`, `android/PRODUCT.md`, and `docs/android-validation.md`. Keep debug package/application separate from the future production install and exclude raw notification payloads from persistent storage/logs.

## Requirements

- Record installed Android/WeChat versions, source conversation identifiers/packages, CMB channel/account availability, and actual BOC credit/debit export options only when the user/device supplies them. In this host, explicitly record unavailable facts; do not invent them or copy private screenshots/transactions.
- Use Impeccable Android/Operate guidance: Material structure, 48 dp targets, labels that work without color, static/reduced-motion/Battery Saver path. The probe’s synthetic parser/demo state must be visibly labeled synthetic.
- Pin a coherent stable Gradle/AGP/Kotlin/Compose/SDK toolchain in the Android project. Because this host currently has Java 21 but no Gradle, Android SDK, ADB, or caches, do not claim the versions build; document the exact missing verification.
- Implement a debug probe screen showing permission/listener state and bounded scalar preview fields only, with an explicit sanitized local export action. Memory-only payload handling; no network, database, screenshot/raw-body persistence, accessibility service, root, READ_SMS, exact alarm, or perpetual foreground service.
- Declare a notification listener service protected by `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`, with no production wiring. Copy only bounded scalar fields off the callback thread; no network/DB work on the callback thread.
- Provide unit-testable sanitization/preview behavior and write tests before production code. Tests may be present but cannot be executed until the Android toolchain is available; record that limitation honestly.
- Document the required Pixel verification matrix: locked/unlocked, WeChat foreground/background, silent/muted, content-preview settings, permission revoke/regrant, reconnect; compare `sbn.postTime`, individual message timestamp if accessible, callback time, and user clock. State that no such evidence exists in this session.
- Gate automatic capture on approved source/type, labeled amount/currency, resolvable instrument, and original individual posting time. Generic/redacted/untimestamped payloads must be unsupported/review-only; if both WeChat and BOC app are unproven, mark import-only and acceptance unmet.

## Authority/constraints

Use `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md` and the approved plan as authority. The phone is only a best-effort source; screenshots do not prove accessible notification fields. No raw financial data, credentials, signing material, or private source samples enter files/logs.

## Report

Write the full report to `.superpowers/sdd/2026-10-13-android-bank-alerts/task-1-report.md`, including TDD RED/GREEN evidence, exact build/install/device commands and output, files changed, and unresolved hardware/toolchain gates. No Git commit can currently be created; do not claim one. Return under 15 lines with status, commit-unavailable note, one-line tests/build, concerns, and report path. If source/hardware evidence is unavailable but the safe scaffold is complete, use `DONE_WITH_CONCERNS`.
