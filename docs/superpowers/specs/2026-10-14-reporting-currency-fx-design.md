# Reporting Currency and Purchase-Time FX Design

## Intent

Border Ledger must let a user choose one reporting currency for the spending total while preserving every transaction's original currency. The Worker will use Frankfurter's daily historical rates, lock each transaction to its purchase/accounting date, and expose enough provenance for the web and Android UIs to explain what was converted and what could not be converted.

The existing `preferredCurrency` preference remains the compatible API/storage name, but its meaning becomes the user's reporting currency. `null` keeps the source-currency view and performs no conversion.

## Goals

- Accept every currency already accepted by the shared ISO registry in WeChat/statement/Plaid data without changing the source amount or currency.
- Allow a user to select any registered ISO currency as the reporting target.
- Convert spending using Frankfurter v2 daily rates through the Worker, never from an untrusted client URL and never from a current rate for an older purchase.
- Lock the effective exchange observation to each transaction's source date. A later provider refresh must not change an existing transaction's conversion.
- Refresh the current daily observation periodically in Cloudflare Workers for new purchases and report reads.
- Show source-currency totals and converted totals together when a reporting target is selected.
- Show a clearly labeled dashed ±1.5% band for eligible non-CNY spending on a Bank of China/BOC account; CNY spending is never included in that band.
- Keep the same report semantics on the website and native Android app.
- Run app builds in GitHub Actions when app code/contracts change, while backend-only changes do not start the app build job.
- Verify arithmetic, provider failure behavior, UI behavior, Android behavior, and a STRIDE security review.

## Non-goals and anti-goals

- This is not a live-trading or intraday FX product. Frankfurter's daily reference observations are the stated estimate source.
- No client-side request may accept an arbitrary Frankfurter URL, API key, or rate payload.
- No conversion is invented for a registered currency with no Frankfurter observation on the locked date. The report remains honest about unavailable source currencies.
- No original amount, source currency, transaction date, or confirmed/provisional state is rewritten as a side effect of changing the reporting target.
- No BOC ±1.5% band is shown for CNY source spending. The band is an estimate of the settlement uncertainty described by the Visa/BOC timing analysis, not a claim about the exact card posting amount.

## Provider contract

Use the official public API at `https://api.frankfurter.dev/v2`:

- Historical observations: `GET /rates?date=YYYY-MM-DD&base=EUR`.
- Periodic current observation: the same endpoint with today's UTC date.
- The response is an array of `{ date, base, quote, rate }` rows. Store only validated finite positive rates whose quote is a registered three-letter currency.
- Frankfurter supplies daily observations and supports local storage. The response's `date` is the provider's effective observation date; the request date remains the transaction lock key so weekends/holidays consistently reuse the same observation.
- EUR is the normalized pivot. For source `S` and target `T`, calculate `S -> EUR -> T` from the stored EUR quote rates; source or target EUR uses a unit rate.
- Rates are parsed as decimal strings and converted with integer arithmetic to target minor units using one round-half-up operation at the target currency's minor-unit precision. The intermediate EUR cross-rate is never rounded, and no binary floating point result is persisted.
- A provider timeout, non-2xx response, malformed body, or missing quote leaves the source total intact and marks the conversion incomplete.

## Locking and persistence

Add an additive migration after the current highest migration:

1. `transactions.fx_lock_date TEXT` is populated from the canonical transaction date on insert and backfilled for existing rows. It is immutable after the transaction is created. Alert projections use the original event's canonical date; pending-to-posted updates do not move the lock date.
2. `fx_rate_snapshots` stores one immutable provider observation per requested lock date: requested date, provider effective date, provider name/version, validated EUR quote JSON, fetched timestamp, and a content digest. A unique requested date prevents later refreshes from rewriting a snapshot used by old transactions.
3. A snapshot is fetched when a report needs a missing lock date and is also pre-fetched by the Worker schedule for the current date. The first valid response wins for a requested date and is immutable forever. A response that is valid but lacks a registered quote is still a successful snapshot; that currency is unavailable for that date. HTTP, timeout, malformed, or empty responses are retryable and do not create a snapshot.
4. All snapshot writes and transaction lock-date writes are server-side. Snapshot JSON is bounded and validated; immutable triggers prevent update/delete of an observation referenced by a transaction.

Existing hand-written test fixtures may omit the new column; the migration/backfill and report decoder treat a missing historical snapshot as unavailable rather than failing the ledger read.

## Report contract

The current source totals remain in `currencyTotals` and `dailyTotals`. Additive fields are:

```text
reportingCurrency: string | null
convertedTotals: {
  confirmedMinorUnits: number
  provisionalMinorUnits: number
  confirmedCount: number
  provisionalCount: number
} | null
convertedDailyTotals: [{ date, confirmedMinorUnits, provisionalMinorUnits }]
fx: {
  provider: "frankfurter"
  complete: boolean
  unavailableSourceCurrencies: string[]
  lockedDateCount: number
  observedDateRange: { earliest: string | null, latest: string | null }
  chineseBankBand: {
    eligible: boolean
    currency: string
    baseMinorUnits: number
    lowerMinorUnits: number
    upperMinorUnits: number
    percentageBasisPoints: 150
  } | null
}
```

`currency` in the existing report query remains the source-currency filter for compatibility. A new `reportingCurrency` query parameter selects conversion. If it is omitted, the API stays in source-currency mode; the website and Android app pass the saved `preferredCurrency` explicitly. Owner/mobile routes expose the same additive report fields.

Reports aggregate all matching canonical rows, not just the paginated Activity page. Transfers and excluded states retain existing behavior. When conversion is incomplete, `convertedTotals` contains only rows with validated locked rates and `fx.complete=false`; the UI must label it partial and list unavailable source codes rather than presenting it as a final total.

## Chinese bank uncertainty rule

For the report's selected target, join transactions to their account institution. Treat an account as BOC when the normalized institution contains `bank of china`, `boc`, `中国银行`, or `中國銀行` (case-insensitive). This is deliberately narrow and auditable; a generic Chinese institution name is not guessed to be BOC.

Accumulate the converted spending contributed by eligible BOC rows whose source currency is not `CNY`, using the same confirmed/provisional inclusion toggle as the report. Apply ±1.5% (150 basis points) to that component after conversion and round both bounds once to target minor units; negative/refund values keep their sign after magnitude rounding. CNY rows are excluded even when the selected reporting currency is not CNY. If an eligible BOC component has an unavailable rate, omit the band and expose the report as incomplete rather than showing a misleading partial range. If no eligible component exists, omit the band. The report and both UIs label the box as an estimate of Chinese bank settlement timing, not provider-rate accuracy.

## Runtime flow and failure behavior

1. A statement, Plaid, or alert writer stores the canonical row and its immutable `fx_lock_date`.
2. A report request validates the registered reporting target, loads/creates missing historical snapshots through the fixed Frankfurter client, and aggregates source plus converted totals.
3. `scheduled` runs daily at a configured UTC time to warm the current snapshot. It never mutates an existing snapshot or transaction.
4. If Frankfurter is unavailable, source totals still render. Converted totals are marked unavailable/partial and the last locked observations remain usable.
5. The website and Android app request the target explicitly and render rate provenance/unavailable codes. Changing the preference reloads the report; it does not mutate ledger rows.

## UI behavior

### Website

- Accounts & settings changes the existing control to “Total spending currency”, with a source-preserving option and registered ISO options.
- Overview's primary total and chart use `convertedTotals`/`convertedDailyTotals` when a target is selected; source lanes remain visible below as the audit trail.
- The primary panel displays “locked to purchase dates · Frankfurter daily rates” when complete, or a partial/unavailable message otherwise.
- A visible dashed-border box shows the BOC component range as `lower – upper TARGET`, with “±1.5% Chinese bank settlement estimate; CNY spending excluded”. It is not color-only and has an accessible label.
- Original transaction rows continue to show source currency and amount.

### Android

- Settings uses a bounded reporting-currency selector over the shared registry and preserves the same preference revision behavior.
- Overview's “Reporting lens” selects the reporting target, not a source filter. The converted total is primary; source totals and daily converted totals remain inspectable.
- The same dashed uncertainty component is rendered with a content description and text label. Partial reports explicitly list unavailable source codes.
- The bounded JSON decoder ignores unknown future fields but validates all new numeric fields as safe integers and all currency codes through `CurrencyRegistry`.
- A debug-only deterministic FX report fixture/activity reuses the production range/total composables so emulator QA can exercise complete, partial, provisional, and BOC/CNY cases without credentials or live provider traffic.

## GitHub build policy

Keep general web/backend CI unchanged. Add a separate app-build workflow/job triggered by `push`, `pull_request`, and manual dispatch with the following exhaustive app-owned paths:

- `android/**`
- `src/**` and `index.html`
- `contracts/**`
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, and `public/**`
- the app-build workflow itself

Backend-only paths such as `worker/**`, `wrangler.jsonc`, and backend-only tests must not match this job's path list. The app job runs web typecheck/build and Android lint/unit tests with the checked-in wrapper/toolchain policy; it must not claim signing without protected signing inputs.

## Security and privacy requirements

- Allowlist provider host/path, ISO date, and registered quote codes; cap URL/query, response bytes, rate count, and snapshot JSON size.
- Use timeout/cancellation and no-store semantics for provider requests. Do not log URLs containing user data or provider bodies.
- Keep all FX report reads behind the existing owner/API authorization and same-origin guards. Never allow a report target to select another user's ledger.
- Use parameterized D1 queries and account joins only inside the personal ledger scope.
- Make snapshots tamper-evident by digesting the canonical validated payload and immutable by trigger.
- Add tests for invalid target/URL attempts, malformed provider data, oversized responses, snapshot rewrite, unauthorized routes, and BOC-band source exclusion.
- Complete and record a STRIDE review before claiming release readiness.

## Acceptance evidence

- TypeScript unit/D1 tests prove historical cross-rate arithmetic, minor-unit rounding, snapshot immutability, provider failure degradation, complete/partial reports, and the exact BOC/CNY rule.
- Existing web tests plus a real browser smoke prove selecting a target changes the total, source amounts remain visible, the dashed box appears only when eligible, and changing the window/provisional toggle preserves behavior.
- Android unit tests prove DTO decode/validation and view-model/report selection; a connected emulator test proves settings selection, converted total, partial warning, and dashed-box copy.
- GitHub workflow path inspection proves app changes trigger the build and backend-only changes do not.
- Fresh `npm test`, `npm run typecheck`, `npm run build`, Android lint/unit/release assembly, emulator QA, and the written STRIDE audit are required before completion.

