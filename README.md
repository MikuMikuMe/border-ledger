# Border Ledger

Border Ledger is a private cross-border spending workspace for CAD and CNY accounts. It is deliberately reconciliation-first: statement imports are reviewable, source currencies stay visible, and provisional alerts never disappear into a confirmed total.

## Current slice

- Responsive React + TypeScript dashboard with Overview, Transactions, Import & review, and Accounts & settings surfaces.
- CAD/CNY totals for today, this week, and this month.
- Confirmed, provisional, and needs-review states.
- CSV preview/import flow with duplicate fingerprints and malformed-row feedback.
- Cloudflare Worker API contract for D1-backed accounts, transactions, reports, imports, Plaid webhooks, and Queues.
- Plaid Link Sandbox connection flow with encrypted access-token storage, verified webhooks, and queued Transactions sync.
- Provider-backed recurring-payment snapshots stored in D1, with bounded list/detail APIs, source estimates, posted-ledger cost, and local classification.
- GitHub Actions checks and Cloudflare deployment workflow.

The public welcome page uses clearly labeled representative data. The private `/app` workspace reads its accounts, transactions, and recurring feed from the Worker and shows explicit loading, empty, stale, and error states; it never falls back to demo data.

## Cloudflare preview

The private workspace is served from [pf.lofuyu.com](https://pf.lofuyu.com). The raw Worker hostname is not an application origin: after the hardened Worker is deployed, browser routes redirect to the custom origin and API requests to the raw hostname return `404`. No bank data or secrets are embedded in the public front desk.

The Sandbox promotion on 2026-10-13 used the authenticated Cloudflare connector. Because that connector cannot forward Cloudflare's short-lived static-asset upload JWT, the promoted Worker carries the same built UI bundle inline for this deployment; `wrangler.jsonc` remains the canonical assets-binding configuration for future tokenized Wrangler deployments.

## Local development

```bash
npm install
npm run dev
```

Run the quality gates:

```bash
npm run typecheck
npm test
npm run build
```

## Cloudflare setup

1. Create (or verify) the Sandbox D1 database `border-ledger`, Queue `border-ledger-sync`, and dead-letter Queue `border-ledger-sync-dlq`.
2. Apply the versioned migrations to the remote database. The migration directory is already declared in `wrangler.jsonc`:

   ```bash
   npx wrangler d1 migrations apply border-ledger --remote
   ```

   A new database applies `0000-ledger-base.sql`, `0001-plaid.sql`, and `0002-recurring.sql` in order. `worker/schema.sql` is retained as a complete bootstrap reference for local fixtures and legacy installs; do not apply it over a live database after migrations have started.
3. The provisioned D1 ID and Queue bindings are in `wrangler.jsonc`; the Queue consumer is limited to one concurrent sync so a connection cursor is serialized, retries five times, and sends exhausted messages to the dead-letter Queue.
4. Keep `PLAID_ENV=sandbox` while testing. It is a non-secret Wrangler variable; change it to `production` only after Plaid approves production access.
5. Add these Worker secrets—never commit them or expose them to the browser:

   ```bash
   npx wrangler secret put LEDGER_API_KEY
   npx wrangler secret put PLAID_CLIENT_ID
   npx wrangler secret put PLAID_SECRET
   npx wrangler secret put PLAID_ENCRYPTION_KEY
   ```

   `PLAID_ENCRYPTION_KEY` must be a base64 or hex encoding of exactly 32 random bytes. In PowerShell, generate a value with:

   ```powershell
   $bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); [Convert]::ToBase64String($bytes)
   ```

   Mobile owner sign-in requires one Worker-only session-encryption secret and three approved-identity allowlist secrets. `MOBILE_ACCESS_AUTHORIZATION_URL` is the non-secret production app URL `https://pf.lofuyu.com/mobile/authorize`. Generate `MOBILE_SESSION_ENCRYPTION_KEY` independently with at least 32 random bytes; do not reuse the Plaid encryption key or replace the key during an ordinary deployment. Set `MOBILE_APPROVED_ACCESS_ISSUERS`, `MOBILE_APPROVED_ACCESS_AUDIENCES`, and `MOBILE_APPROVED_ACCESS_SUBJECTS` to the exact approved Cloudflare Access issuer, audience, and subject values. The Worker fails closed when any allowlist is absent.

6. Keep the public welcome page at `/` outside the Access login wall, and protect `/mobile/authorize`, `/app/*`, `/api/mobile-auth/*`, plus the financial API routes. The front page links into `/app`, so Access can return an invited user to the workspace after sign-in. Add the Access team domain (for example `https://your-team.cloudflareaccess.com`) as `ACCESS_TEAM_DOMAIN` and the private Access application AUD tag as `ACCESS_AUDIENCE` in the Worker variables. The browser sends the Access session cookie; it never receives `LEDGER_API_KEY`.
7. Add an Access Bypass policy for exactly `/api/webhooks/plaid`, because Plaid cannot present your browser session. The Worker verifies Plaid’s signed `Plaid-Verification` header before enqueueing a sync.
8. Add `CLOUDFLARE_API_TOKEN` to the GitHub repository Actions secrets. The non-secret Cloudflare account ID is pinned in `wrangler.jsonc` so the workflow cannot accidentally target another account. The production health smoke test also needs the Cloudflare Access service-token credentials as separate GitHub Actions secrets: `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET`. Granting Access-management permissions to the Wrangler API token does not substitute for these HTTP headers.

### Production rollout gate

The live production service is the existing `border-ledger` Worker used by [pf.lofuyu.com](https://pf.lofuyu.com). The Wrangler `production` environment explicitly names that same Worker, keeps the default environment on Sandbox settings, and binds production code to the existing `border-ledger` D1 database and `border-ledger-sync` Queue. Do not create or deploy a shadow `border-ledger-production` Worker.

Before connecting a real bank Item, complete these steps in order:

1. Obtain Plaid production approval and confirm the production client ID/secret are for the intended account.
2. Verify the existing production Worker secrets without replacing stable encryption keys:

   ```bash
   npx wrangler secret list --env production
   ```

   The existing Worker already contains the production Plaid, Access, API, and `MOBILE_SESSION_ENCRYPTION_KEY` secrets. Add or rotate a secret only when it is genuinely missing or intentionally being rotated:

   ```bash
   npx wrangler secret put LEDGER_API_KEY --env production
   npx wrangler secret put PLAID_CLIENT_ID --env production
   npx wrangler secret put PLAID_SECRET --env production
   npx wrangler secret put PLAID_ENCRYPTION_KEY --env production
   npx wrangler secret put ACCESS_TEAM_DOMAIN --env production
   npx wrangler secret put ACCESS_AUDIENCE --env production
   npx wrangler secret put MOBILE_SESSION_ENCRYPTION_KEY --env production
   npx wrangler secret put MOBILE_APPROVED_ACCESS_ISSUERS --env production
   npx wrangler secret put MOBILE_APPROVED_ACCESS_AUDIENCES --env production
   npx wrangler secret put MOBILE_APPROVED_ACCESS_SUBJECTS --env production
   ```

   Keep the existing `MOBILE_SESSION_ENCRYPTION_KEY` stable; replacing it invalidates sessions and outstanding mobile authorization state. `MOBILE_ACCESS_AUTHORIZATION_URL` is a non-secret production variable declared in `wrangler.jsonc`. Configure the three Access allowlists with the exact approved issuer, audience, and subject values. Never copy Sandbox credentials into production.

3. Apply the versioned migrations to the existing production database:

   ```bash
   npx wrangler d1 migrations apply border-ledger --remote --env production
   ```

4. Build and deploy the existing production Worker:

   ```bash
   npm run typecheck
   npm test
   npm run build
   npx wrangler deploy --env production --keep-vars
   ```

5. Keep the existing `pf.lofuyu.com` route and Access application attached to `border-ledger`. Keep `/app/*` and financial API routes behind the existing Access allow policy; keep only `/api/webhooks/plaid` bypassed. The deployment workflow does not alter Access policies.

6. Keep the Cloudflare zone rule `Border Ledger Plaid webhook protection` enabled for `POST /api/webhooks/plaid`. The webhook is intentionally public to Plaid; signature verification is necessary but does not replace edge throttling.

7. Smoke-test through the custom origin: Access-protected `/app`, authenticated `/api/accounts`, raw-host redirect/`404` behavior, a Plaid Link connection with only the intended account selected, one sync, and the disconnect action. Confirm that disconnect revokes the Item and preserves existing ledger history.

Do not set `PLAID_ENV=production` on the default environment or connect an RBC Item until the production Worker, Access route, secrets, rate limit, and smoke tests all pass.

## Import format

CSV files must include `Date`, `Description`, and `Amount`. `Currency` and `Category` are optional; currency defaults to CAD. Dates use `YYYY-MM-DD` and amounts are parsed as decimal major units.

## Plaid/RBC flow

Open Accounts & settings and choose Start bank connection. Plaid Link runs in the browser, returns a short-lived public token and account metadata, and the app asks you to explicitly choose which accounts may be stored. The Worker independently verifies those IDs against Plaid’s `/accounts/get` response before exchanging and persisting anything. The access token is encrypted with `PLAID_ENCRYPTION_KEY`; the browser never sees it. Plaid webhooks enqueue a `/transactions/sync` job, which imports added and modified records, removes deleted records, replaces pending records when they post, and advances the cursor only after D1 writes succeed.

The account options menu includes Disconnect Plaid connection. That action calls Plaid’s Item removal endpoint first; only after Plaid confirms revocation does the Worker delete the encrypted access token and mappings. Existing ledger transactions remain available as historical records.

Use Plaid’s Sandbox test institution and credentials while `PLAID_ENV=sandbox`. Sandbox transactions are simulated; test an actual RBC Item only after enabling the appropriate Plaid production access. The Bank of China/WeChat path remains statement or Android-companion work and is not changed by this integration.

## Android Task 17 release and recovery notes

Android parity is tracked as F01–F18 in [`docs/android-validation.md`](docs/android-validation.md). Each row requires a native workflow and owner-captured acceptance evidence; linking to a website page, using a placeholder, or relying on source inspection does not close the row. The release runbook also defines the owner/capture credential boundary, offline/logout/cache behavior, populated migration and restore gate, backup exclusions, signing custody, and future Gradle/APK verification commands.

The current checkout intentionally makes no signed-APK, Pixel, Gradle, `apksigner`, checksum, or CI-success claim. The Android Gradle wrapper JAR is absent, so `.github/workflows/android-ci.yml` reports and gates the Android build explicitly. `.github/workflows/android-release.yml` requires the wrapper, Android SDK tooling, and protected signing secrets before it can assemble, sign, verify, and checksum an artifact. CMB remains explicitly unsupported and statement-import-only until independent source evidence exists.
