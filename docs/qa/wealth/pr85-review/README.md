# PR 85 review follow-up verification

Verified locally on 2026-11-04 against `origin/main` at `1ebfabbaf98e57004709f61510c9f82d7e201319`. This record supersedes the earlier CodeScene follow-up status in the parent verification record.

## Changes under review

- Preserve the source leg of linked transfers when the other account changes brokerage mode; keep fresh holdings segments separate from previous openings.
- Use the same segment projection for append validation, CSV validation and reports, including correction lineage and recursive transfer dependencies.
- Discover cached prices for both transfer endpoints and historical instrument/destination variants after corrections.
- Keep fractional transfer quantities in CSV exports.
- Replace primitive-heavy internal Android/web interfaces with typed request/state contracts while preserving native bridge compatibility.
- Refresh the README feature inventory and runtime architecture with the requested diagram-design workflow. The active AI path is the main Worker calling official provider APIs; the separate egress service is currently unwired.

## Android acceptance

The actual React Native shell, Kotlin document bridge and Android document picker ran in the isolated `com.lofuyu.borderledger.probe.wealthqa` package on API 35, x86_64, 768 x 1280. SDK, AVD, Java, Gradle caches and artifacts stayed on D:. The `BorderLedgerReviewQA` emulator uses the installed Google APIs system image; its runtime enforces a minimum 2560 MB RAM.

The debug-only fixture supplies a synthetic ledger/session and calls real Wealth Worker handlers against a disposable SQLite D1 fixture. This is not production sign-in verification. An embedded development bundle avoided Metro's additional memory use; local Gradle init scripts and bundle assets were not committed. QA APK SHA-256: `ECD594C887BAD464AA5D38454886B8B9784F45139B0553426DEA0B616F14A027`.

| Flow | Observed result |
| --- | --- |
| More → Wealth → Investments → Choose Wealth CSV file | Android Downloads picker selected [the nine-row fixture](../review-transfer-segments.csv); preview showed 9 ready, 0 errors and 0 duplicates. |
| Confirm CSV import | Source retained 8 TSX:RY shares, CAD 100 cash, CAD 400 basis and CAD 200 unrealized gain after destination switched to CAD 150 aggregate balance. |
| Net worth | CAD 850 as of 2026-11-03; source CAD 700 plus destination CAD 150. |
| Native CSV export | Android save picker wrote [export.csv](export.csv); `review-transfer` retains quantity `2`, source and destination identifiers. |
| Repeated source-file preview | 0 rows ready, 7 excluded duplicates and 2 explicit existing-record conflicts for the changed account/transition; commit remained blocked and no balances duplicated. |
| Force stop and relaunch | More → Wealth still displayed CAD 850 from the retained server fixture. This checks app relaunch, not device-offline synchronization. |

Screenshots and accessibility trees: [holdings](source-holdings.png), [net worth](net-worth.png), [duplicate/conflict preview](duplicate-preview.png), [relaunch](relaunch.png). App-scoped [relaunch logcat](relaunch-logcat.txt) is retained. Earlier full-feature light/dark, large-text, TalkBack, keyboard, error/retry and Back evidence remains in the parent record; these internal follow-up changes received the focused transfer/file/persistence smoke above.

Live Alpha Vantage calls were not tested with a user key; provider integration tests use mocked responses. No production service was deployed or merged. Hosted checks are handed back without waiting or polling, per the user's instruction.

## Local checks

| Check | Result |
| --- | --- |
| Unaffected repository partition | 201 files / 1,313 tests passed, 589.72 seconds. |
| Final Wealth partition | 12 files / 239 tests passed, 135.37 seconds, after the final two fixes. Combined with the unaffected partition: 213 files / 1,552 tests. |
| Root and mobile TypeScript; production web build | Passed; root typecheck repeated after the final accounting edits. Existing 529 kB Vite chunk advisory remains. |
| Android lint, app unit and shared host tests | Passed: 359 app tests and 19 shared tests, zero failures/errors. |
| Normal Android debug and unsigned x86_64 release build | Passed, 9m59s combined native gate; normal merged launcher/manifest checks passed before the isolated QA package override. |
| Static Android/toolchain and React Native host checks | Passed. |
| CodeScene per-file review and score | All 19 executable follow-up files scored 10.0, including four final accounting files rechecked after their last changes. Type-only/generated/docs files are excluded from numeric scoring. |

[Per-file CodeScene evidence](../codescene-pr85-review-files.json) and [pre-commit safeguard](../codescene-pr85-review-safeguard.json) are retained separately. No thresholds or rules were suppressed. Branch analysis is run against `origin/main` after the follow-up commit; its outcome is reported in the PR, not inferred from older hosted results.
