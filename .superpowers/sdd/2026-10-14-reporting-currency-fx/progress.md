# SDD ledger — plan: docs/superpowers/plans/2026-10-14-reporting-currency-fx.md

Workspace note: the mapped WebDAV checkout exposes an incomplete `.git` directory and cannot run Git revision commands. Progress and review artifacts are therefore tracked in this ledger and the working tree; no commits or branch integration will be claimed.

## Preflight task/interface scan

| Pair/task | Shared file or interface | Finding | Ruling |
|---|---|---|---|
| 1 → 2 | `worker/fx-rates.ts`, decimal rates/snapshot shape | Task 1 produces validated EUR decimal strings; Task 2 persists JSON snapshots. | Keep the provider module independent of D1 and expose a serializable snapshot shape; Task 2 consumes it through typed helpers. |
| 1 → 3 | `convertMinorUnits`, snapshot resolution | Task 3 needs exact conversion and missing-rate behavior. | Preserve BigInt rational arithmetic in Task 1 and inject fetch/clock dependencies into report code. |
| 2 → 3 | `transactions.fx_lock_date`, `fx_rate_snapshots` | Reports need immutable lock dates and first-write-wins snapshots. | Migration is additive and report reads treat legacy/missing snapshots as unavailable. |
| 3 → 4 | report row selection and write-path lock semantics | Task 3 reads canonical dates; Task 4 preserves them on writes. | Report query uses `COALESCE(fx_lock_date,date)` and writers explicitly set the lock where safe. |
| 3 → 5 | additive report contract | Web maps converted fields and partial metadata. | API fields are additive; omitted reporting target remains source-only. |
| 3 → 6 | mobile report contract | Android decoder consumes the same fields. | Keep numeric monetary fields safe integers and validate target codes through the shared registry. |
| 3 → 7 | app-owned contract paths | Contract changes must trigger app builds. | Include `contracts/**` in the app workflow allowlist; backend-only paths remain excluded. |
| 5 ↔ 6 | user-facing semantics | Both clients need the same target/reporting and BOC-band behavior. | Worker is authoritative; clients never call Frankfurter or recompute rates. |
| 7 ↔ 8 | workflow evidence | Static path tests and final audit inspect the same files. | Run workflow assertions before the final verification pass. |
| 8 | all tasks | Security audit and evidence depend on completed implementation. | Run STRIDE only after unit, browser, Android, and workflow verification. |

## Task self-consistency scan

| Task | Self-consistency result |
|---|---|
| 1 | Tests and exports cover provider validation, fixed endpoint, bounded IO, and rational arithmetic; no contradiction found. |
| 2 | Migration/bootstrap/types/tests describe the same immutable snapshot and lock-date fields; no contradiction found. |
| 3 | Route, schedule, report, and OpenAPI changes all consume `reportingCurrency`; no contradiction found. |
| 4 | Writers preserve first canonical dates and do not mutate source amounts; no contradiction found. |
| 5 | Web request, mapping, primary total, source audit lanes, and dashed estimate are aligned. |
| 6 | Android DTO, preference selector, Overview, and debug fixture share the additive report contract. |
| 7 | App path allowlist includes all specified app-owned paths and excludes backend-only paths. |
| 8 | Evidence commands and STRIDE controls cover the acceptance rows; unavailable external evidence must be reported. |

Ruling: use the existing `preferredCurrency` storage key as the reporting-target preference and add a distinct `reportingCurrency` query parameter; this preserves compatibility while keeping the existing `currency` source filter. Cost if wrong: clients or integrations expecting the old source-filter meaning of the preference would need a compatibility migration.

## Work log

- Design and implementation plan reviewed before code changes.
- Builder-check questions resolved in the design document: immutable first valid snapshot, source-only omitted target, same provisional toggle for BOC band, 150 basis points on wire, one target-unit rounding, and exhaustive app path list.
- `Task 1: complete (review clean by scoped re-review; final 17-test rerun was interrupted after the last test-only addition; 16-test focused run, typecheck, and code inspection passed).` Lossless provider parsing, shared-registry enforcement, EUR identity validation, exact rounding, bounded IO, and typed errors are in place.
- `Task 2: complete (review clean by scoped re-review; local mirror focused migration 6/6, multicurrency 5/5, typecheck passed).` FX lock migration, immutable snapshots, typed helpers, bootstrap parity, bounds, and composite FK coverage are in place. Direct UNC Vitest remains infrastructure-blocked.
- `Task 3: complete (hardening re-review clean; focused report/schedule/route tests 17/17 and typecheck passed; full suite remains unverified because mapped WebDAV/local mirror runs stalled).` Worker conversion, digest verification, safe aggregation, typed provider degradation, route auth regressions, cron warming, mobile/OpenAPI parity, and nullable reporting preference contract are in place.
- `Task 4: complete (production-writer review clean; local mirror focused suites 5 files/60 tests and typecheck passed).` Plaid, alert, and statement inserts establish immutable `fx_lock_date`; replay, posting, review, and partial-cancellation updates preserve it; current-schema fixtures cover all ordinary writer paths and historical migration tests remain isolated.
- `Task 5: complete (web focused suite 19/19, typecheck, production build, and headless browser smoke passed).` The web maps the additive report contract, exposes all registered reporting currencies, preserves source audit lanes, renders partial/unavailable states, and displays the server-authoritative dashed Chinese-bank estimate. Browser smoke exercised CAD → EUR and the CNY exception with an isolated in-browser API fixture.
- `Task 6: complete (Android unit tests 208/208; lintDebug and assembleRelease green; emulator and USB UI passes complete).` Android keeps reporting target separate from source filters, validates the full shared currency registry, renders complete/partial/unavailable/refund/BOC-CNY fixture screens, and keeps the preview activity debug-only. Both real-device surfaces verified accessibility trees, screenshots, band scrolling, release login/About startup, and empty crash buffers; the USB evidence is recorded in the task report.
- `Task 7: complete (workflow contract 2/2 and full local suite 54 files/289 tests passed).` App-only push/PR filters cover Android, web, contracts, and build inputs while excluding backend-only paths; CI is least-privileged and Android validation is explicitly gated only when the checked-in wrapper is unavailable.
- `Security audit: complete.` STRIDE review is recorded in `docs/security/2026-10-14-reporting-currency-fx-stride.md`; production dependency audit reported 0 high-severity vulnerabilities, release/debug manifest boundaries were checked, and both emulator and USB crash buffers were empty.
