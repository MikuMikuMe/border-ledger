# Closed-registration authentication operations

The closed-registration runtime now scopes financial routes, providers, queues and clients to provisioned users and ledgers. Production cutover remains pending: follow [the hosted-user rollout](hosted-users-rollout.md), keep the Access allowlist unchanged, and do not treat local tests as live login evidence. No production data was changed during implementation.

## Identity enrollment

The server resolves only the exact verified Access issuer and subject in `user_identities`. Email addresses and `MOBILE_APPROVED_ACCESS_SUBJECTS` are not enrollment credentials. Unknown or disabled identities receive `Access is not enabled`. There is no registration endpoint. `LEDGER_API_KEY` no longer grants web data access.

The issuer and audience still must be configured and verified cryptographically. Operator provisioning must independently establish that a subject belongs to the intended owner. Never obtain identity claims from unverified client headers or a submitted email address.

For a local owner-binding rehearsal, first apply the local migrations:

```powershell
npx wrangler d1 migrations apply DB --local
```

Create a private SQL file outside the checkout containing the following statement. Replace both placeholders with independently verified claims, SQL-escaping any single quotes as doubled single quotes. The query intentionally targets only the existing `owner` / `personal` mapping. A conflicting existing identity binding aborts through the schema guard; it cannot be reassigned.

```sql
INSERT INTO user_identities (issuer, subject, user_id)
VALUES ('VERIFIED_HTTPS_ISSUER', 'VERIFIED_SUBJECT', CASE WHEN EXISTS (
  SELECT 1 FROM users u JOIN ledgers l ON l.user_id = u.id
  WHERE u.id = 'owner' AND u.status = 'active' AND l.id = 'personal'
) THEN 'owner' ELSE NULL END)
ON CONFLICT(issuer, subject) DO NOTHING;
```

Run only against the local database:

```powershell
npx wrangler d1 execute DB --local --file "D:\Private\owner-binding.sql"
```

`provisionOwnerIdentityBindings(db, bindings)` exposes the same operator-only batched semantics for local tooling. It is not referenced from authentication routes. Never call it from login. Production provisioning requires the separately reviewed rollout, backups, and explicit production authorization; the local commands above do not authorize it. Additional users and ledgers must be explicitly provisioned by an operator as part of that rollout, not on first login.

## Session behavior

New browser-assisted login state lives in `hosted_auth_requests` with no ledger/user until a provisioned identity approves it. New capture pairing state lives in `hosted_device_pairings`; no device record is created before approval. Bound pending records cannot be reassigned or replaced through unique-key collisions. Legacy pending/session tables and rows are preserved. Legacy pending requests must restart; existing session families remain bound through their immutable ledger ownership.

Owner access and refresh credentials carry an authenticated family ID, generation, expiry, and environment hash. Access credentials also carry the subject hash and installation identifier. The server derives `userId` and `ledgerId` from the stored family, ledger, and active user rather than trusting client-supplied ledger IDs. Capture credentials resolve their stored credential and device ledger. Revocation capabilities resolve the stored grant ledger. Every authenticated context includes both IDs.

Disabling a user rejects subsequent access, refresh, pairing claims and replay responses. Session revocation rejects session replay; capture revocation rejects pairing claim replay. Existing owner data IDs and historical financial rows remain unchanged.

## Final route and client policy

The temporary non-personal 503 gate is removed. Every financial request uses the trusted ledger context and active authority; unknown identities remain denied without creating users, ledgers, sessions or connections. Native auth requires protocol version 2; unsupported clients receive update-required behavior and must update/re-login. Browser/native caches, drafts and capture partitions are keyed to the authenticated identity, with stale-response fencing.

Migration preserves legacy session/history rows. It does **not** revoke production sessions automatically. During the approved maintenance window, revoke legacy owner session families, clear replay responses, revoke pending legacy auth requests and pending/approved pairings, and require controlled owner re-login. The preparation tool measures that reset before a prepared receipt can be written. Preserve devices, capture credentials and historical capture events according to their existing ledger ownership; do not erase capture history to reset login. Independently verify the owner's upstream Access challenge before invalidating sessions.

Health `mobileAuthConfigured` verifies cryptographic configuration only. The CI protocol-2 request smoke verifies an unbound authorization launch only; it does not approve/exchange a provisioned identity or prove ledger access.
