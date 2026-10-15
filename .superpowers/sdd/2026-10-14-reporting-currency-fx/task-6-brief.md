# Task 6 — Android report DTO, settings selector, Overview parity, and debug fixture

Read the design and plan before editing. Own only:

- `android/app/src/main/java/com/lofuyu/borderledger/api/OwnerLedgerApi.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerSnapshot.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/settings/SettingsScreen.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/settings/ReportingPreferencesRepository.kt`
- debug-only preview activity/fixture files and `android/app/src/debug/AndroidManifest.xml`
- focused Android unit/model tests

The checkout is shared: do not revert unrelated edits, do not touch Worker/web/schema/writer/CI files, do not spawn subagents, and do not commit because the mapped checkout has no usable Git object database. The Android debug preview must not require credentials or live provider traffic.

Contract requirements:

- Add `OwnerReportQuery.reportingCurrency: String?`, validate through `CurrencyRegistry`, and serialize `reportingCurrency` independently from the existing `currency` source filter.
- Extend the bounded decoder with nullable `reportingCurrency`, converted totals/daily totals, and `ChineseBankBand(percentageBasisPoints = 150)`. Validate every currency through the registry and every monetary number as a safe `Long`; unknown fields remain skipped; decimal percentage values are not accepted.
- Existing saved preference key/field `preferredCurrency` means reporting target. Settings offers a bounded shared-registry selector labelled “Total spending currency”; null/source-preserving mode remains available.
- Overview’s primary total/daily chart uses converted fields when selected, while source-currency audit cards/activity remain visible. Partial reports show unavailable source codes and never look final.
- Render a content-described dashed uncertainty card only when the Worker supplies the BOC band. Copy must state “±1.5% Chinese bank settlement estimate; CNY spending excluded”, use exact server-provided lower/upper amounts, and include provider/lock-date/partial provenance.
- Add a debug-only `FX_REPORT_PREVIEW` activity/intent fixture that reuses production total/range composables and supports deterministic available, partial, unavailable, provisional, refund, and BOC+CNY cases. Keep it out of release manifests.

Write failing Kotlin tests first where practical. Run targeted unit tests, all Android unit tests, lint, and unsigned release assembly using the installed Gradle/SDK tooling (use the local mirror if UNC build tooling cannot run). Write `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-6-report.md` with exact commands/output and concerns. Return only status/report path/test summary/concerns.
