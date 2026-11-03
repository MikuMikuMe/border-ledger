# Wealth and investment tracking

Wealth extends Border Ledger with assets, debts, brokerage portfolios, dated net worth, and cash-flow reports. The web workspace has a Wealth destination. Android keeps its four primary navigation destinations and puts Wealth under More.

## Getting started

1. Add an existing bank account link, a manual asset/debt, or a brokerage account.
2. For an aggregate account, record a dated total. For a holdings account, record opening cash and opening positions, including their cost basis when known.
3. Record trades and cash activity, or download the canonical CSV template and import a file through the review flow.
4. Add dated prices manually or enable optional provider quotes. Inspect original-currency totals and coverage before using a converted estimate.

Opening-cash activity is available only for holdings accounts. Aggregate assets, debts, and brokerage accounts use dated total-value observations.

Holdings and account cash replace an aggregate brokerage balance; they are never added on top of it. Investment balances do not automatically become budget funding. A linked bank account uses the existing connection and does not create new access to a brokerage.

## Investment calculations

The supported scope is long-only Canadian and US stocks/ETFs with fractional quantities and CAD/USD investment cash. Trade consideration, fees, withholding, dividends, contributions, withdrawals, splits and transfers are recorded explicitly. Corrections and reversals retain their original records.

To fix activity, choose Record event and select Correction or Reversal. A correction selects the original activity and records a typed replacement; a reversal removes its effect while retaining the audit history. Keep an existing linked Activity record unless you intentionally replace that link. Failed submissions retain their draft identity so retrying does not create a second event.

Gains use moving weighted-average cost for portfolio analysis. They are not tax-return calculations. Unknown opening basis keeps gains unavailable. A closed position retains realized gains. Missing prices, incomplete flows or inadequate dated valuations keep dependent figures unavailable.

Modified Dietz uses dated external portfolio flows and end-of-day valuation boundaries. Household income/spending is presented separately from investment performance. Original currencies remain separate unless an explicit dated exchange-rate conversion is complete.

## CSV review

Download the current template from Wealth; it is the authority for field names and supported record types. Preview shows mapping/validation results, duplicate records and errors before an atomic confirmation. Stable source identities make retries and repeated imports idempotent while preserving distinct trades with different identities. Exports use the same canonical format.

Brokerage representation changes use an effective date and explicit opening cash, positions, or an aggregate value. The server commits each change atomically and keeps the earlier representation in historical reports. Recorded account currency, kind, and linked-bank identity cannot be changed retroactively; names remain editable.

Never place API credentials in a CSV. Importing a file does not silently repair missing basis or fabricate historic prices.

### CSV fields and units

| Record type | Required identity and fields |
| --- | --- |
| `account` | `id`, `name`, `account_kind`, `account_mode`, `currency`; optional linked bank account and active flag |
| `instrument` | `id`, `exchange`, `ticker`, `type` (`stock` or `etf`), `currency` |
| `event` | `id`, stable `source_id`, `date`, `kind`, account reference, and the fields for that activity |
| `valuation` | `id`, `account_id`, `as_of`, `price_minor`; add instrument identity for a holding price |
| `mode_transition` | `account_id`, `effective_date`, `from_mode`, `to_mode`, and the dated opening data |

Dates use `YYYY-MM-DD`. Valuation dates represent closing observations. Money columns ending in `_minor` are integer minor units: CAD 12.34 is `1234`. Quantities are decimal strings, including fractional shares. Opening basis may be blank when unknown; a required blank amount is an error. A split uses positive integer `numerator` and `denominator` columns. Transfers use `from_account_id`, `to_account_id`, and `transfer_kind` (`cash` or `position`).

Keep each activity's `source_id` stable when retrying or reimporting it. Give two genuinely distinct trades different source identities even when their dates and amounts match. The canonical export includes `event_json` for complete correction/reversal details; preserve it when roundtripping an exported file. The column-mapping controls can map differently named source columns into this format before confirmation.

A `mode_transition` row uses `opening_cash_minor`, `opening_value_minor`, or `opening_positions_json` as appropriate. Canonical exports include `transition_json` for the complete normalized transition. They omit its generated opening events/valuations, which are recreated exactly once when imported. Keep exported source identities unchanged; local event sequences are reassigned in the destination ledger.

## Optional free quotes

All manual and CSV workflows work without a market-data subscription. Each private ledger can optionally save its own Alpha Vantage key. Prices are dated observations, not guaranteed live quotes. Coverage and provider availability may vary; failed refreshes retain prior observations and allow manual updates.

The adapter uses the fixed Alpha Vantage host. Search, identity confirmation and quote requests share a conservative local allowance of 25 requests per rolling 24 hours; provider-side limits can still reject a request. An initial US security refresh can use three requests: symbol search, exchange/type confirmation, and the dated quote. Cached observations do not consume another request. Free quote coverage is normally end-of-day; the observation date is displayed. No premium entitlement, automatic upgrade or paid purchase is used. Credentials are never returned to either client.

Operator setup requires an independent `WEALTH_CREDENTIAL_ENCRYPTION_KEY`, a 32-byte hexadecimal secret. Do not reuse an AI credential-encryption key. Losing or rotating this secret requires users to replace saved market-data keys. Never commit secrets or Android `local.properties`.

## Compatibility and rollout

Apply migration `0033-wealth.sql` before enabling the new routes. Existing records and provider account kinds remain unchanged. Android adds `wealth:read` and `wealth:write` permission scopes; existing sessions may need a fresh sign-in. New financial data is not automatically included in AI requests.

This feature does not add brokerage trading, shorts, options, margin accounting or tax filing. Migration and production deployment are separate operator actions; this implementation task does not deploy or merge production.
