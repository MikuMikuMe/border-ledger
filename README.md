# Border Ledger

Border Ledger is a reconciliation-first personal-finance workspace for cross-border accounts. It keeps original currencies visible, separates provisional alerts from confirmed transactions, and brings spending, budgets, recurring plans, and wealth into one ledger. The web workspace and Android companion use the same authenticated Cloudflare API.

The source is public under the all-rights-reserved terms in [LICENSE](LICENSE). The live financial workspace at [pf.lofuyu.com](https://pf.lofuyu.com) is private and protected by Cloudflare Access. No customer financial data or secret values belong in this repository. Features described here reflect this checkout; a feature branch is not evidence of production deployment.

## Features

| Area | What it supports |
| --- | --- |
| Spending and reconciliation | Original-currency transactions, dated reporting-currency estimates, confirmed/provisional/review states, category reporting, statement CSV preview and duplicate detection. CAD/CNY spending remains a core workflow. |
| Bank connections | Explicit account selection, encrypted Plaid credentials, signed webhooks and queued transaction/recurring synchronization; Lunch Flow connection, account balances and queued sync with stale-state handling. |
| Recurring planning | Provider estimates alongside manual recurring plans, dated occurrences and links to confirmed ledger transactions. An estimated payment is not confirmation that money moved. |
| Budgeting | Planning and tracking modes, targets, allocations, rollover, transfers, manual cash and eligible linked-account balances. Missing funding is shown explicitly. |
| Wealth | Assets, debts, net-worth observations, long-only Canadian/US stocks and ETFs, CAD/USD brokerage cash, trades, dividends, fees, splits and linked transfers. Holdings, gains, allocation, cash flow and Modified Dietz returns include missing-data reasons. |
| Portable investment data | Manual entry and CSV templates, mapping/preview, row validation, duplicate-safe atomic imports and exports on web and Android. No market-data subscription is required. |
| Optional dated quotes | Independently encrypted per-ledger Alpha Vantage key, shared lookup/refresh allowance, cached observations and manual/CSV fallback. Free quotes are dated end-of-day data, not guaranteed live prices. |
| Optional AI analysis | User-supplied OpenAI, Anthropic or DeepSeek credentials; explicit request review; transaction-detail sharing off by default. Wealth is not included in AI requests. |
| Android companion | React Native production shell, Kotlin repositories/native bridge and shared core, scoped sessions, statement/file workflows and device capture/review. Four primary destinations remain Overview, Activity, Review and More; Wealth sits under More. |

The public welcome page uses labeled representative data. The private `/app` workspace reads the Worker API and exposes loading, empty, stale, unavailable and error states; it does not substitute demo financial records.

See the [Wealth guide](docs/features/wealth.md), [Wealth verification evidence](docs/qa/wealth/README.md), [budget verification evidence](docs/qa/actual-budget/README.md), [Lunch Flow guide](docs/lunchflow.md), and [Android runtime guide](mobile/README.md).

## Architecture

![Border Ledger component architecture: web and Android clients call the Ledger Worker; the Worker uses D1, sync queues, financial providers and optional official AI APIs.](docs/architecture/overview.svg)

[Open the editable diagram](docs/architecture/overview.html) · [Diagram sources and design notes](docs/architecture/README.md)

| Component | Responsibility |
| --- | --- |
| Web — `src/` | React, TypeScript and Vite. Public landing page, Access-protected workspace and mobile authorization page. The Worker serves the built static assets. |
| Android — `mobile/`, `android/`, `shared/core/` | React Native launches the production interface. Kotlin bridge modules own native sessions, repositories, capture and file operations; shared core contains reusable domain contracts. Retained Compose screens and previews are not the production launcher. |
| Ledger API — `worker/` | Authentication, ledger isolation, scoped mobile authorization, imports, provider connections, budgets, recurring plans, wealth calculations and reporting. Financial calculations stay authoritative on the server. |
| D1 — `worker/migrations/` | Versioned ledger records, sessions, review state, plans, budgets, investment events/observations, import state and encrypted provider credentials. Wealth has a separate registry; linked-account types and budget eligibility remain distinct. |
| Queues and scheduled jobs | Plaid and Lunch Flow synchronization, retry and dead-letter handling. Connection revisions and sync generations protect against stale writes. |
| External providers | Plaid/Lunch Flow supply supported financial data; Frankfurter supplies dated FX; optional Alpha Vantage supplies dated security quotes. Imports and manual observations cover unsupported or unavailable data. |
| Optional AI | The active analysis path calls fixed official provider endpoints directly from the Ledger Worker. A separate Durable Object/Container egress implementation lives in `ai-egress/` and `wrangler.ai-egress.jsonc`; it is not wired into the current analysis runtime or main deployment. |

The main Worker build, assets, D1, queue bindings and production environment are defined in [`wrangler.jsonc`](wrangler.jsonc). The diagram is a component overview, not a complete authentication or network-security map.

### Identity and data boundaries

- Browser requests use a verified Cloudflare Access identity. The browser never receives the ledger API key. Registration is closed; hosted identities must be provisioned deliberately.
- Android uses the Access approval/PKCE authorization flow, then scoped access/refresh sessions. Wealth requires `wealth:read` and `wealth:write`; an older session may need a fresh sign-in. Preferences changes require `preferences:write`.
- Reads and writes are bound to the authorized user and ledger. Provider credentials are encrypted on the server and never returned to clients.
- AI credentials and market-data credentials have separate encryption configuration. Each AI request requires user review; detailed transaction sharing defaults to off. Requests use exact official endpoints with no custom endpoints or redirects. Wealth data does not enter this path.
- Net worth uses actual dated observations. Missing history, prices, basis or FX remain unavailable; they are not fabricated or treated as zero. Brokerage aggregate balances and holdings-plus-cash are counted once.

See the [closed-registration runbook](docs/closed-registration-auth-runbook.md), [hosted-user rollout](docs/hosted-users-rollout.md) and [native bridge contracts](mobile/src/native/specs/README.md).

## Local development and validation

```bash
npm ci
npm run dev
```

The Vite command starts the web development server. Backend routes require a separately configured local Worker and migrated local D1 database; use the default Wrangler environment for local resources. Do not point development at production bindings.

```bash
npm run typecheck
npm test
npm run build
```

Android setup, native/bridge checks and build commands are documented in [mobile/README.md](mobile/README.md) and [React Native validation](docs/react-native-validation.md). Keep SDK, emulator, Java and Gradle paths in local configuration; do not commit `android/local.properties`, signing material or credentials. Emulator acceptance evidence for Wealth is retained in [docs/qa/wealth](docs/qa/wealth/README.md).

### Imports

Statement imports require `Date`, `Description` and `Amount`; `Currency` and `Category` are optional. Currency defaults to CAD, dates use `YYYY-MM-DD`, and amounts are decimal major units. Preview rows before confirming.

Investment activity and valuations use a separate, documented multi-record CSV format. Download the template from Wealth and follow the [Wealth CSV guide](docs/features/wealth.md). Preview validates rows and duplicate identities before atomic confirmation; retries must not duplicate positions or cash.

### Provider configuration and limitations

Plaid defaults to **production**, including the default Wrangler configuration; this repository does not configure Plaid Sandbox. Link creation fails closed until credentials and a valid HTTPS webhook exist. Use only explicitly authorized production test accounts for live validation. The Worker independently verifies selected account IDs before storing their mappings, encrypts access tokens and advances sync cursors only after successful writes. Disconnect revokes the Plaid Item before deleting its credentials; historical ledger transactions remain.

Lunch Flow setup and connection behavior are documented in [docs/lunchflow.md](docs/lunchflow.md). CMB remains unsupported and statement-import-only; Bank of China/WeChat workflows rely on statements or supported Android capture rather than an assumed live integration.

Wealth supports long-only Canadian/US stocks and ETFs, not options, shorts, margin, brokerage trading or tax filing. Gains are portfolio analytics, not tax-reporting calculations. Alpha Vantage is optional and conservatively limited to the free allowance shared by lookup and refresh. Provider failures retain the last observation with its source/date. Current live-key limitations and mocked-provider coverage are recorded in the [verification evidence](docs/qa/wealth/README.md). [Provider limits](https://www.alphavantage.co/support/) · [Quote documentation](https://www.alphavantage.co/documentation/).

## Deployment and releases

The existing production service is the `border-ledger` Worker at [pf.lofuyu.com](https://pf.lofuyu.com), using Wrangler's explicit `production` environment and its existing D1 database and queues. Do not create replacement production resources. Browser routes on the raw Worker hostname redirect to the custom origin; raw-host API requests return `404`.

The public welcome page stays outside Access. Protect the workspace, mobile authorization and financial/authentication APIs. Plaid's webhook is the intended public bypass; signature verification and edge rate limiting remain required.

The main-only [deployment workflow](.github/workflows/deploy.yml) validates credentials, applies versioned production migrations, deploys the existing Worker and checks health, Access and Android App Links. It does not change Access policies. The main-only [Android release workflow](.github/workflows/android-release.yml) is gated by application-file changes and runs native checks, signing and release publication. CI also validates the separate AI-egress image; that does not make it part of the main deployment.

For a Worker update including these features, apply migrations in sequence, including `0028` (recurring plans), `0029` (budget), `0030` (AI settings), `0031` (budget tracking), `0032` (official AI providers) and `0033-wealth.sql`. Existing ledger entries are preserved. Follow the [Wealth rollout instructions](docs/features/wealth.md) and retain the `global_fetch_strictly_public` compatibility flag.

Configure secrets through Cloudflare/GitHub Actions, never client configuration or committed files. AI credential storage requires an independent `AI_CREDENTIAL_ENCRYPTION_KEY`; quote credential storage uses the separate key documented in the Wealth guide. Back up stable encryption keys securely: changing them during an ordinary rollout makes existing encrypted credentials unreadable. Repository changes do not configure secrets or deploy production automatically.
