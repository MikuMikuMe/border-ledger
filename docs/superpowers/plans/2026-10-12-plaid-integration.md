# Plaid integration implementation plan

## Goal

Connect the existing Border Ledger Worker and React UI to Plaid Transactions in Sandbox, without exposing Plaid credentials or access tokens to the browser.

## Tasks

1. Add red tests for Plaid transaction mapping, Link request construction, encrypted token round-trips, and sync pagination behavior.
2. Add the Worker Plaid client, encrypted token helpers, Access/bearer authorization, Link-token and public-token exchange endpoints, verified webhook handling, and Queue-backed `/transactions/sync` processing.
3. Extend the D1 schema for Plaid Items and account mappings, and add the Sandbox environment variable to Wrangler configuration.
4. Add a small browser Plaid Link loader and connect the Accounts screen to Link, exchange, and sync-status feedback while retaining the local demo fallback.
5. Run the full typecheck, unit tests, and production build from a local mirror; inspect the diff and sync the finished source to GitHub.

## Security boundaries

- Plaid client ID, secret, encryption key, and ledger API key remain Worker secrets.
- The browser receives only a short-lived Link token and never receives a Plaid access token.
- Plaid webhooks are verified before they enqueue work.
- API routes accept a validated Cloudflare Access JWT or the existing bearer API key; no unauthenticated financial-data route is added.
