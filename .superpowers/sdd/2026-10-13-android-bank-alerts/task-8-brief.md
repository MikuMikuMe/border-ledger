# Task 8 brief — atomic Worker ingestion with replay-safe acknowledgement

## Objective

Implement the authenticated Worker boundary for `POST /api/mobile/v1/alerts` and its durable ingestion service. A bounded batch must validate before mutation, authenticate and scope-check before replay lookup, atomically persist immutable alert evidence plus any eligible normalized projection/link state, and return stable per-event acknowledgements only after commit. A lost response or renewed capture credential must replay the original receipt without duplicating a counted projection.

## In scope

- `worker/mobile.ts` mobile route dispatch and `GET /api/mobile/v1/status?eventId=...` receipt lookup where required.
- A focused ingestion/service module and `worker/alert-store.ts` changes needed for one D1 transaction boundary.
- `worker/index.ts` only if route plumbing is required; preserve canonical-origin and raw-host guards.
- `contracts/mobile-v1.openapi.yaml` if the acknowledgement/status schema needs to be aligned with the implemented stable reason/status codes.
- D1-backed tests: `tests/alerts-ingestion.test.ts`, `tests/alerts-idempotency.test.ts`, `tests/mobile-route.test.ts`, plus small helpers/fixtures.
- Preserve existing migrations/IDs/FKs and the Task 2–7 DTO/auth/schema boundaries.

## Required behavior

1. Authenticate the capture credential, ledger, device, expiry/revocation, and live approved source/instrument/account/currency scope before reading replay state. A device bearer token must not fall through to the browser/API-key path.
2. Accept only the documented v1 envelope: at most 50 events and 128 KiB JSON. Reject malformed/oversized envelopes as a whole; reject unknown/raw notification-text fields and device-supplied ledger/account/confirmation fields. Do not log or persist raw notification text.
3. Validate each event using the shared currency, money-scale, event/lifecycle/time, source-profile, and identity rules. One invalid event must produce a stable per-event rejection/needs-review acknowledgement without discarding valid events in the same bounded batch. Out-of-scope source/instrument/currency and invalid scale must be rejected with stable reason codes.
4. Compute the canonical validated-content digest server-side. The same `(ledger,eventId)` plus digest is a replay and returns the original immutable receipt; the same ID with a changed digest is a conflict. Credential generation/device retries do not change receipt identity.
5. Commit immutable evidence/digest and, for eligible spending only, the normalized projection, transaction/source identity, lifecycle links, and receipt in one atomic D1 operation. Failed commit returns no acknowledgement and leaves no partial projection/evidence. Declined/hold/repayment/transfer/non-spending, failed/held, and unresolved review events must not create counted purchases.
6. Return per-event stable status/reason/receipt fields, including accepted/replayed/needs-review/non-spending/rejected/conflict semantics (or the existing contract-compatible equivalent with explicit reason codes). Preserve original event time/currency/provenance; receipt lookup after a lost response must return the original result.
7. Keep batch ordering deterministic, avoid raw payload/text in server logs, and retain existing browser/mobile route separation. Do not implement Task 9 upload orchestration or any Android changes in this task.

## TDD acceptance tests

- Duplicate request, concurrent retry, lost response after commit, renewed credential, and stable receipt/projection identity.
- Changed payload under one UUID returns conflict and cannot mutate the first event.
- Mixed valid/invalid, non-spending, needs-review, out-of-scope, and bad-scale events return independent acknowledgements; valid events commit.
- Malformed/over-128-KiB envelope and over-50-event input are rejected wholly; no partial writes.
- Raw/unknown fields and device-supplied ledger/account/confirmation fields are rejected or ignored according to the contract without persistence/logging.
- A D1 commit failure returns no receipt and leaves no evidence/projection.
- Route/auth tests prove capture scope checks precede replay lookup and legacy browser/API-key routes remain protected.
- Run the focused Worker tests and direct TypeScript/static checks available on this host; document the missing Vitest/Miniflare/hosted-D1 runtime evidence rather than claiming it.

## Explicit non-goals

- No Android upload worker, cache synchronization, statement reconciliation, native UI, or real-device acceptance.
- No migration rewrite of applied migrations and no weakening of existing owner/capture auth boundaries.
- No amount-only duplicate merging, server acceptance of raw notification text, or fallback to `LEDGER_API_KEY`.
