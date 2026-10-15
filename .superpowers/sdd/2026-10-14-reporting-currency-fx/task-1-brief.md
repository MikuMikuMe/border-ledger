# Task 1 — Exact FX arithmetic and bounded Frankfurter client

Read this brief first; it is the complete task requirement. You own only:

- `worker/fx-rates.ts` (create)
- `tests/fx-rates.test.ts` (create)
- `worker/db-types.ts` only if a snapshot type is genuinely required

This module is the Worker-side authority used later by report aggregation. Do not edit report routes, migrations, UI, Android, or CI files. The checkout is shared with other workers: do not revert or overwrite unrelated edits, do not spawn subagents, and do not commit because this mapped checkout has no usable Git object database.

Implement these exports:

- `parseFrankfurterRates(payload: unknown): ValidatedFxRates`
- `convertMinorUnits(input: FxConversionInput): number | null`
- `fetchFrankfurterSnapshot(requestedDate: string, fetcher?: typeof fetch): Promise<FxProviderSnapshot>`
- `isSupportedFxDate(value: string): boolean`

The fixed provider endpoint is exactly `https://api.frankfurter.dev/v2/rates?date=YYYY-MM-DD&base=EUR`. Callers may inject `fetcher` only for tests; no caller-supplied host/path is accepted. Validate ISO dates strictly. Validate the v2 array rows: provider date/base, three-letter registered quote codes, finite positive decimal rates, no duplicate quotes, and bounded count/body size. EUR is the identity quote. A missing registered quote is unavailable, not zero or an invented rate. The provider effective date and validated decimal-rate strings must be serializable in the returned snapshot. Use an AbortController timeout and reject non-2xx, timeout, malformed, empty, oversized, or non-array responses without logging response bodies. Keep response parsing bounded.

Conversion requirements:

- Use the existing shared registry/minor-unit metadata (`src/domain/currencies.ts` and `contracts/currencies.json`).
- Use exact decimal-rational/BigInt arithmetic; do not persist binary floating point or round the EUR cross-rate.
- Convert source minor units through EUR to target minor units and round exactly once, half-up, at target minor-unit precision.
- Preserve the amount sign after magnitude rounding; return `null` for unavailable/invalid inputs or unsafe integer output.

Tests must cover valid rows, EUR identity/inversion, cross-rates, one-time target rounding, signed refunds, unknown/non-finite/negative/duplicate rates, invalid dates, fixed endpoint construction, timeout/HTTP failures, and bounded response rejection. Follow existing Vitest conventions and run:

1. `npm test -- tests/fx-rates.test.ts --run` (first confirm new tests fail before implementation if practical, then make them pass).
2. `npm run typecheck`.

Write a report to `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-1-report.md` containing files changed, tests/commands and outputs, and any concerns. Return only a concise status plus the report path.
