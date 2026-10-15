# Task 7 — production notification listener and durable intake

## Scope

Implement the production Android notification-listener boundary and local durable intake around the accepted Task 5 encrypted storage and Task 6 extractor/parser/tracker. Capture must commit bounded evidence, observation state, and immutable outbox payload atomically before exposing `Queued`; network/upload belongs to Task 9. Preserve the debug probe as isolated debug-only code.

## Files and boundaries

Own production `capture/BankNotificationListener.kt`, listener/settings helpers, local observation/candidate/outbox DAOs and retention/cap logic, WorkManager scheduler stubs/interfaces only as needed, synthetic unit tests, and Task 7 report/validation notes. Do not add AccessibilityService, root/UI scraping, WeChat database access, SMS, exact alarms, perpetual foreground service, broad parser changes, Worker upload routes, or real-device claims.

## Required behavior (tests first)

- Listener is declared only with `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`; callback copies bounded scalar data and immediately dispatches parsing/persistence off the main thread. Unrelated packages/private chats/generic unsupported content never enter financial storage.
- `onListenerConnected` precedes active-notification recovery. Recovered active notifications use the same stable observation identity and original `sbn.postTime`; reconnect/callback time never becomes event time. No dismissed-history/backfill promise; summary/child and duplicate rules remain from Task 6.
- Local transaction: observation/tracker state, normalized eligible event/candidate, and encrypted outbox record commit together; a failure leaves no `Queued` status. Outbox preserves UUID/time/content across restart/process death and renewals; concurrent callbacks cannot lose events; 5,000 pending-event cap visibly pauses intake without deleting unsent events.
- Revoked/expired capture credential pauses upload only; eligible local intake remains within the cap. Retention removes only expired acknowledged evidence/raw bounded diagnostics, never unsent normalized events or confirmed history. Listener permission, app-posting notification permission, first-unlock/storage state, muted/generic source, and health are observable.
- Scheduler uses unique network-constrained work and never performs network/database work on the listener main thread. No foreground service/exact alarm is introduced.

## Verification/report

Write `.superpowers/sdd/2026-10-13-android-bank-alerts/task-7-report.md` with TDD RED/GREEN evidence, static checks, changed files, exact Android-toolchain/Pixel limitations, and concerns. Native Gradle/unit/device execution is expected to be blocked; do not claim it passed. Return under 15 lines with status/report path.
