# PR 85 bank-link, split-price and performance follow-up

Local verification date: 2026-11-04. Reviewed head: `6da0c859d90e24f46eaa9cafe06cb20d8b185915`; PR base: `origin/main` at `1ebfabbaf98e57004709f61510c9f82d7e201319`.

All applicable hosted checks on the reviewed head passed, including CodeScene's six quality gates. Three new review comments identified accounting/reporting issues; Copilot's quota notices require no code change. New hosted checks for this follow-up are handed back without waiting or polling.

## Fixes and regression evidence

- Bank-link resolution includes the transaction's canonical ID together with every existing source alias. The web-selected ID now resolves the same link as a source record, so the investment record is counted once. Tests cover canonical ID, source-record ID, identity key, provider/pending IDs, bank source/row IDs, event ID and reference.
- Per-currency Modified Dietz checks ambiguous capital flows before filtering records excluded from performance. Contribution/withdrawal mismatches return `incomplete_flows`; dividends, withholding and fees retain their intended exclusion from external capital. An unaffected currency remains independently available.
- Split-price boundaries follow the transferred shares across accounts, fractional moves and multiple hops. Pre-split quotes remain unavailable until an appropriate dated price exists. Boundaries respect chronological event sequence and account/security identity, including historical account segments.
- Closing a lot does not erase a known split adjustment to quote units. Sale/transfer followed by reopening the same security continues to reject a pre-split quote. Both cases first failed and then passed after retaining the boundary at zero quantity.

[Bank-link, performance and SQLite integration tests](../../../../tests/wealth-cashflow-review.test.ts) cover 28 cases. [Split-transfer domain tests](../../../../tests/wealth-split-transfers.test.ts) cover seven cases. Before the fixes, the canonical bank-ID case and three capital-ambiguity cases failed; existing alias and income/fee controls passed. Store-level tests verify that a post-split manual price restores complete valuation and that hidden segment identities do not leak.

## Local checks

Root and mobile typechecks and the production web build passed after the final changes. The inherited 529 kB web bundle advisory remains. All eight modified executable files scored 10.0 with no local CodeScene findings. New helpers respect the hosted four-argument limit; no rules or thresholds were suppressed.

The complete Wealth/mobile suite passed: 15 files / 285 tests, 106.87 seconds. Focused domain/store suites passed 89 tests; the final bank-correction/store run passed 74 tests. Final pre-commit and branch-level CodeScene outcomes are reported in the PR. The existing native/mobile sources are unchanged; the emulator reuses the isolated API 35 debug package and embedded bundle (SHA-256 `ECD594C887BAD464AA5D38454886B8B9784F45139B0553426DEA0B616F14A027`). Its synthetic fixture calls real Worker handlers against disposable SQLite D1 data. This does not claim production sign-in or live provider verification.

## Reproducible synthetic portfolio

[linked-split-portfolio.csv](linked-split-portfolio.csv) contains three brokerage accounts and eleven rows. One RY share, priced CAD 100 on October 31, splits 2:1 on November 1 and moves to another account on November 2. The destination initially has only that pre-split quote. A separate cash account opens CAD 100 and receives a CAD 100 contribution linked by canonical transaction ID to a confirmed CAD 50 bank record on November 2; that bank transaction also has a source-record alias.

Before a new price, the two shares must have unavailable market value and CAD totals must be incomplete, with a known CAD 200 cash subtotal. [post-split-price.csv](post-split-price.csv) supplies source and destination prices of CAD 50 at the relevant period boundaries. After those observations, the shares are worth CAD 100 and total net worth is CAD 300 with complete current price coverage. The CAD period return must still be unavailable because the explicit capital-flow link disagrees with the bank amount.

All records, provider responses, names and credentials in the local QA fixture are synthetic. SDK, AVD, Java, Gradle caches, APK and checkout stay on D:. No paid service, production deployment or merge is part of this work. Live Alpha Vantage verification remains unperformed because no user key was supplied.

## Alias-equivalent corrections

Independent review also identified a correction conflict when the same bank transaction is reselected under a different alias. Append validation now compares unique canonical transaction identities; it does not exempt an alias that resolves ambiguously to multiple transactions. CSV ownership follows same-bank correction chains using normalized bank groups. Regression cases cover alias-to-row-ID, row-ID-to-alias, aliases from multiple source records, correction of an existing link and original-plus-correction in one CSV. The existing negative import test now targets an unlinked event while a different event already owns the bank link, preserving the genuine conflict safeguard.

## Shared statement aliases

Statement source identifiers can belong to multiple transactions. Alias groups retain a set of transaction IDs rather than one row-order-dependent value. CSV previews reject aliases with multiple matches and ask for a transaction ID or unique alias. Direct writes perform the same check before correction exemptions, returning `ambiguous_bank_link` without changing balances or revision. Tests cover both source-record orders, ambiguous fresh corrections, rejected commits and first writes, and valid distinct row-specific/direct links sharing one statement source.

## Focused Android acceptance

The existing isolated API 35 React Native/Kotlin QA app used Android's Downloads picker to preview and commit all three supplied CSV files against real final Worker handlers and synthetic SQLite D1 data:

- Eleven portfolio rows previewed with zero errors/duplicates and committed at revision 1. The [transferred two-share holding](pre-split-price-rejected.png) showed unavailable market value and gain under the pre-split quote. [API evidence](before-price.json) showed a known CAD 200 subtotal with incomplete coverage and one recognized, ambiguous capital link.
- Two valid dated prices committed at revision 2. [Net worth became CAD 300](post-split-net-worth.png), with complete current price coverage and a CAD 100 security value. [API evidence](after-price.json) confirms the capital mismatch still makes the CAD return unavailable.
- The [same-bank alias correction preview](same-bank-correction-preview.png) showed one ready row and zero errors. Its commit advanced to revision 3, kept CAD 300 unchanged and retained exactly one bank flow linked to the correction replacement. [API evidence](after-correction.json) confirms the mismatch remains explicit.
- The native Cash flow screen displayed [Performance unavailable for CAD](ambiguous-performance.png). Force-stop/relaunch preserved [CAD 300](relaunch.png); the scoped [logcat](relaunch-logcat.txt) and accessibility trees are retained beside the screenshots.

This is synthetic app/server and persistence verification, not production sign-in or offline synchronization. The native bundle was reused because no native/mobile source changed. Prior full-theme, accessibility, keyboard and Back evidence remains in the [previous QA record](../pr85-final-gate/README.md).


Independent re-review confirmed the same-transaction correction, shared-alias import and direct-write findings are resolved. A final named-fixture refactor kept all seven split tests passing and avoids positional string-heavy test builders. Local [CodeScene per-file evidence](codescene-files.json) and [pre-commit safeguard](codescene-safeguard.json) accompany this record. Branch analysis against the refreshed PR base is reported in the PR.
