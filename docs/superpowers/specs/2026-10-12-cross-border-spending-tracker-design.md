# Cross-Border Spending Tracker — MVP Design

## Intent

Ship a private, mobile-friendly spending workspace that can prove its totals from imported statements before it relies on bank automation.

## Goals

- Provide a usable dashboard for today, this week, and this month.
- Keep CAD and CNY source totals separate and make conversion explicit.
- Import CSV statements through a preview/review workflow with duplicate protection.
- Model confirmed records separately from provisional alerts.
- Make Cloudflare Worker/D1/Queues and GitHub Actions the deployment foundation.

## Non-goals for this slice

- Collecting bank passwords or storing live Plaid secrets in the client.
- Claiming live RBC connectivity before a real Plaid Item is tested.
- Reading Bank of China or WeChat notifications from the web app.
- PDF/screenshot OCR, Android companion code, budgets, or multi-user sharing.

## Constraints and calls

- Call: use a modular monolith Worker so the private app stays easy to operate.
- Call: use D1 for normalized records and Queues for future sync/import jobs.
- Call: use a local demo dataset in the UI so the first render is useful without private data.
- Call: keep the API contract ready for imports and reports; Cloudflare deployment can be added without changing the UI domain model.
- Open: exact Plaid account eligibility, bank statement columns, BOC account region, and phone platform.

## Core workflow

1. Open the dashboard and choose a reporting window.
2. Compare CAD and CNY confirmed spending; optionally include provisional alerts.
3. Inspect transactions by currency, category, and state.
4. Upload a statement, preview parsed rows, resolve duplicates, and commit accepted rows.
5. Re-run the same reporting functions against normalized records.

## Quality bar

- Money is integer minor units in the domain and formatted only at the edge.
- Transfers, refunds, pending/posting changes, and duplicate imports have tests.
- UI is keyboard-accessible, responsive at 390px, and uses text plus color for state.
- CI runs typecheck, tests, and production build on every push.
