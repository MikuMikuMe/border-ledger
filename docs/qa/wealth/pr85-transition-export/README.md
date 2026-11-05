# Corrected transition valuations in canonical exports

Verified 2026-11-05 against refreshed `origin/main` (`1ebfabb`). All records are synthetic.

## Fix

Exports reconcile the latest effective dated valuation into an existing transition opening value or opening security price. Matching synthetic valuation rows are removed by account/date/security identity, so a correction's new ID cannot create a second insert. Duplicate comparison uses the same reconciled transition. Zero values, other dates, other securities, original cost basis and stored transition audit records are preserved.

Importing a transition no longer overwrites the separately exported account metadata amount; dated observations remain authoritative. This keeps the canonical document identical after a fresh restore.

## Self-review

Self-review added preview guards for standalone or generated valuation-key/ID collisions and event ID/source collisions. An independent review found the corresponding collision against existing ledger rows; it was reproduced and fixed. Validation now includes stored event IDs/source IDs and all stored base valuation IDs, including IDs hidden by later correction observations. Event IDs and source IDs remain separate namespaces, so unrelated valid activity is retained.

The follow-up independent review re-ran the reproduction and the 71 focused transition/store/data-integrity tests and confirmed no remaining actionable finding within this patch. No broader PR audit or hosted check run is implied.

## Android verification

API 35 emulator with actual React Native shell/screens and Android document picker; existing verified embedded debug APK (`ABE737531583A7D19C69CC79A36B45586C4BA223A5430AA74F080211D24709EE`). No mobile/native sources changed. The synthetic loopback adapter called real Worker handlers against a fresh disposable SQLite destination.

- The source transition opened at CAD 100, was corrected to CAD 150 then CAD 200. [Source audit](source-audit.json) retains the original CAD 100 transition; the [source snapshot](source-snapshot.json) shows CAD 200.
- [Canonical CSV](corrected-opening.csv) contains the reconciled CAD 200 transition and no competing standalone opening valuation.
- [Native preview](fresh-preview.png): two staged rows, two ready, zero errors. Android committed the account and transition successfully into the fresh ledger.
- [Imported report](imported-report.json): CAD 200 at revision 1. Re-export matched the source CSV byte-for-byte; [repeated preview](repeated-preview.json) reports two duplicates and no errors.
- [Relaunch](imported-overview.png): CAD 200 remains after force-stop/relaunch. Matching XML trees are retained. Fixture data survives app relaunch, not server restart.

No production sessions/data, market-data calls, credentials or deployment were involved. Full native build/theme/accessibility evidence remains in earlier QA records and was not repeated for this server-only change.

## Checks

Final Wealth/mobile suite: 19 files / 355 tests passed (108.21 seconds). Focused transition/store/data-integrity suites: 71 passed; final transition-only regressions: 12 passed. Web/mobile typechecks and production web build passed with the existing 529 kB chunk advisory. All six changed executable files scored CodeScene 10.0.
