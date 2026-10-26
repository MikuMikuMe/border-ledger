# Hosted-user cutover and recovery

Implementation is locally testable; **production rollout is pending**. No command below has been run against production for this implementation. Registration stays closed and the existing Access allowlist stays unchanged. Real owner login, live Lunch Flow OAuth/provider eligibility, recoverable production backup, queue/cron control and production data continuity require a separately authorized maintenance operation.

## Deployment interlock

Both `push` and `workflow_dispatch` in `deploy.yml` run `scripts/hosted-users-cutover.mjs preflight` before migrations or deployment. The script reads SQLite metadata first. A legacy database without the owner/activation schema fails with `cutover_required`; identities cannot be bound before 0021 exists. The script uses the real Wrangler `d1_migrations` tracker, never the test helper's `__migrations`. Custom tracker names are intentionally unsupported until reviewed.

Migration 0027 creates an **empty** singleton activation table. No migration inserts an activation. Automatic deployment requires an `active` receipt with contract 1, production database ID, completed baseline through 0027, a valid completion digest, the active `owner` → `personal` relationship and the exact owner-binding fingerprint. `HOSTED_USERS_ACTIVATION_SHA256` is a GitHub Actions secret containing the SHA-256 of the accepted private preparation manifest. Its presence alone is insufficient; the live receipt/schema/identity checks must also pass. Do not add a bypass input or `continue-on-error`.

A `prepared` receipt permits only the explicit operator `bootstrap-check` at the accepted commit, with the same private evidence and maintenance deadline. It never permits normal CI. Later normal deployments can use a newer revision and apply unrelated migrations without repeating bootstrap. The activation receipt is historical cutover evidence, not a guarantee of a fresh backup for each later migration. Review fresh auth/client compatibility whenever those contracts change.

Public Android publication has a separate interlock in `android-release.yml`, for both push and manual dispatch. The unsigned build, validation and signed workflow artifact can complete before activation for controlled owner verification. The public `gh release create` path first runs `node scripts/hosted-users-cutover.mjs android-publication`: active D1 receipt + pinned manifest digest + live canonical health response with protocol 2, configured mobile auth and deployment revision exactly matching the signed artifact's checked-out source SHA. Missing/prepared receipt, missing credentials, old server, redirect, unavailable/malformed health or revision mismatch block publication. Health protocol metadata is nonfinancial compatibility evidence, not identity enrollment/login proof. The operator uses the retained signed workflow artifact during maintenance; public publication is never a prerequisite for activation. If the server is still deploying, publication fails closed; rerun that job only after the compatible deployment is verified.
The tool does not migrate, deploy, enroll identities, pause infrastructure or contact providers. `prepare` and `activate` mutate only the activation receipt and require `--execute-authorized-maintenance`. That flag records deliberate invocation, not production authorization by itself. Failures print a fixed message rather than private claims, rows or Wrangler stderr.

## Private evidence format

Keep manifests, SQL, exports and evidence outside the repository, in encrypted/access-controlled operator storage. Never upload production financial fixtures to GitHub Actions. SHA-256 fingerprints are identifiers, not secret values; still keep identity fingerprints private. Use `fingerprint()` from `scripts/hosted-users-gate.mjs` on independently verified `{issuer,subject,user_id:'owner'}` mappings; it hashes sorted JSON tuples. The tool compares that expected hash to actual D1 mappings without printing claims.

Prepare this JSON with actual reviewed values. Placeholder values intentionally fail validation:

```json
{
  "version": 1,
  "environment": "production",
  "databaseId": "EXACT_WRANGLER_PRODUCTION_DATABASE_ID",
  "revision": "ACCEPTED_40_CHARACTER_COMMIT",
  "baseline": "0027-hosted-users-activation.sql",
  "ownerBindingsSha256": "64_HEX_DIGEST_OF_VERIFIED_BINDINGS",
  "runId": "operator-maintenance-run-id",
  "startedAt": "ISO_TIME",
  "deadline": "ISO_TIME_WITHIN_45_MINUTES_OF_START",
  "files": {
    "backup": {"path":"private-backup.sql","sha256":"64_HEX"},
    "maintenance": {"path":"maintenance.json","sha256":"64_HEX"},
    "restoreReport": {"path":"restore-report.json","sha256":"64_HEX"},
    "clients": {"path":"clients.json","sha256":"64_HEX"},
    "serviceRetirement": {"path":"services.json","sha256":"64_HEX"},
    "before": {"path":"before.json","sha256":"64_HEX"},
    "after": {"path":"after.json","sha256":"64_HEX"},
    "restored": {"path":"restored.json","sha256":"64_HEX"}
  }
}
```

All files are required and their actual bytes are hashed. Relative paths resolve against the manifest's directory; real paths inside the repository are rejected. The three snapshot JSON files must be byte-independent but structurally identical measurements returned by `financialSnapshot(query)`: selected stable financial-table counts, per-account/per-currency transaction counts and integer sums, and an empty `foreignKeys` result. The tool compares them to the live database at preparation/bootstrap. This deliberately excludes new auth metadata and controlled session reset; the independent rehearsal additionally compares every legacy table/column/row. Maintain a complete private export and full data comparison alongside these aggregate gates; equal aggregates alone do not prove row-level continuity.

Evidence JSON files carry `runId`, `revision`, `operator`, a `checks` object whose required entries equal `"passed"`, and the detailed observations/artifact references below. These are **operator attestations**, not automated proof that Cloudflare is quiescent or a real login succeeded. Review the observations before marking them passed:

| File | Required checks | Required private observations |
| --- | --- | --- |
| maintenance | allIngressBlocked, producersStopped, cronQuiescent, queuePaused, inFlightDrained, dlqAudited, backupAfterQuiescence, timeTravelBookmarkRecorded, legacySessionsRevoked, oldAuthFlowsRestarted | ingress probes, saved schedules/routes/consumers, bounded drain samples, retained backlog/expiry, bookmark/time, exact backup locator, approved window and operator |
| restoreReport | exactBackupRestored, oldCodeSchemaVerified, foreignKeysClean | restored export digest, disposable target, old artifact revision, complete comparison and isolated recovery results |
| clients | serverWebAccepted, androidArtifactVerified, rollbackArtifactRetained, ownerCanReauthenticate | accepted server/web commit, Android package/version/SHA-256, retained old code artifact, independently verified upstream owner challenge |
| serviceRetirement | globalKeyConsumersRetiredOrScoped, accessAllowlistUnchanged | inventory of production global-key consumers and each scoped replacement or explicit retirement; Access policy comparison |

## Ordered first cutover (separate production approval required)

1. Pin accepted server/web/Android artifacts and rollback artifacts. Independently verify the owner's exact Access issuer/subject and ability to complete the upstream challenge. Inventory production key consumers; code search cannot establish that external consumers do not exist. Retire a consumer if an implemented scoped replacement is unavailable. Do not restore a global bypass. Freeze alternative Workers Builds/manual deployments; GitHub uses non-cancelling production concurrency but cannot serialize external deployment paths.
2. Enter a separately reviewed no-write maintenance control covering **every** custom route, workers.dev alias, native endpoint, webhook, cron and queue handler. This change does not supply a maintenance Worker. The operator must first demonstrate the chosen control: HTTP data traffic is blocked, schedules produce no work, queues cannot publish, and retryable work is retained. A web-only maintenance page or Access rule is insufficient. Keep that independent control in force while replacing server code; deploying the normal config can restore cron and consumers, so reverify those controls after deployment.
3. Stop all producers before draining. Save exact original schedules/consumers/routes. Remove cron schedules through the approved dashboard/API path and verify propagation (Cloudflare documents up to 15 minutes). Pause delivery with `npx wrangler queues pause-delivery border-ledger-sync --env production`; inspect the DLQ too. Pause does not stop producers, cancel in-flight invocations, or suspend message retention. Drain under compatible old code, or retain legacy messages for safe rejection by the new consumer. Never infer personal ownership from a raw legacy ID and never purge merely to pass a gate.
4. Use a reviewed maximum 45-minute window, reserving the first 20 minutes for propagation/drain. Observe all ingress blocked, stopped producers, backlog/consumer activity and no further DB publication over a documented observation interval. Record retained messages and earliest retention deadline. Elapsed time alone is not proof. Abort **before migration** if quiescence or the deadline is inadequate.
5. Capture `npx wrangler d1 time-travel info border-ledger --env production --json` and `npx wrangler d1 export border-ledger --remote --env production --output <private-backup.sql>`. Capture the private financial measurement with `node scripts/hosted-users-cutover.mjs snapshot <private-before.json>`. Hash the exact export. Restore it into a distinct disposable database, compare every legacy row/relationship and the snapshot, run `PRAGMA foreign_key_check`, and verify the pinned old code/schema behavior. Separately rehearse remote Time Travel recovery on a disposable remote DB under its own authorization; local restore tests do not prove Time Travel.
6. Review the concrete backup/restore/maintenance/owner/client evidence and obtain authorization for the migration operation. Normal CI remains blocked. Apply schema under maintenance with `npx wrangler d1 migrations apply border-ledger --remote --env production`. Verify `d1_migrations` through 0027, all preserved data and no automatic identity bindings. Only now provision exact verified owner mappings using the private SQL/helper from [authentication operations](closed-registration-auth-runbook.md). Confirm no additional users/ledgers. Compare the post-schema snapshot with the pre-schema/restored snapshot.
7. Revoke existing `owner_session_families` (`revoked_at`), revoke legacy `mobile_auth_requests` still unconsumed/unrevoked, mark legacy `device_pairings` pending/approved as revoked, and delete only encrypted `owner_replay_records` response receipts. Use reviewed private SQL under maintenance. Preserve financial history, device/capture records and credentials according to their ledger ownership. The preparation tool measures zero unrevoked legacy families, pending legacy auth/pairing flows and replay rows; migration itself performs no such reset. New protocol-2 login occurs after preparation.
8. Write the immutable private preparation manifest after those measurements. From the clean accepted checkout run:

   ```text
   node scripts/hosted-users-cutover.mjs prepare <private-manifest.json> --execute-authorized-maintenance
   node scripts/hosted-users-cutover.mjs bootstrap-check <private-manifest.json>
   ```

   Both verify the actual migrated schema, exact owner bindings and current financial snapshot. Prepare writes only a `prepared` receipt. A repeated identical prepare is read-only/idempotent; a conflicting manifest cannot overwrite it. Failure leaves normal CI closed and maintenance in force. An expired run must not be bypassed by editing a receipt: review recovery/forward continuation with a new explicit operator plan.
9. While independently enforced maintenance still covers every writer, deploy the exact accepted server/assets using the reviewed operator path: `npx wrangler deploy --env production --keep-vars --var DEPLOYMENT_REVISION:<accepted-commit>`. Distribute the verified compatible Android artifact. Keep cron/queue writes blocked and recheck the independent control after deployment. Permit only the existing owner for controlled verification without broadening Access. Verify browser and fresh-install native login, identity and personal ledger, read/export/import and bounded sync. Record intentional post-backup writes; reconcile them to a new private snapshot.
10. Create a separate completion JSON with the same `runId`, `revision`, `operator`, `manifestSha256`, the measured current `snapshot`, and checks `webOwnerLogin`, `nativeOwnerLogin`, `ownerExport`, `boundedOwnerSync`, `snapshotReconciled`, `noAdditionalUsers`, `maintenanceStillEnforced` set to `passed` only after observation. Run:

    ```text
    node scripts/hosted-users-cutover.mjs activate <private-manifest.json> <private-completion.json> --execute-authorized-maintenance
    ```

    This checks the immutable preparation evidence, current owner mapping, completed observation record and live snapshot, then atomically transitions the same receipt to `active`. SQL rechecks owner/binding membership at the write. Identical active completion is idempotent; a different manifest/completion is rejected. Any failed gate leaves the prepared receipt unactivated.
11. Install only the accepted preparation manifest digest as GitHub `HOSTED_USERS_ACTIVATION_SHA256`. Run the read-only preflight. Restore saved schedules/consumer settings and resume delivery with `npx wrangler queues resume-delivery border-ledger-sync --env production` in the reviewed order. Remove maintenance, verify stale-message rejection and scoped owner jobs, and observe data continuity. Do not infer owner login from `mobileAuthConfigured` or HTTP 201: the CI fresh-install smoke is protocol-2 **authorization launch only**.

## Recovery and narrowly releasing the host fix

Before migration and before new writes, restore the exact original server/controls and verify old schema/owner access before resuming. After schema migration but before new writes, recover the recorded pre-cutover database **and** its pinned compatible code/client pair while maintenance remains active; validate snapshots/FKs/auth again. A Worker-only rollback is insufficient. Time Travel restore is a remote operation: `npx wrangler d1 time-travel restore border-ledger --env production --bookmark <recorded-bookmark>`; retain the previous bookmark returned by recovery when available.

After any multi-user writes, never run an old unscoped Worker against that database. Prefer a compatible forward fix. Restoring any earlier backup needs separately approved reconciliation of every post-backup write; do not silently discard them. Failed recovery stays in maintenance.

The canonical Personal API host correction was included in broad commit `74e0e94`. Do not cherry-pick that whole migration commit to release only the URL fix. Extract only the host URL and redirect-rejection regression into an independently reviewed change based on current main. Nothing in this runbook pushes or deploys that change.

## Local evidence and coverage map

`hosted-users-cutover-rehearsal.test.ts` applies 0000–0020 in exact numeric order, seeds 3 accounts/4 transactions and linked import/provider/recurring/reconciliation/alert/annotation/auth/capture/FX/preferences history, captures all legacy table columns/rows, applies 0021–0027, and compares the complete preexisting projection. CAD totals are 3666 minor units; USD totals are -2500, never combined. The separate recovered fixture restores the captured schema/row artifact and must exactly match original snapshots/FKs. This is synthetic recovery, not production Time Travel or live old-server execution.

The accepted existing route inventory and behavioral suites remain the isolation evidence; do not replace them with direct-store-only smoke:

| Boundary | Existing executable evidence |
| --- | --- |
| Complete financial route inventory/two users/guessed IDs | `tests/tenant-core-routes.test.ts`, `tests/tenant-runtime-routes.test.ts`, `tests/tenant-review.test.ts`, `tests/tenant-review-d1.test.ts`, `tests/tenant-context.test.ts` and the accepted Task 2 route audit |
| Provider ID collisions, stale jobs and Personal-only behavior | `tests/tenant-provider-jobs.test.ts`, `tests/tenant-plaid-jobs.test.ts`, `tests/tenant-lunchflow-collisions.test.ts`, `tests/lunchflow-bound-service.test.ts`, `tests/lunchflow-mappings-migration.test.ts`, `tests/lunchflow-platform-d1.test.ts` |
| Unknown/disabled identity, refresh/replay/pairing races | `tests/tenant-auth.test.ts`, `tests/tenant-auth-publication-races.test.ts`, `tests/tenant-pairing.test.ts`, `tests/tenant-web-auth.test.ts` |
| Client identity change, callback/logout, stale generation intents | `tests/web-session-isolation.test.ts`, `tests/mobile-session-coordinator.test.ts`, `tests/private-session-focus.test.ts`, `tests/mobile-lunchflow-controls.test.ts`, `tests/lunchflow-generation-http.test.ts` and accepted native tests |
| Deployment order, actual baseline, phase split, failed evidence/restore | `tests/hosted-users-deployment-gate.test.ts`, `tests/hosted-users-evidence.test.ts`, `tests/hosted-users-activation.test.ts`, `tests/hosted-users-cutover-rehearsal.test.ts` |

Final test/review results belong in the task report; this map is not a claim that production observations occurred.

Command references verified against official Cloudflare documentation: [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [queue pause and retention](https://developers.cloudflare.com/queues/configuration/pause-purge/), [cron propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/). Local secret filename/ignore checks are not a full Git-history secret audit.
