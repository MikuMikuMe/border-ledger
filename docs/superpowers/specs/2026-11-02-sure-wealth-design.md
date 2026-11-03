# Sure-inspired Wealth implementation

Approved 2026-11-02. Goal: web and Android assets/debts/net worth, Canada/US long-only stock/ETF investment accounting, cash flow, manual/CSV workflows and optional free dated Alpha Vantage quotes. No required paid data service; no production deployment or merge.

## Architecture and boundaries
React/TypeScript/Vite web and React Native Android consume authoritative tenant-scoped Worker/D1 reports through existing authenticated transports. Separate wealth registry preserves bank Account kinds and budget funding. Aggregate brokerage values are mutually exclusive with holdings plus cash. Original currencies and dated observations remain visible. Unknown basis/prices/FX/history never become zero. No investment data automatically enters AI requests.

## Required behavior
Manual assets/debts and linked existing balances; net worth history from actual observations only. Canadian/US stock/ETF security identity includes exchange/ticker/type/currency. Exact fractional arithmetic; weighted average basis; realized/unrealized gains; Modified Dietz only with complete start/end values and dated external flows. Opening positions/cash, buy/sell, dividends/withholding/fees, contributions/withdrawals, splits/transfers and append-only corrections. No shorts/options/margin/tax reports. Explicit linked source IDs prevent duplicate cash-flow counting.

Canonical CSV preview/mapping/validation/duplicate detection followed by atomic confirm and export. Optional encrypted per-ledger market-data key; fixed Alpha Vantage endpoints; conservative free request allowance with atomic reservation; dated cache and manual fallback; no premium calls or automatic payments.

## UX
Wealth web navigation with Overview/Investments/Cash flow. Android More > Wealth with same subviews plus overview link, keeping four bottom tabs. Preserve paper/ink identity. Accessible history/portfolio charts and text/table alternatives, account/security drilldown, complete forms and loading/empty/error/incomplete/stale/permission states. Use UI Pro Max then Impeccable composition/critique, visual check real sizes.

## Acceptance
Accounting/tenancy/revocation/concurrency/CSV/quote regression tests; root/mobile typechecks, builds and tests; Android native tests/lint/debug/release; browser responsive keyboard check; mandatory local Android emulator create/import/trade/dividend/price/report/relaunch and dark/light/large text/Back/keyboard/TalkBack evidence. CodeScene per-file, precommit and change-set against origin/main. Open one PR, resolve applicable hosted failures. No live quote verification claim without a key.
