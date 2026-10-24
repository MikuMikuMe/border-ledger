# Border Ledger Android

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

One private owner managing personal spending across Canadian RBC and Bank of China accounts. The primary phone is a Pixel 10 Pro.

## Product Purpose

Provide the full Border Ledger finance workflow on Android: understand spending, inspect activity, track recurring commitments, and review uncertain records. Imports, bank connections, reporting preferences, and notification/device setup support those everyday tasks rather than dominate navigation.

This record describes the Android app and its diagnostic probe. The root `PRODUCT.md` supplies shared ledger principles; Android implementation and validation documents supply platform-specific evidence. The app is no longer described as only a notification feasibility probe.

## Positioning

A private, reconciliation-first cross-border ledger. Source-currency amounts, confirmed records, and provisional notification evidence remain distinguishable so the owner can understand what contributes to a total.

## Operating Context

The owner uses the Android app to check spending and transactions, review records, inspect recurring payments, manage accounts and bank connections, import statements, and export the ledger. Notification capture is an optional, separately authorized background workflow.

Everyday tasks have direct navigation. Secondary tasks are grouped and opened as individual pages with a clear return path. Reporting and transaction filters remain available on demand without obscuring the underlying financial content.

The interface is implemented in React Native under `mobile/`, backed by native Android service adapters under `android/`. The Android shell, Back behavior, system permissions, and document-picker flows are verified on an Android emulator or device, not inferred from a web preview.

## Capabilities and Constraints

- Preserve original currency, integer minor units, source dates, explicit reporting timezone, and week start. Source totals and converted reporting totals must remain distinguishable.
- Keep expenses, income, transfers, repayments, refunds, and fees distinct. Provisional evidence must not masquerade as confirmed bank records or be double-counted.
- Statement import retains preview, duplicate handling, review, and explicit commit. Export uses the owner's chosen document destination; cancellation is not success.
- Owner credentials authorize ledger reads, review, import/export, bank management, and settings. Capture credentials are separate source/account/currency-scoped write credentials and cannot grant owner access.
- Bank passwords never belong in the app. Provider enrollment and supported authentication methods remain external dependencies; application code is not proof of provider readiness.
- Automatic capture requires an approved source and type, a labeled amount/currency, a resolvable instrument, and the original individual event time. Generic, redacted, summary-only, or untimestamped notifications remain unsupported or review-only.
- CMB remains disabled and statement-import-only until independent source capability testing establishes support.
- Private financial data, credentials, and real notification content must not enter source control, logs, or synthetic QA fixtures.

## Offline Recovery and Release Verification

A same-ledger owner may see an encrypted remembered snapshot only while the device is unlocked and its lease is valid. Explicit logout clears visible owner data and credentials, pauses monitoring, and retains only encrypted pending same-ledger uploads plus revocation-only intents. Reconnect checks revocation before refresh or writes. Upgrades must preserve queued identity and original event time; restored grants must be invalidated and require re-pairing.

Source presence does not establish end-to-end acceptance. Keep build/signing checks, migration and restore evidence, artifact verification, and device-flow verification explicit. `docs/android-validation.md` and the current release workflows define the applicable release and owner-validation boundaries; this product record does not change CI publication policy. Never describe pending bank/device checks as passed.

## Evidence on Hand

- `mobile/src/screens/` and the finance, details, tools, and auth feature modules implement the full app workflow.
- `mobile/src/dev/` provides explicitly synthetic, debug-only fixtures. These are not evidence of a live authenticated backend flow.
- `tests/mobile-shell-navigation.test.ts`, financial-view tests, tool-view tests, and root-navigation tests cover navigation and presentation behavior.
- `docs/android-validation.md` records Android acceptance boundaries and historical evidence; its dated results must not be generalized to later builds.
- The navigation redesign was exercised on an Android 15 / API 35 emulator with synthetic data, light/dark themes, system Back, scrolling, and 130% text. Local screenshots and the detailed record are in the ignored `.impeccable/review/android-navigation/` folder. That run did not exercise production login or real bank writes.

## Product Principles

1. Put financial understanding and daily tasks ahead of setup controls.
2. Keep every feature discoverable without stacked navigation tabs.
3. Preserve source truth, currency distinctions, and reconciliation evidence.
4. Make permission, freshness, failure, and confirmation states explicit.
5. Treat privacy and verified behavior as product requirements, not visual claims.

## Accessibility & Inclusion

Use readable text labels rather than color alone for state. Touch targets are at least 48 dp. Support system Back, window insets, larger system text, light/dark themes, and reduced motion. Financial content and secondary actions must remain reachable while scrolling.

## Diagnostic Probe Safety Contract

The original metadata feasibility probe remains a diagnostic workflow, not a description of the full app. Its constraints must not be relaxed by general app UI work:

- The debug probe uses a separate package from the production app. The diagnostic listener is declared in the debug manifest and filters `com.tencent.mm` before reading extras; the BOC app package is not guessed.
- At most 20 metadata previews live in process memory. The diagnostic probe does not retain or export raw title, body, sender, notification key, financial amount, account identifier, raw dump, or screenshot. Its metadata inspection has no network/database side effects or automatic file writing.
- Sanitized metadata CSV export uses the Android document picker and reports completion, cancellation, or failure. It does not upload or claim storage ownership.
- Package filtering alone does not prove the BOC source. The owner triggers a legitimate new alert from the known conversation and compares the package-only and timing evidence.
- Recovered active notifications are labeled as such. They are not dismissed-notification history or backfill.
- The probe cannot approve a source, parse a transaction, or count a purchase. Demo data must be labeled synthetic.

## Open Evidence

Physical-device source capability, installed bank/WeChat versions, conversation/channel identity, individual event timestamps, silent or muted notifications, and provider enrollment require current owner/device evidence. Source-specific acceptance remains open wherever that evidence has not been collected. Do not invent supported providers, real bank samples, or device validation results.
