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

The top-level Wrangler settings use local D1 and default Plaid to production; this repository does not configure Plaid Sandbox. Production deployments must use the explicit production environment and its separately managed secrets.

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

For local development, use the Wrangler default environment and local D1. Plaid defaults to production, and Link-token creation fails closed until production credentials and a valid HTTPS webhook are configured. To test the live Plaid flow locally, expose the local Worker through an HTTPS tunnel, set PLAID_ENV=production, and set both LEDGER_APP_ORIGIN and PLAID_WEBHOOK_URL to that same public tunnel origin, for example: npx wrangler dev --var "PLAID_ENV:production" --var "LEDGER_APP_ORIGIN:https://your-tunnel-host" --var "PLAID_WEBHOOK_URL:https://your-tunnel-host/api/webhooks/plaid". Use this only for intentional production tests with authorized test accounts; Plaid will make real production API calls. The production Wrangler environment and its resources must only be deployed through the explicit production workflow.

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

The Plaid/RBC connection flow uses production. Configure production credentials and connect only accounts explicitly approved for live synchronization; use a designated production test Item for validation. The Bank of China/WeChat path remains statement or Android-companion work and is not changed by this integration.

## Android production releases

Android production releases are built, signed, and published as normal public releases by `.github/workflows/android-release.yml` when application files change on `main`. Device-specific acceptance checks can continue after installation and do not delay publication.

The checked-in Gradle wrapper and Android build configuration are used by CI. CMB remains unsupported and statement-import-only until independent source evidence exists. See [`docs/android-validation.md`](docs/android-validation.md) for the native feature and acceptance matrix.

### Budgeting and optional AI analysis

Apply migrations `0029-budget.sql` and `0030-ai-settings.sql` before running a Worker version with budgeting and analysis. Existing ledger entries are not changed. Lunch Flow balances are refreshed alongside account syncs; unavailable or stale balances are shown as unavailable until refreshed or explicitly overridden. Manual cash represents money outside linked accounts, while a custom linked-account balance replaces that account's synced amount.

AI analysis is optional. Configure the Worker secret `AI_CREDENTIAL_ENCRYPTION_KEY` as an independent, securely generated 32-byte hexadecimal key before enabling credential storage. Back up this key securely; changing or losing it makes previously stored provider keys unreadable and users must replace them. Do not commit the key or put it in client configuration. Provider credentials are encrypted per user and ledger. Users must review and initiate each request; transaction detail sharing defaults to off. Provider requests use a private, separately provisioned AI egress service that resolves and pins public addresses, verifies TLS, and does not follow redirects. Analysis fails closed when that service is unavailable. The service requires a Cloudflare Containers-capable account, a container build, and a private service binding; provision and verify it separately before rolling out the main Worker. Configure the same independently generated 32-byte hexadecimal `AI_EGRESS_AUTH_KEY` secret on both Workers to authenticate gateway requests; without it, analysis fails closed. The existing deployment workflow does not deploy this service. The built-in hosts are api.openai.com and api.anthropic.com. To use a custom compatible endpoint, an operator must add its exact, trusted public hostname to the comma-separated `AI_ALLOWED_ENDPOINT_HOSTS` variable on both Workers; wildcards are not accepted. Only approve hostnames whose DNS and destination are controlled and trusted by the operator. The egress service has no public route; preserve that isolation. Signed requests expire after 30 seconds but are not individually tracked against replay, so the service binding and signing key must remain private. Review the address allocation list as IANA assignments change. Review the effects of the `global_fetch_strictly_public` compatibility flag on other Worker subrequests before rollout.

Production deployment remains the existing GitHub Actions process; this change does not deploy or configure production secrets automatically. Existing Android sessions need the `preferences:write` scope to change budget or AI settings; reauthorize an older session if it lacks that scope.
