# Provider valuation identity and aggregate transfer validation

Verified 2026-11-05 against refreshed `origin/main` (`1ebfabb`). All records and provider responses are synthetic.

## Fixes and self-review

Provider valuation history now uses the ledger's canonical instrument key. The quote cache retains its separate cache key. A same-day manual observation cannot be bypassed by a provider row with another key, and a revision-confirmed manual correction can replace an earlier provider observation. Provider writes and manual overwrites without an explicit current revision remain rejected.

Transfer shape and money are validated before segment projection decides whether holdings balance effects are active. Negative, fractional, unsafe, missing/non-finite and invalid-currency money, self-transfers, and unsupported kinds cannot be committed via aggregate-only replay skips. Invalid correction replacements and CSV imports are covered too.

Self-review replaced the old quote test's raw SQL fixture (which reproduced the incorrect cache-key convention) with public account/event/valuation APIs, an Android-style valuation ID, snapshot assertions and repeated canonical import checks. Both manual-first and provider-first ordering are tested.

An independent read-only review ran 26 focused and 96 adjacent tests and found no further transfer/manual-precedence issue. It noted a conditional compatibility concern for persisted pre-fix NUL-key provider history. The refreshed PR base contains neither the Wealth adapter nor the Wealth tables; this is the first Wealth migration and no deployment was performed during this work. No production legacy-data migration is required by this patch. Reused pre-release trial databases are outside that fresh-migration verification scope.

## Evidence

The actual React Native Wealth screens and Android document picker ran on API 35 with the existing verified embedded debug APK (`ABE737531583A7D19C69CC79A36B45586C4BA223A5430AA74F080211D24709EE`). No mobile/native sources changed. The synthetic loopback transport called real Worker handlers against disposable SQLite; live Alpha Vantage access was not used.

- [Provider refresh result](quote.json): refreshed CAD 100 quote dated 2026-11-02.
- [Android holding](manual-price.png): the same-day manual CAD 200 value remains authoritative; the [report](report.json) has CAD 300 net worth.
- [Invalid CSV preview](rejected-import.png): one staged negative cash transfer has validation errors and zero rows ready to commit. Matching XML and [CSV](invalid-transfer.csv) are retained.
- [Direct invalid API write](rejected-write.json): HTTP 400 `invalid_money`; ledger revision remains 6 and the report remains readable.
- [Relaunch](relaunch.png): CAD 300 persists after force-stop/relaunch. Fixture data survives app restart, not server restart.

## Local checks

- Full Wealth/mobile partition: 18 files / 343 tests passed (126.78 seconds).
- Focused quote/aggregate validation: 26 tests passed.
- Web/mobile typechecks and production web build passed. Existing 529 kB chunk advisory remains.
- All five modified executable files scored CodeScene 10.0, with no findings.
- This server-only follow-up reuses previous full native build, accessibility and theme evidence; that matrix was not rerun.

No production data, production credentials, live provider calls, merge or deployment was involved.
