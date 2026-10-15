# Task 15 report — settings, devices, About and parity closure

Status: complete with concern.

Implemented shared revisioned reporting preferences across the legacy web and mobile routes, full registered-currency validation/selection in the web/mobile/native paths, device listing/revocation with recent owner approval, capture consent/renew/pause boundaries, import-only source setup messaging, sign-out/revocation behavior and native About/parity surfaces. The web settings view persists the preferred currency, timezone and week-start through the authenticated `/api/preferences` route; native settings use an explicit save and the same 162-code registry. Owner and capture credentials remain separate, and unsupported local source metadata never fabricates authorization.

Evidence:

- Currency, legacy/mobile auth, shared-preference, settings and review/import regression suites passed; the focused web route passed 6/6, the combined UI/recurring/preference run passed 7 files / 23 tests, and the broader currency/mobile/preference group passed 14 files / 70 tests.
- Reconciliation and native-parity storage regressions passed 2 files / 16 tests after making the pre-0009 fixture apply the later additive schema needed by the current alert handler; recurring route fixtures now use a recent synthetic sync timestamp so the production 24-hour stale-state rule remains testable.
- Task 5, Task 9, review, Task 17 and Task 18 static checks passed.
- Direct TypeScript project check passed.
- Native Gradle/navigation/accessibility and Pixel verification remain unavailable.

No commit was recorded because the mounted workspace has no writable Git metadata.
