# Task 3 — Worker report aggregation, periodic refresh, and route contract

Read the plan and design first, then implement this task. The authoritative files are:

- `docs/superpowers/specs/2026-10-14-reporting-currency-fx-design.md`
- `docs/superpowers/plans/2026-10-14-reporting-currency-fx.md`

Own only the backend report/provider integration surface:

- `worker/fx-rates.ts` (extend Task 1 module; preserve its tests/behavior)
- `worker/ledger-reports.ts`
- `worker/index.ts`
- `wrangler.jsonc`
- `worker/mobile.ts`
- `contracts/mobile-v1.openapi.yaml`
- `tests/ledger-reports-fx.test.ts`
- `tests/fx-scheduled.test.ts`
- route assertions in a focused test file if necessary

The checkout is shared: do not revert other edits, do not edit schema/migrations, transaction writers, web, Android, or CI, do not spawn subagents, and do not commit because the mapped checkout has no usable Git object database. Task 2 will provide `fx_lock_date`/`fx_rate_snapshots`; if it is not present yet, write code against the specified names and use a minimal typed seam rather than changing its files.

Requirements:

- Extend `LedgerReportQuery` with `reportingCurrency?: string | null`; retain `currency` as the source-currency filter. Validate both through the registered currency registry. Omitted target is source-only with `reportingCurrency: null` and no network requirement.
- When a target is selected, read all counted canonical rows (not the paginated Activity page), join account institution, and use `COALESCE(fx_lock_date, date)` as the requested snapshot date. Resolve distinct dates through immutable snapshots, fetching missing dates through the fixed Frankfurter client with injectable fetch/clock dependencies for tests. Existing source totals, daily totals, review/excluded/source coverage semantics, alert-supersession predicate, and provisional toggle remain unchanged.
- Add exact additive report fields from the design: `reportingCurrency`, `convertedTotals`, `convertedDailyTotals`, and `fx` with provider `frankfurter`, complete flag, unavailable source currencies, locked date count, observed date range, and optional `chineseBankBand` carrying `percentageBasisPoints: 150`. Partial conversion includes only rows with validated rates; source totals always remain usable.
- BOC matching is narrow and case-insensitive: normalized institution contains `bank of china`, `boc`, `中国银行`, or `中國銀行`. Apply the same provisional toggle; exclude source `CNY`; if an eligible component is unavailable omit the entire band and mark incomplete. Apply ±1.5% after conversion with exact target-unit rounding. Do not use a generic China institution guess.
- Add a daily `scheduled` handler and a root/prod Cron trigger that warms today’s snapshot, never rewrites an existing row, and logs only a safe error name. Keep fetch/queue behavior and owner authorization/origin guards intact.
- Browser route `/api/reports/summary` accepts bounded `reportingCurrency`, rejects unregistered values, and forwards it. Mobile owner route accepts/validates the same query and returns the additive fields through the nested report/wrapper. Update OpenAPI schemas/required fields/additional properties consistently.
- Do not accept arbitrary provider URLs or client-provided rates. Do not log provider response bodies or user data.

Write failing tests first where practical, then run focused tests, route tests, `npm run typecheck`, and the full TypeScript suite. Write `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-3-report.md` with files changed, exact commands/output, and concerns. Return only status/report path/test summary/concerns.
