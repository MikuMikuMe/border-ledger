# Lunch Flow connections

Border Ledger supports a separately authorized Lunch Flow Platform connection for each provisioned hosted user, alongside the original owner's Personal API feed. The Worker holds credentials; browser and Android clients receive connection status and authorization URLs only. Public registration remains closed. Unknown Access identities never create users, ledgers or connections.

## Original owner Personal feed

1. Connect the desired bank in Lunch Flow and complete the bank's authorization there.
2. Create a REST API destination named Border Ledger.
3. Enable only the bank accounts this ledger should access in that destination.
4. Install its key as the production Worker secret `LUNCHFLOW_API_KEY`. Never use a `VITE_` variable, commit it, or paste it into an app setting.
5. In Border Ledger Accounts, load Lunch Flow accounts, select accounts and confirm their primary currency and account kind, then save the selection.

The Personal API credential belongs to one owner. This is not the Lunch Flow Platform API and must not be reused to connect unrelated users' financial accounts.

The original owner connection is always bound to user `owner`, ledger `personal`, and internal connection `lunchflow-personal-owner`. Disconnect disables local access and selections even while the Worker key remains installed. Personal reconnect is operator-only; clients must not offer OAuth as a replacement. Removing the REST API destination in Lunch Flow stops provider-side Personal access. Existing Personal history or an installed key blocks Platform cutover until account continuity can be verified; no automatic migration or duplicate import is attempted.

## Hosted-user Platform setup

Provision the user's verified Access issuer/subject and ledger through the closed-registration operator workflow first. Register the confidential OAuth application with Lunch Flow and install these Worker settings through the operator's secret/configuration tooling, never through chat or a client:

- `LUNCHFLOW_CLIENT_ID` and secret `LUNCHFLOW_CLIENT_SECRET` identify one immutable OAuth application.
- Secret `LUNCHFLOW_TOKEN_ENCRYPTION_KEY` is 32 random bytes encoded as 64 hexadecimal characters. Keep this key stable and securely backed up; changing it makes stored encrypted credentials unreadable.
- `LEDGER_APP_ORIGIN` starts with the canonical HTTPS application origin.
- `LUNCHFLOW_REDIRECT_URI` must exactly equal that origin plus `/api/lunchflow/oauth/callback`, without query, fragment or alternate host.

Apply migrations `0025-lunchflow-platform.sql` and `0026-lunchflow-connection-mappings.sql` before serving this Worker version. Migration 0026 preserves the original owner's mappings, receipts and financial history; ambiguous legacy mappings belonging to other ledgers abort migration for operator review. Do not guess their credential ownership.

Missing settings produce `configuration_required` and `configured:false`. Changing the OAuth client ID for an existing connection produces `application_configuration_changed`; restore the original application before using or revoking its credentials. The integration uses the official OAuth base `https://www.lunchflow.app/api/platform/oauth` and resource base `https://www.lunchflow.app/api/platform/v1`. Confidential code/refresh exchanges use server-side client credentials; undocumented PKCE parameters are not assumed.

Platform Disconnect first clears local credentials, increments the connection generation and disables selections atomically. It then requests the documented app-membership removal (`DELETE /users/{userId}` with application credentials), which revokes the user's access/tokens for this application. This is broader than disconnecting a single bank feed and does not delete the underlying Lunch Flow authentication user. It never uses the destructive bank-connection DELETE endpoint. Imported history remains readable.

`remoteRevocation` distinguishes `pending`, `failed`, `uncertain` and `succeeded`. A definite failure remains locally disabled and allows an explicit Disconnect retry (`retryable:true`). In-flight or externally uncertain operations block reconnect and automatic retries; the operator must resolve the provider outcome before restoring access. A second Disconnect after known completion of an overlapping exchange/refresh can finish pending removal. Never present local disabling as successful remote revocation.

Reconnecting the same provider user reuses the internal connection/account/transaction identities. Selections stay disabled until explicitly saved again. Switching provider user or reassigning it to another hosted user is blocked. Raw provider bank-connection IDs are stored separately; changes require verified account mapping rather than silently replacing imported history.

## Sync behavior

Manual refresh queues a sync of the selected accounts. The existing daily Worker cron also schedules Lunch Flow sync. Clients check queued completion through the local sync-status endpoint, which reads D1 without repeatedly contacting Lunch Flow. This reads the data available in Lunch Flow; it does not force RBC to publish new transactions or bypass bank MFA. Manage/reconnect the bank connection in Lunch Flow when required.

Transaction identities include the provider account and exact provider transaction ID. Replaying a snapshot does not create another row. Pending records remain provisional; posted history is retained when it falls outside the provider's history window. Provider failures preserve the last successful data and remain visible as sync errors.

Imported Lunch Flow accounts are dedicated accounts. The integration does not automatically merge statement/Plaid accounts or deduplicate across different sources based on matching dates and amounts. Avoid counting overlapping accounts twice when combining historical imports.

Deselecting an account stops future sync and preserves its imported history. The connection chooser includes selected/current provider accounts and up to 100 recent mappings; older disabled mappings remain in the ledger even when omitted from this chooser. Revoke access in the Lunch Flow destination to stop the credential from reading an account at the provider.

## Verification checklist

- Confirm accounts are active and the Personal API returns nonempty transactions, not merely a successful bank login.
- Compare count, date range, currency, debit/credit signs, and recent posted transactions against the bank.
- Save selection from each client and confirm the other client sees the same accounts and sync state.
- Repeat refresh; counts must remain unchanged for an unchanged provider snapshot.
- Test provider failure and reconnect behavior; last-successful data must remain readable.
- Historical depth and refresh frequency depend on the provider/bank. Statement import remains available for older history.

Lunch Flow's normalized transaction endpoint does not provide authoritative subscription contracts. Existing Plaid recurring data remains separate; no Lunch Flow subscription detection is claimed by this integration.

## Client API handoff

All routes return `Cache-Control: no-store`. Web routes use `/api/lunchflow`; native routes use `/api/mobile/v1/lunchflow` and require a current owner credential with `connections:manage`. Web writes require the canonical same-origin boundary. A request never selects its user or ledger; those come from verified authentication.

| Method and suffix | Input | Output |
| --- | --- | --- |
| `GET /connection` | None | Connection status described below |
| `POST /oauth/start` | No user, ledger or return URL | Exactly `{authorizationUrl,connectionId}` |
| `POST /disconnect` | `{connectionId,expectedGeneration}` | Connection status, HTTP 202 for remote pending/failed/uncertain, otherwise 200 |
| `GET /accounts` | `connectionId` query | `{configured,connectionId,generation,accounts,archivedAccountCount?}` |
| `GET /accounts?status=local` | `connectionId` query | Same shape without provider calls; rows include `lastAttemptAt` |
| `POST /account-selection` | `{connectionId,expectedGeneration,accounts:[{providerAccountId,currency,kind}]}` | Existing `{selected,queued}` |
| `POST /sync` | `{connectionId,expectedGeneration}` | Existing `{queued,accounts}`, HTTP 202 |

Selection, manual sync, and disconnect require a positive safe-integer `expectedGeneration`, including Personal requests. Capture it with the connection ID from the status the user observed, before any await; keep that exact pair through dispatch, retries and reconciliation. Missing/malformed values return 400. An owned connection whose generation changed returns 409 `connection_generation_conflict` without mutation, enqueue or remote removal. Foreign IDs still return 404; generation is a precondition, never authorization. Refresh status and ask for a new explicit action after a conflict. Never substitute a refreshed generation into an old command.

The initial disconnect atomically increments the observed generation and disables local credentials/selections. Retrying pending or failed remote removal uses the freshly observed disabled generation and that connection's exact durable operation. An old pre-disconnect generation cannot authorize a retry or affect a later reconnect. In-progress/uncertain outcomes remain blocked and never retry automatically.

Selection/sync require `Idempotency-Key` for native requests and accept it for web requests. Receipt identity includes connection generation. Platform mutations require an explicit owned connection ID; foreign IDs return non-disclosing 404. Only exact-owner Personal calls retain omitted-ID compatibility. An unbound nonowner account read returns `{configured:false,accounts:[]}`; clients should first load `/connection` and then pass its ID. Account rows retain existing fields and add `connectionId` and nullable `providerBankConnectionId`.

Connection status fields are `userId`, `ledgerId`, nullable `connectionId`, `adapter` (`personal` or `platform`), `configured`, `connected`, `reconnectRequired`, `canReconnect`, `remoteRevocation` (`not_requested|pending|failed|uncertain|succeeded`), `reason`, nullable `generation`, and `retryable`. Cache using the server-derived user/ledger identity and discard late responses after logout/switch. `readLunchFlowStatus` remains local account-sync status; connection status is a separate method.

For Platform, `reason` is `configuration_required`, `application_configuration_changed`, `operation_in_progress`, `operation_uncertain`, or the lifecycle (`disconnected|connected|reconnect_required|revocation_pending|revocation_failed|revoked`). The Personal adapter always reports `canReconnect:false`: `legacy_cutover_required` identifies the existing Personal feed and `personal_disconnected` requires operator restoration. Do not show a Platform connect button for Personal. A blocked OAuth attempt returns `legacy_cutover_required`; no cutover is implemented.

Web service errors retain `{error}` and add `{code,retryable}`. Native service errors remain `{code,message,requestId,retryable}`. Relevant action codes include `connection_required` (400), `connection_not_found` (404), `browser_session_required` (401), `invalid_oauth_state` (403), `bank_connection_changed` (409), `provider_identity_conflict` (409), `reconnect_required` (409), `operation_in_progress` (409/retryable), `operation_uncertain` (409/operator), and configuration errors (503). Provider bodies and credentials are never returned.

Web start binds state to the verified Access JWT's issuer+subject hash, the exact verified assertion's session hash, and its numeric expiry. The `__Host-lunchflow` cookie is HttpOnly, Secure, SameSite=Lax, Path=/, with a maximum 600-second lifetime; only hashes are stored in D1. If Access renews the JWT during authorization, start again. Do not serialize the cookie into JSON or native storage.

Native start returns a one-use launch URL at `/api/lunchflow/oauth/launch?ticket=...`. Open it in the authenticated browser. Launch verifies the same hosted user and the initiating native family, then sets the same secure browser cookie. Callback checks the browser identity/session/cookie plus the still-current native family. Both code and provider-denial callbacks consume state. Callback responses clear the cookie and use `Referrer-Policy: no-referrer`.

Success returns only to canonical `/?lunchflow=connected` (web) or `/android/lunchflow/callback?result=connected` (native). Verified native denial returns `?result=failed`; other callback failures use canonical `/?lunchflow=failed`. Caller-supplied return URLs are ignored. These result indicators contain no code, state, token or identity and are never proof of ownership: re-fetch authenticated status.

The maintained Android client has a separate `/android/lunchflow/callback` app-link handler; `/android/auth/callback` remains sign-in only. It accepts only canonical HTTPS result-only links with a single known result and no fragment. The native system-browser launch URL/ticket never enters JavaScript or pending storage. Encrypted pending metadata binds user, ledger, local session epoch, connection and observed generation, expires after ten minutes, and is consumed before callback refresh. A hint re-fetches authenticated status; it cannot mark connected, switch identities or exchange a login code. Replay/unsolicited hints can only refresh actual status. Logout, account switch, cancellation and generation replacement discard completion; app resume independently refreshes status when the callback is lost. Native connection/start/disconnect methods preserve structured service codes and immutable OwnerWork binding.

Web and native controls honor configuration, Personal operator-only restoration, canReconnect, retryable, and pending/failed/uncertain remote removal. Disconnect explains application-wide access removal and retained history before confirmation. Reconnect requires an explicit account-selection save. Client/session isolation and capture-intake storage stay separate. Real-provider end-to-end verification remains external.

Platform client credentials, encryption-key installation, provider callback registration, and production rollout remain external setup. Tests use synthetic credentials and fake provider transport; no real bank/provider mutation is part of implementation validation.
