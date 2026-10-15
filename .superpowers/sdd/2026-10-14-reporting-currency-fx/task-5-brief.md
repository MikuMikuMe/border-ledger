# Task 5 — Web report semantics and dashed uncertainty presentation

Read the design and plan before editing. Own only:

- `src/App.tsx`
- `src/styles.css`
- `src/domain/reporting.ts` only if a pure chart/report helper needs it
- web-focused tests such as `tests/overview-report.test.ts`, `tests/button-interactions.test.ts`, `tests/preferences-api-route.test.ts`, and a new mapping test

The checkout is shared: do not revert unrelated edits, do not touch Worker/provider/schema/writers, Android, or CI, do not spawn subagents, and do not commit because the mapped checkout has no usable Git object database.

The Worker report contract is authoritative. Add safe-integer validated mapping for `reportingCurrency`, `convertedTotals`, `convertedDailyTotals`, and `fx` including unavailable source codes and optional `chineseBankBand`. `reportRequestPath(window, includeProvisional, timeZone, reportingCurrency)` must send the selected target when non-null; keep existing `currency` source-filter semantics. The existing `preferredCurrency` preference/storage name now means the selected reporting target. Null is source-preserving mode.

UI requirements:

- Accounts/settings labels the control “Total spending currency”, offers the shared registered ISO registry and a source-preserving option, and persists the existing preference revision.
- Overview uses converted totals/daily totals as the primary total/chart when a target is selected, but keeps source-currency lanes, source amounts, and activity visible as the audit trail.
- Complete conversion explicitly says it is locked to purchase dates and uses Frankfurter daily rates. Partial conversion never appears final; show unavailable source codes and preserve usable source totals.
- Render an accessible dashed-border box only when `fx.chineseBankBand` is present. Show exact lower/upper target amounts and “±1.5% Chinese bank settlement estimate; CNY spending excluded”. Do not rely on color alone; include an aria-label/description and responsive/high-contrast styling.
- The band and all amounts come from server-provided safe integers; do not calculate FX or ±1.5% with browser floating point.

Write failing mapping/UI tests first where practical. Run focused tests, `npm run typecheck`, `npm run build`, and a real browser smoke in the local mirror after backend integration is present. Record commands/output and concerns in `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-5-report.md`. Return only status/report path/test summary/concerns.
