# Task 9 brief — upload/retry/cache synchronization end to end

## Objective

Replace the Task 7 no-op WorkManager upload boundary with a durable Android upload coordinator that consumes the encrypted Task 7 intake, calls the authenticated Worker v1 alert route, persists per-event acknowledgements before retention/deletion, and exposes honest retry/pairing/cache states. A process death, timeout after a server commit, partial acknowledgement, credential renewal, or concurrent foreground/background trigger must preserve immutable event UUIDs and original payload/time.

## In scope

- `android/app/src/main/java/com/lofuyu/borderledger/sync/UploadWorker.kt`, `UploadScheduler.kt`, a focused `LedgerRepository.kt`/upload coordinator, and HTTP/DTO/DAO seams required for Task 8’s `/api/mobile/v1/alerts` and `/status` contract.
- `EncryptedCaptureIntakeStore` acknowledgement/quarantine APIs only where needed to represent accepted/replayed/non-spending/review/rejected/conflict outcomes transactionally. Preserve Task 7 cap, duplicate, retention, and no-eviction semantics.
- `HttpWorkerCaptureApi.kt` or a separate capture upload client for bounded JSON, no-store headers, capture-only authorization, response parsing, 401/409/429/5xx classification, and `Retry-After`.
- Encrypted owner read cache/repository synchronization and logout/session-expiry visibility, without adding financial data to capture credentials.
- Kotlin unit/instrumented tests with deterministic fake HTTP/server and fake WorkManager seams. Do not touch Worker/D1 implementation except DTO compatibility fixes required by the already accepted Task 8 contract; do not implement Task 10+ UI.

## Required behavior

1. One upload coordinator owns foreground/background calls. WorkManager enqueues unique network-constrained work with bounded immutable batches of at most 50 events and 128 KiB JSON. Concurrent calls do not create duplicate uploads or mutate event IDs/payloads.
2. Offline/no-network, timeout, 5xx, and 429 preserve every unsent row. Honor a bounded `Retry-After` value where the platform permits and otherwise use exponential retry; no exact alarm, foreground service, or busy loop.
3. Parse per-event acknowledgements from Task 8. Persist accepted, replayed, non-spending, and server-held/review outcomes in one encrypted local transaction before acknowledgement rows are eligible for retention. Partial acknowledgements mark only returned events; missing events stay queued. Permanent rejection/conflict is quarantined as review with stable code and is not silently deleted or counted locally.
4. A 401/expired/revoked capture credential pauses upload and exposes a pairing-renewal state while retaining unsent encrypted events. A new credential resumes only events within the newly approved source/account/currency scope; no owner-session or API-key substitution is allowed.
5. A response lost after D1 commit leaves the batch queued; retrying the same immutable batch receives replay receipts and then clears it. Original notification posting time and event UUID are unchanged.
6. Cache/read synchronization remains owner-authorized. Capture upload may invalidate a stale financial read cache but background capture credentials cannot refresh reports or other financial screens. Owner refresh/read failures never add queued local money to server totals. Signed-out, known-revoked, or expired remembered leases expose no financial cache; explicit logout pauses monitoring, clears cache, retains encrypted outbox, and queues revocation-only work.
7. Health distinguishes pending count, last successful upload, retry/backoff, pairing renewal, and cache snapshot time. No “ready” state may imply that historical bank coverage is complete.

## TDD acceptance tests

- Offline enqueue, process kill/restart, timeout after commit, response replay, partial acknowledgement, duplicate concurrent foreground/background calls.
- 429 with bounded `Retry-After`, 5xx/backoff, malformed response, permanent per-item rejection, 409 content mismatch quarantine.
- 401/expired/revoked credential pauses without deleting rows; renewed credential resumes only newly approved scope.
- Acknowledgements are durable before retention/purge; no UUID regeneration or payload mutation; a 50-event cap is enforced.
- Unique WorkManager scheduling and no exact alarm/foreground/network work in the listener callback.
- Owner cache snapshot/lease, explicit logout, known revocation, session expiry, capture upload invalidation, and prevention of background capture refresh.
- Run available direct static checks; document blocked Gradle/Kotlin/Pixel and any unavailable deterministic native runtime evidence rather than claiming it.

## Explicit non-goals

- No statement import/reconciliation, reports UI, native shell, Plaid, recurring, CMB, or release signing.
- No server-side receipt or D1 schema redesign; Task 8 is the server authority.
- No plaintext fallback, demo totals, local projection of queued money, or cache access after explicit sign-out/known revocation/lease expiry.
