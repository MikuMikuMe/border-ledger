# Border Ledger

Border Ledger is a production cross-border spending workspace for CAD and CNY accounts. It is deliberately reconciliation-first: statement imports are reviewable, source currencies stay visible, and provisional alerts never disappear into a confirmed total. The source code is public; access to the live financial workspace remains protected by Cloudflare Access. No customer bank data or secret values belong in this repository.

This repository is licensed under the all-rights-reserved terms in [LICENSE](LICENSE).

## Features

- Responsive React + TypeScript dashboard with Overview, Transactions, Import & review, and Accounts & settings surfaces.
- CAD/CNY totals for today, this week, and this month.
- Confirmed, provisional, and needs-review states.
- CSV preview/import flow with duplicate fingerprints and malformed-row feedback.
- Cloudflare Worker API contract for D1-backed accounts, transactions, reports, imports, Plaid webhooks, and Queues.
- Plaid Link connection flow with encrypted access-token storage, verified webhooks, and queued Transactions sync.
- Provider-backed recurring-payment snapshots stored in D1, with bounded list/detail APIs, source estimates, posted-ledger cost, and local classification.
- GitHub Actions checks and Cloudflare deployment workflow.

The public welcome page uses clearly labeled representative data. The private `/app` workspace reads its accounts, transactions, and recurring feed from the Worker and shows explicit loading, empty, stale, and error states; it never falls back to demo data.

## Production service

The live workspace is served from [pf.lofuyu.com](https://pf.lofuyu.com). Production uses the existing `border-ledger` Worker, D1 database, and Queues configured under Wrangler's `production` environment. The deploy workflow runs from `main` and always deploys with `--env production`; it does not create a second production service. The raw Worker hostname is not an application origin: browser routes redirect to the custom origin and API requests to the raw hostname return `404`.

The top-level Wrangler settings are for local development only. They keep Plaid Sandbox enabled so local tests cannot accidentally call Plaid's production API; production deployments must use the explicit `production` environment and its separately managed secrets.

## Local development

```bash
npm ci
npm run dev
```

Run the quality gates:

```bash
npm run typecheck
npm test
npm run build
```

## Local and production configuration

The production D1 database and Queues are already provisioned and bound in `wrangler.jsonc`. Do not create replacement resources or point a production deployment at a local-development binding. Production migrations and deployment run through `.github/workflows/deploy.yml` after its quality gates and credential checks pass.

For local development, use the Wrangler default environment and local D1. Keep `PLAID_ENV=sandbox` locally. The production environment sets `PLAID_ENV=production` and must only be deployed through the explicit production workflow.

Worker secrets must be configured in Cloudflare and GitHub Actions, never committed or exposed to the browser. The Worker fails closed if required authentication or mobile identity allowlists are missing. Generate encryption keys from cryptographically secure random bytes, keep them independent, and do not replace stable production keys during ordinary deployments.

The public welcome page stays outside the Access login wall. Protect `/mobile/authorize`, `/app/*`, `/api/mobile-auth/*`, and the financial API routes. The only intended Access bypass is `/api/webhooks/plaid`; the Worker verifies Plaid's signed webhook header before enqueueing a sync. The browser uses the Access session cookie and never receives the ledger API key.

### Production rollout gate

The live production service is the existing `border-ledger` Worker used by [pf.lofuyu.com](https://pf.lofuyu.com). Its Wrangler `production` environment keeps the existing D1 database and queues. Do not create replacement production resources or deploy the local-development environment.

Every production deployment should follow the automated release path:

1. Review changes and run the local typecheck, tests, and build.
2. Merge approved changes to `main`; the deploy workflow checks required production secrets and Access smoke-test credentials, applies versioned migrations with the production environment, deploys the existing Worker, and verifies the production health and Android App Links routes.
3. Keep the existing `pf.lofuyu.com` route and Access application attached to the production Worker. The deployment workflow does not alter Access policies.
4. Keep the Cloudflare zone rule that rate-limits `POST /api/webhooks/plaid`. The webhook is public to Plaid, so signature verification and edge throttling are both required.

## Import format

CSV files must include `Date`, `Description`, and `Amount`. `Currency` and `Category` are optional; currency defaults to CAD. Dates use `YYYY-MM-DD` and amounts are parsed as decimal major units.

## Plaid/RBC flow

Open Accounts & settings and choose Start bank connection. Plaid Link runs in the browser, returns a short-lived public token and account metadata, and the app asks you to explicitly choose which accounts may be stored. The Worker independently verifies those IDs against Plaid’s `/accounts/get` response before exchanging and persisting anything. The access token is encrypted with `PLAID_ENCRYPTION_KEY`; the browser never sees it. Plaid webhooks enqueue a `/transactions/sync` job, which imports added and modified records, removes deleted records, replaces pending records when they post, and advances the cursor only after D1 writes succeed.

The account options menu includes Disconnect Plaid connection. That action calls Plaid’s Item removal endpoint first; only after Plaid confirms revocation does the Worker delete the encrypted access token and mappings. Existing ledger transactions remain available as historical records.

Use Plaid’s Sandbox test institution and credentials while `PLAID_ENV=sandbox`. Sandbox transactions are simulated; test an actual RBC Item only after enabling the appropriate Plaid production access. The Bank of China/WeChat path remains statement or Android-companion work and is not changed by this integration.

## Android production releases

Android production releases are built and signed by `.github/workflows/android-release.yml`, then promoted by `.github/workflows/android-promote.yml` after validating the accepted source SHA, APK checksum, signing certificate, and owner acceptance evidence. Private acceptance evidence is removed before the release is made public.

The checked-in Gradle wrapper and Android build configuration are used by CI. CMB remains unsupported and statement-import-only until independent source evidence exists. See [`docs/android-validation.md`](docs/android-validation.md) for the native feature and acceptance matrix.
