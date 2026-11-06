# Realized-gain uncertainty and portfolio boundary returns

Verified 2026-11-05. All records are synthetic; the base is refreshed `origin/main` at `1ebfabb`.

## Review fixes

Cumulative realized gain stays unavailable after any sale with unknown basis, including after a documented repurchase and another full or partial sale. A correction supplying the missing historical basis recalculates gains normally from replay.

Cash transfers between a brokerage and a non-investment Wealth account become external contributions or withdrawals only for investment analytics. The household and segment-scoped snapshot still use the original transfer. Transfers between brokerages remain internal. Corrections, reversals and end-of-day boundaries are covered by regression tests.

## Self-review

Self-review reproduced an additional gap: a linked bank row whose kind was `transfer` was excluded from cash-flow reads, so a different bank amount could be ignored. Investment validation now includes confirmed transfer bank rows; household income/spending still excludes them. Mismatched or opposing linked bank flows make returns unavailable rather than fabricating gains.

A separate read-only review examined the final accounting/cash-flow diff and focused tests, independently reproduced the bank-transfer gap and confirmed its fix. It reported no remaining actionable findings within that scope. This was not a new audit of every PR file or a hosted check run.

## Android and API evidence

API 35 emulator, actual React Native shell/screens, previously verified embedded debug APK (`ABE737531583A7D19C69CC79A36B45586C4BA223A5430AA74F080211D24709EE`), synthetic loopback transport and real Worker handlers against disposable SQLite. No mobile/native source changes or native rebuild was needed for this server-only follow-up.

- [Performance](performance.png): an internal household transfer of CAD 100 into investments produces 0.00% investment performance, not 100% gain. Both overall and CAD-specific Modified Dietz values are zero in the [report JSON](report.json).
- [Capital flow](capital-flow.png): one CAD 100 contribution is included in investment capital, while household income/spending excludes the transfer.
- The report's closed position has known current basis zero and unavailable cumulative realized gain after unknown-basis sale, repurchase and resale.
- [Relaunch](relaunch.png): CAD 301.20 household net worth survives force-stop/relaunch. Matching XML UI trees are retained. Fixture data survives app relaunch, not server restart.

No production session, production records, live market data or deployments were used. Existing native build/theme/accessibility evidence is retained in previous QA records; that full matrix was not repeated here.

## Checks

Final Wealth/mobile partition: 17 files / 332 tests passed (116.03 seconds). Focused returns and linked-bank regressions: 43 passed. Web/mobile typechecks and the production web build passed; the existing 529 kB bundle advisory remains. All four modified executable files scored CodeScene 10.0 with no findings.
