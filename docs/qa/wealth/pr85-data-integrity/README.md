# Wealth currency, basis and canonical-import fixes

Verified 2026-11-05 against refreshed `origin/main` (`1ebfabb`). All data is synthetic.

- Direct writes and CSV validation require linked bank currencies to match account metadata. Historical observations in another currency are excluded, so existing bad links show missing coverage rather than relabeled money.
- A closed position's current basis restarts from the documented incoming buy, opening position or transfer. Its historical realized-gain uncertainty remains unchanged.
- Canonical export and duplicate comparison use the same initial account mode. Optional blank CSV fields compare like omitted optional event fields; real changes still conflict.

## Evidence

Android API 35 uses the actual React Native shell, Wealth views and Android document picker with the existing verified debug APK (`ABE737531583A7D19C69CC79A36B45586C4BA223A5430AA74F080211D24709EE`). The synthetic loopback adapter calls real Worker handlers against disposable SQLite. No native/mobile source changes, production sign-in, production data or live quotes were involved.

- [Original currencies](original-currencies.png): CAD 200.20 and USD 100.00 remain separate; a later CAD observation is not used for the USD-linked account.
- [Reopened holding](reopened-basis.png): one share has CAD 0.50 basis, CAD 0.70 market value and CAD 0.20 unrealized gain; historical realized gain is unavailable.
- [Android repeat-import preview](repeated-import.png): eight staged rows, eight duplicates, no errors and zero new rows ready to commit. This includes the transitioned account and existing trades.
- A separate [duplicate-only API commit](commit.json) reports `committed: 0`, revision 9; the canonical export is byte-for-byte unchanged afterward. The Android screenshot documents preview only.
- [Relaunch](relaunch.png) retains the same CAD/USD totals after force-stop. Fixture data survives app relaunch, not server restart.

Matching XML trees, [canonical CSV](repeated-export.csv), [preview JSON](preview.json) and [report](report.json) are retained here. Automated regressions additionally cover legacy invalid links, invalid direct/import writes, both mode-transition directions, changed-record conflicts, omitted optional fields, and reopening through buys, opening positions and transfers.

## Local validation

Final Wealth/mobile partition: 16 files / 317 tests passed (119.17 seconds). Focused accounting/store regressions: 78 passed. Web and mobile typechecks passed; the web build passed with its existing 529 kB chunk advisory. All nine modified executable files scored CodeScene 10.0 with no findings. Existing full native lint/release, theme and accessibility evidence remains in earlier QA records and was not repeated for this server-only follow-up.
