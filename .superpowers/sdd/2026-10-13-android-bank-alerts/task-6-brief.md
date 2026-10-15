# Task 6 — source extraction, parser, and observation identity

## Scope

Implement the Kotlin-side bounded notification extraction, observation tracker, parser result model, and synthetic BOC source adapter using only fields proven or explicitly modeled by Task 1. Because no Pixel/source payload is available in this host, generic or unverified rich fields must remain `NeedsReview`/unsupported; do not invent merchant, currency, amount, account, or time from screenshots or summary text.

## Files and boundaries

Own Android capture/parser/tracker/source-profile files under `android/app/src/main/java/com/lofuyu/borderledger/capture/**` and `parser/**`, synthetic unit tests/fixtures, and Task 6 validation/report notes. Preserve Tasks 1–5; do not add AccessibilityService, root/UI scraping, WeChat database access, SMS permission, exact alarms, perpetual foreground service, network upload, or Task 7 durable listener wiring.

## Required behavior (tests first)

- Extraction rejects unrelated packages/private chats and matched-bank promos/OTP; source profiles identify approved package/channel/sender without treating display name as cryptographic authenticity. Bounded scalar copies only; no raw payload persistence/logging.
- Observation identity includes Android user/profile, package, notification key/generation, accessible stable message identity/timestamp, and snapshot multiplicity. Reused keys with new messages produce distinct observations; same observation replay is ignored; removed/recreated notifications and summary/child ordering are deterministic; group summaries are skipped when complete children exist.
- Parser evaluates source/type before money; labeled transaction amount/currency is distinct from balance/limit/FX; normalize only deliberate Chinese/full-width forms and reject unknown symbols/scale/overflow/ambiguous fields. Supported synthetic BOC cases cover CAD/CNY/USD/HKD and purchase/failure/cancellation/refund/hold/fee/transfer/unknown distinctions.
- Preserve original individual notification posting time separately from capture time; missing/summary-only time cannot borrow callback/bank wall/summary time. Existing/pre-activation or >7-day discoveries require historical/duplicate review. Reconnect/key updates freeze known event time.
- Equal successful purchases remain distinct; failed attempts count zero; cancellation/reversal evidence remains lifecycle/review data; ambiguous repeated identical messages get possible-duplicate review, never deletion or two confident fabricated charges. Parse result maps to the accepted `BankAlertEventInput` contract without raw notification/chat text.

## Verification/report

Write `.superpowers/sdd/2026-10-13-android-bank-alerts/task-6-report.md` with TDD RED/GREEN evidence, static/Kotlin limitations, synthetic fixture provenance, changed files, and concerns. Gradle/Android tests are expected to be blocked; do not claim Pixel/source acceptance. Return under 15 lines with status/report path.
