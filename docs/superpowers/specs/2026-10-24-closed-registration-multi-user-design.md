# Closed-registration hosted users and Lunch Flow connections

Date: 2026-10-24
Status: user-approved design; implementation completed for local validation and final review. Production rollout, real OAuth and owner cutover verification remain pending.

## Intent and confirmed requirements

Border Ledger will serve separate users on the existing hosted application. Each user owns a private ledger and connects their own Lunch Flow account. Public registration must remain disabled. The existing owner's financial data must remain intact and accessible only to that owner's explicitly mapped identities. Downloading a public app build grants no access.

## Approved defaults

Retain Cloudflare Access as the web identity provider and the current native browser authorization flow. Keep the production Access allowlist unchanged. Introduce application users, verified identity mappings and one private ledger per user. Do not provide signup, invitations, automatic user provisioning or an admin user-management UI in this release. Unknown authenticated identities receive an access-not-enabled response, with no user, ledger, provider connection or session created. Future provisioning is an explicit operator action; this release provisions only the existing owner. These are design choices, not additional user instructions.

An account identity is the verified issuer and subject, never an email supplied by the client. Explicitly configured owner identities may map to the same existing user. Do not automatically merge identities with matching emails. Owner binding must be configured before deployment, not claimed by the first visitor. A registration-closed setting is enforced server-side and defaults closed; neither OAuth callbacks nor native authorization may bypass it.

## Existing evidence

The current API accepts a valid Access JWT or a global ledger API key. Mobile sessions use an owner subject allowlist and the fixed personal ledger. Core accounts and transactions lack direct ledger ownership; other tables default to personal. Lunch Flow mappings use provider_account_id as a global primary key and hard-code ledgerId: personal. Queue messages carry provider account IDs and revisions without a tenant connection. Existing triggers also explicitly require personal. These must be addressed across the product before any additional production user is enabled.

## Data and authorization design

Create users and immutable identity mappings, and assign each ledger to one user. Preserve the existing personal ledger ID and backfill all historical rows to the existing owner. Existing financial IDs should remain stable unless migration correctness requires a mapped replacement. Add explicit ledger ownership to financial roots and composite constraints to prevent cross-ledger references in child records. Scope provider identities by ledger and connection, including transaction deduplication, import fingerprints, operation receipts and replay caches. Shared currency definitions and public FX rates may remain global; preferences, reports and sync status may not.

All authenticated entry points resolve a server-side context containing userId and ledgerId. Store and service APIs require that context rather than defaulting to personal. Every lookup and mutation checks ownership, including guessed IDs, account selection, exports, recurring data, devices, captures, reconciliation and annotations. Return non-disclosing not-found responses for another user's resources. Client-supplied ledger identifiers never select an authorization context. Inventory and audit every route, SQL store, queue, cron, webhook and cache before enabling a second user.

Mobile access, refresh, replay, pairing and capture credentials are bound to the user, ledger, environment and installation as appropriate. Revoking or disabling a user prevents API use and queued work. Existing sessions are either explicitly bound to the owner during migration or revoked with a controlled re-login; do not silently interpret legacy sessions as belonging to any new user. Retire the global API-key authorization path for user data, replacing necessary operator integrations with narrowly scoped service identities. Health checks do not need ledger access. Do not broaden the Access policy as part of implementation.

## Lunch Flow connection flow

Use Lunch Flow Platform OAuth for user-managed hosted connections. An already provisioned, authenticated user selects Connect Lunch Flow, authorizes with Lunch Flow and returns to a fixed registered callback. Server-created, short-lived, single-use state binds the initiating user, ledger, session and redirect. Reject unsolicited, expired, reused or cross-user callbacks. Verify the current provider contract and PKCE support during implementation; do not assume PKCE is supported.

Exchange and refresh tokens only server-side. Encrypt tokens at rest with authenticated encryption and connection/ledger context; do not send secrets to browser or Android storage, logs, exports or analytics. Protect concurrent refresh with version checks so token rotation cannot overwrite newer credentials. Users can select accounts, refresh, reconnect and disconnect only their own connection. Disconnect disables future sync, invalidates stale queued work and preserves imported history; revoke provider access using the supported provider endpoint where available. It does not imply deleting all historical financial records.

Production requires a Lunch Flow developer application, server-side client credentials and an exact allowed callback URI. These are deployment prerequisites; do not invent credentials or ask for secret values in chat. Until configured, show an actionable connection-not-configured state without exposing secrets. Use distinct Personal and Platform API adapters because their URLs, credentials and schemas differ.

The existing LUNCHFLOW_API_KEY remains temporarily usable only by an explicitly bound legacy owner connection. Never fall back to it for other users. Switching the owner from Personal to Platform OAuth requires an explicit verified account mapping or a paused legacy connection before import: do not silently equate IDs across APIs, duplicate history, or run both connections for the same account. If matching is ambiguous, preserve history and request account mapping rather than guessing. Remove the legacy credential only after successful migration and rollback planning.

## Background processing

Queue payloads identify ledgerId, connectionId and generation/revision without containing secrets. Consumers reload ownership and active status from the database before provider calls and before publication. Cron enumerates enabled connections within explicit tenant contexts. Provider webhooks resolve to a stored connection using verified provider identifiers; untrusted webhook payloads cannot select arbitrary ledgers. Namespace idempotency, transaction identities and sync state by connection and ledger. Reject or safely drain legacy unscoped messages before enabling tenant-aware processing. Preserve last-good data on provider failure.

## Client behavior

Web and native clients use the same authenticated backend context and private ledger. Add connection status, Connect, Reconnect and Disconnect states. Account lists show only the signed-in user's data. Clear tenant-specific caches and local financial data on logout/account switch, and prevent in-flight requests from repopulating a later user's session. Public landing pages remain public, without a signup entry point. Unknown identities see access-not-enabled, not an empty newly created ledger.

## Migration and rollout

Ship the small canonical-host Lunch Flow bug fix independently of this migration. The local fix currently changes the Personal API base URL to https://www.lunchflow.app/api/v1 while retaining redirect rejection.

For multi-user rollout: inventory schema and routes; take a recoverable database backup; rehearse migrations with representative owner data; validate counts, financial totals, associations and foreign keys; migrate while financial writes, cron and consumers are safely paused; deploy compatible server/client versions; verify owner sign-in, exports, imports and synchronization; resume processing only after checks. Keep public registration closed throughout. No additional production users are created by tests. Use two synthetic users in isolated test environments.

Do not roll an old unscoped server back onto a database containing multiple users. Rollback must restore a compatible code/schema combination and account for writes after backup. Prefer a tested forward fix once multi-user writes exist. Define the maintenance and recovery procedure in the implementation plan before production mutation.

## Acceptance criteria

- Unknown identities cannot register through web, native APIs, OAuth or direct HTTP requests.
- Two synthetic users cannot read, change, export or sync each other's accounts, transactions, credentials, imports, devices, annotations or reports, even using guessed IDs.
- Identical provider IDs and idempotency keys in separate users do not collide.
- Callback replay, session swapping, token refresh races, disconnected queued jobs and disabled users fail safely.
- Existing owner data and balances survive migration; owner Personal-to-Platform transition does not duplicate history.
- Logout/account switch clears local data and ignores stale responses.
- Required tests, type checks and per-file CodeScene checks pass; pre-commit and base-ref change-set gates run before commit/PR readiness claims.
- Production registration remains closed and the Access allowlist remains unchanged.

## Scope and implementation discretion

No public signup, billing, shared household ledgers, invitations, broadening Access or automatic enrollment. Exact table names, migration decomposition and internal module boundaries are implementation choices. Split work into reviewed changes: hostname fix; identity and complete ledger isolation; per-user provider connections and clients; migration and closed-access production verification. No claim of multi-user safety until every financial path is scoped and adversarial isolation tests pass.
## Builder review resolutions

The independent review identified five rollout decisions. Approved rollout decisions are:

1. Discover existing verified owner issuer/subject bindings from the current protected configuration before preparing the migration seed. Never infer ownership from the public email list alone. Revoke existing native owner sessions at cutover and require a controlled re-login; confirm the bound owner can reauthenticate before revocation. Missing verified bindings block deployment, not implementation against synthetic identities.
2. Owner Personal-to-Platform migration is not required in the initial isolation release. Keep the existing owner-only connection working. Enable the owner OAuth cutover only after Platform credentials, callback registration and explicit provider-account mapping have been verified. Do not mark the end-to-end Platform connection complete before that verification.
3. Prepare and test a bounded maintenance procedure with a verified recoverable D1 backup. Production migration is a separate reviewable deployment step; establish an acceptable maintenance window and pause/resume mechanisms before executing it. No production data mutation is authorized by this proposed design alone.
4. Inventory all global ledger-key consumers in code, deployment workflows and production integration configuration during planning. Replace any required consumers with owner-ledger-scoped service credentials; remove the old global authorization path before supporting any second tenant. Do not preserve a global bypass for compatibility.
5. Preserve compatible endpoint shapes where possible, but do not preserve unscoped authorization. A native app update and re-login are acceptable proposed defaults for this security migration. Unsupported older clients must fail closed with an update-required response; they must never fall back to the personal ledger. Verify Android and any other maintained clients before production rollout.
