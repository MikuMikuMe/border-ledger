# Android validation baseline

The React Native migration's current cutover gates and repeatable checks are in
[react-native-validation.md](react-native-validation.md). Historical validation
below remains evidence for its stated revision; it does not close the RN
production-session, App Link, accessibility or signed-upgrade gates.

## Final local verification update — 2026-10-15

The recovered local checkout has now passed the native Android gate with the installed SDK and wrapper: `:app:testDebugUnitTest`, `:app:lintDebug`, and `:app:assembleRelease` all succeeded. The release APK was produced unsigned as expected for the local gate. A disposable debug keystore may be used only for local installation checks; no signing material belongs in this repository.

The final ADB inventory was empty. The connected physical phone was therefore not available for this run, and the disposable x86_64 AVD could not boot because Windows hardware acceleration is disabled. This update does not claim physical-device screenshots, install/update evidence, TalkBack capture, or crash-buffer evidence. Chrome headless DOM smoke and the focused web/FX test groups provide the corresponding browser evidence.

Date: 2026-10-13  
Status: `DONE_WITH_CONCERNS` — local source inventory and configured D1 metadata recorded; repository authority and active Worker deployment/runtime state could not be established.

## Facts observed in this workspace

- The workspace contains the Border Ledger React/TypeScript application and Cloudflare Worker. The package is `cross-border-spending-tracker` version `0.1.0`.
- `package.json` defines `dev`, `build`, `preview`, `test`, `test:watch`, and `typecheck` scripts. This baseline task did not run application tests or builds.
- The migration files present locally include the original ledger/Plaid/recurring migrations plus the numbered mobile, multicurrency, reconciliation, currency-registry and parity migrations through the current implementation. `worker/schema.sql` is also present as a complete schema reference. These files describe local source only; they do not prove what a remote database has applied.
- `wrangler.jsonc` configures a default Worker named `border-ledger`, an explicit `production` environment, D1 bindings named `DB`, migration directory `./worker/migrations`, and Queue producer/consumer bindings. It sets `PLAID_ENV` to `sandbox` by default and `production` in the named environment. This is configuration observed on disk, not evidence of deployed Cloudflare resources, active environment, or binding state.
- The local source inventory includes `src/`, `worker/`, `android/`, `tests/`, `docs/superpowers/`, and the numbered D1 migrations. Git tracking was not established.
- The Android design and plan are present at `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md` and `docs/superpowers/plans/2026-10-13-android-bank-alerts.md`. The plan records an 18-task sequence and makes source authority and remote migration verification a gate before schema work.

## Facts not verified

- Git authority, revision, branch, and uncommitted changes: the mounted workspace has no usable `.git` metadata. `git status`, `git rev-parse`, and `git branch` failed with “not a git repository.” No commit or authoritative revision can be claimed.
- Attached authoritative checkout/worktree: the Codex artifact listing returned no attached artifacts. No alternate authoritative checkout was identified from the available app context.
- Active Cloudflare Worker deployment, effective runtime bindings, and end-to-end deployment behavior: not queried or verified. The configured D1 IDs' migration rows and schema object names were queried through the API and are recorded below; local Wrangler configuration alone is not proof of deployment state.
- Android SDK/build environment, Pixel 10 Pro availability, installed Android/WeChat versions, notification capture behavior, signing credentials, and on-device acceptance: not available or verified in this task.

## Cloudflare D1 metadata observed through the API

Read-only Cloudflare API queries were made on 2026-10-13 against the two D1 database IDs configured in the local `wrangler.jsonc`, in Cloudflare account `a0af41818e1b715f66046b0d7870ce70`. Both API queries returned successful results:

| Configured environment | `d1_migrations` rows and `applied_at` timestamps |
|---|---|
| Sandbox `border-ledger` | `0000-ledger-base.sql` — 2026-10-13 09:38:40; `0001-plaid.sql` — 2026-10-13 09:38:42; `0002-recurring.sql` — 2026-10-13 09:38:45 |
| Production `border-ledger-production` | `0000-ledger-base.sql` — 2026-10-13 09:38:47; `0001-plaid.sql` — 2026-10-13 09:38:49; `0002-recurring.sql` — 2026-10-13 09:38:53 |

The same read-only queries inspected `sqlite_master` names and types, not application rows. Both databases exposed the legacy tables `accounts`, `transactions`, `imports`, `sync_state`, `plaid_items`, `plaid_accounts`, `recurring_streams`, `recurring_stream_transactions`, `recurring_classifications`, and `recurring_sync_state` (plus SQLite/Cloudflare internal tables), and the corresponding legacy indexes. No mobile tables were present in these query results. No transaction, account, credential, or secret values were selected or recorded.

This is API-observed metadata for the queried D1 database IDs at query time. It supports the listed migration-history and schema-object observations, but does not prove which Worker deployment is serving traffic, its effective runtime bindings, end-to-end application behavior, or any other deployment/runtime property.

## Release and schema gate

Do not design or apply an executable database upgrade, deploy, or claim Android acceptance until the authoritative writable source is attached and effective target bindings/deployment behavior are established. The configured databases' migration history and schema object names were observed via the Cloudflare API as documented above. No secrets, credentials, private screenshots, signing material, or real transaction data are recorded here.

## Task 1 — notification probe validation (2026-10-13)

Status: **not tested here**. A debug-only, metadata-only scaffold is present under `android/`. No Pixel, emulator, Android SDK, ADB, Gradle installation/cache, or Gradle wrapper JAR was available on this host. The app has not built or installed, and no notification callback has been observed. Java 21.0.7 is present. The Gradle wrapper property pins Gradle 8.13; AGP 8.13.2, Kotlin/Compose plugin 2.2.20, Compose BOM 2025.10.00, Activity Compose 1.11.0, compile/target SDK 36, min SDK 26 and JVM target 17 are source pins only, not resolved/build-proven versions. The Android build remains blocked until a trusted Gradle wrapper JAR and SDK are supplied.

| Sanitized capture matrix | Required observation on the owner's Pixel | This session |
|---|---|---|
| Device/source inventory | Installed Android and WeChat versions, actual BOC conversation identity and package; CMB account/channel and source package if available | Not supplied; unknown |
| BOC export options | Credit/debit availability and actual CSV, XLSX, text PDF or image PDF behavior | Not supplied; unknown |
| New BOC delivery, phone locked/unlocked | Whether a new individual notification posts; source package/type; title/body presence without copying text | Not tested here |
| WeChat foreground/background | Delivery and field-presence differences | Not tested here |
| Silent versus muted conversation/channel | Whether a notification posts at all; silent posted alert versus in-app mute | Not tested here |
| Content-preview settings | Generic/redacted versus useful individual fields | Not tested here |
| Permission revoke/regrant and reconnect | Listener connected state, missed interval, currently active notification behavior; recovered rows must be labeled separately from new callbacks | Not tested here; implementation inspects active notifications only and does not promise history/backfill |
| Notification representations | Standard text, big text, text-line count, messaging representation/count, and bounded public API inspection of individual message timestamps | Not tested here; implementation retains derived presence/count/range scalars only |
| Time comparison | `sbn.postTime`, accessible individual message time if any, callback time, device timezone, user's clock and Toronto local day | Not tested here; implementation displays device timezone and derives the Toronto reporting day |
| Usability/accessibility | Light/dark, 200% font, TalkBack, 48 dp targets, Battery Saver/reduced motion | Not tested here; screen is static by design |

No real/private notification payload, screenshot, transaction, source identifier or export sample was added. The probe's fixed `com.tencent.mm` filter does not establish BOC source identity. The controlled procedure is to trigger one new alert from the known BOC conversation, verify that visible source on the device, then compare the package-only row and timing. On API 30+, the probe inspects Android's public `MessagingStyle` representation for bounded individual timestamp count and min/max; it never retains message text. On reconnect, current active notifications are inspected through the same package-first path and labeled recovered; dismissed history is unavailable. The on-device source capability check remains open. Before automatic capture, prove approved source and type, labeled amount/currency, resolvable instrument, and original individual posting time. Generic, redacted, summary-only, or untimestamped notifications remain unsupported/review-only. If both WeChat and a verified BOC app source fail, use statement import only; automatic-monitoring acceptance is unmet. CMB remains disabled until separately proven. The UI action is named `Export sanitized metadata CSV`; Android reports completion, cancellation, or write failure for the user-selected document destination.

## Task 16 — CMB source gate (2026-10-14)

No real CMB notification sample or source-capability evidence is available. CMB is therefore represented only by the disabled `cmb-credit-card-unsupported` profile (`CMB_UNSUPPORTED`, `approved = false`) with no asserted package, channel, sender, account type, or payload format. The source parser registry routes that kind, and any generic/CMB-labeled observation that reaches it, to a fail-closed unsupported parser that returns review with no event or money. It does not reuse the BOC parser. CMB cannot be selected as an approved notification source or produce a fabricated charge; use statement import until an independently verified CMB sample and capability test exist. BOC profile/parser behavior is unchanged.

## Task 17 — release and verification runbook

Status: **local native gate complete; device/signing/remote-release gates remain owner-controlled**. This document records the acceptance boundary and commands. The recovered checkout has a working wrapper JAR and SDK, and the unsigned native test/lint/release assembly gate passed. It does not claim a signed production release, physical-device acceptance, or remote deployment acceptance.

### F01–F18 parity ledger

Each row needs a reachable native path, real service behavior, and an owner-captured acceptance record. A website link or placeholder does not close a row. `Pending` is the honest initial state for this runbook.

| ID | Native acceptance boundary | Owner evidence to capture | Status |
|---|---|---|---|
| F01 | Private login, profile, session recovery, explicit sign-out | Pixel screen recording plus signed-out cache check | Pending |
| F02 | Today/week/month totals and confirmed/provisional lens | Same synthetic ledger compared on web and Android | Pending |
| F03 | Chart ranges with accessible text/table alternative | Light/dark, narrow phone, 200% font screenshots | Pending |
| F04 | Search, filters, details, category/note edit and conflict recovery | Save, validation failure, and revision-conflict evidence | Pending |
| F05 | Full CSV export through Save/Share, current filter versus all records | Sanitized exported header/row-count record | Pending |
| F06 | Document picker, account selection, preview, mapping, row errors and duplicates | Synthetic CSV/verified BOC fixture and interruption record | Pending |
| F07 | Durable commit, progress/resume/cancel-before-publication, review queue | Reconnect and idempotent commit comparison | Pending |
| F08 | Account, institution, currency, freshness and capture status | Account metadata and stale/error state capture | Pending |
| F09 | Official Plaid Link, selected-account confirmation/cancel | SDK 6.2.2 Activity Result bridge and source-level recovery handoff are wired; Sandbox return, cancellation cleanup and selected-account Pixel evidence remain pending | Pending |
| F10 | Refresh and disconnect with provider revoke and ledger preservation | Before/after connection and historical-row evidence | Pending |
| F11 | Recurring list, currency/classification filters and paging | Same recurring fixture and stale/error states | Pending |
| F12 | Monthly/yearly estimates, posted cost and exclusions | Per-currency fixture totals and excluded-stream evidence | Pending |
| F13 | Upcoming/change/detail/history/classification editing | Expected versus actual amounts and save/error evidence | Pending |
| F14 | Shared timezone, week-start and reporting-currency preferences | Persist/reload on both clients; no implicit FX claim | Pending |
| F15 | Review notices, profile/help and reporting-policy explanations | Reachable native pages and adverse-state capture | Pending |
| F16 | Public introduction and isolated, labeled representative preview | Pre-login screenshot proving synthetic isolation | Pending |
| F17 | Shared Worker/domain/provider/import/export semantics | Cross-client fixture assertions and source revision | Pending |
| F18 | Login motion, theme modes, notification onboarding/health and offline upload | Pixel motion/frame-time, TalkBack/IME, offline/reconnect evidence | Pending |

### Owner / capture boundary

- The owner supplies the Pixel, installed Android/WeChat versions, BOC conversation/source identity, CMB channel facts, bank enrollment, notification triggers, sanitized fixtures, visual captures, signing key custody, and the final release decision.
- The implementation/release operator owns reproducible scripts, CI configuration, static checks, manifest/permission inspection, artifact provenance, and recording observed results without inventing device or secret evidence.
- Owner credentials authorize full-parity read/review/import/export/bank/settings workflows. Capture credentials are separate, source/account/currency-scoped write credentials; they cannot read the ledger, review records, manage banks, or refresh owner sessions.
- Notification capture retains only approved, bounded metadata and must preserve original posting time. Generic, redacted, summary-only, unapproved, or untimestamped notifications stay review/import-only.
- Never commit private notification text, statements, screenshots, APK signing material, passwords, tokens, or real transaction data.

### Offline, logout, and cache recovery

1. Offline upload: enqueue a synthetic event, kill/restart the app, reconnect, and verify one durable receipt per eligible event with original event time preserved.
2. Offline owner reading: allow only the same previously signed-in owner on an unlocked device while the remembered lease is valid; show snapshot time and permit no mutation.
3. Explicit logout: hide/clear owner-visible financial cache and credentials, pause monitoring, retain only encrypted same-ledger pending uploads and purpose-limited revocation intents, and show pending revocation state when offline.
4. Reconnect: acknowledge revocation before refreshing or writing; expired, known-revoked, or signed-out sessions cannot reveal cached finance data. A delayed old revocation must not revoke a newly issued session.
5. Upgrade: install a higher version with the same signing key, confirm queued identity, credentials, and original event times survive, then repeat logout and reconnect checks.

### Migration, backup, and restore gate

- [ ] Rehearse versioned migrations on a populated synthetic/sandbox copy, including existing account/provider/recurring rows, foreign keys, indexes, export, and restore. Production migration is a separately authorized action.
- [ ] Confirm the Android manifest and both backup-policy XML files exclude databases, files, shared preferences, and external data from cloud backup and device transfer. A restored copy must not resurrect revoked owner/capture grants; invalidate them and re-pair/login.
- [ ] Keep a recoverable database/export backup in owner-controlled storage, record the schema revision and restore date, and never put private data or credentials in CI artifacts.
- [ ] Record exact source revision, environment/binding identity, migration output, sanitized row counts/totals, and post-restore authorization check. Local config alone is not remote migration evidence.

### Signing and release gate

- [ ] Keep signing material in owner-controlled secure backup and protected CI secrets (`ANDROID_KEYSTORE_BASE64`, password, alias, and key password). It never enters the repository or logs.
- [ ] Verify stable application/package identity, App Link/redirect registrations, release manifest permissions, absence of debug-only probe components, and separate owner/capture authorization.
- [ ] Run `assembleRelease`, `apksigner verify`, SHA-256 output, and actual installation/update/recovery evidence with an available Gradle wrapper/SDK. This workspace has not met those conditions.
- [ ] Confirm the private release workflow remains credential/toolchain-gated. A missing wrapper JAR or signing secret must fail or gate with an explicit message; it must never produce a success-shaped placeholder.

### Production promotion acceptance bundle

The signed candidate workflow creates an unpublished draft only. The promotion
workflow now requires an owner-captured `acceptance-manifest.json`, the
matching `acceptance-evidence.zip`, and the manifest SHA-256 as an explicit
input. Before making a draft public, it checks that the manifest is bound to
the exact `main` source SHA, APK digest, production package, version, and
GitHub signing-key certificate; every F01–F18 gate is marked passed and points
to checksum-verified evidence; the evidence contains either a preserved-data
in-place upgrade from a lower version or a verified fresh install after a
signing-certificate transition; and the production App Links endpoint currently
serves the same checksummed association response authorizing the GitHub candidate
and previous production signer during the transition. Missing, stale, modified,
or mismatched evidence fails closed.

The manifest is JSON with `schemaVersion: 2`, exact `sourceSha`, `apkSha256`,
`packageId`, `mobileEnvironment`, `signingCertificateSha256`, `versionCode`,
`appLinks`, `installationAcceptance`, and `gates` objects. Each gate F01–F18 has
`status: "passed"` and a nonempty `evidence` list; each evidence item has a
bundle-relative `path`, lowercase hexadecimal `sha256`, and an `attestation`
with matching `sourceSha` and `gateId`, UTC `capturedAt`, `device`, and
lowercase-slug `evidenceType`. Capture attestations must be no more than 30
days old. Evidence files must be nonempty, checksum-valid, and unique by path
and content across the F01–F18 gates. The App Links record
includes the production URL, package/certificate, response digest, and an
evidence-file reference. `installationAcceptance.mode` is either
`in-place-upgrade` or `fresh-install`. In-place upgrades include source and
target version codes and checksummed JSON evidence confirming the upgrade and
existing-data preservation. Fresh installs require the known previous production
signer SHA-256 (1ff2a25e39136eefa79d23cc7531f702b2a162280538410509ca2ff65b4744ed),
distinct from the candidate. They also require
the candidate version code and a
`dataDisposition` of `backup-verified` or `no-existing-data`; checksummed JSON
evidence must confirm the new install completed with the previous app absent.
The static App Links association temporarily authorizes both the legacy signer
(1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED) and the GitHub release signer so existing installs retain
verified auth callbacks. New APKs remain signed only with the GitHub key.
Remove the legacy association after old installs retire.
Use a device with no valuable local data or verify a backup before uninstalling
an app signed with the previous key, because Android cannot update it in place
across signing certificates. Capture evidence without personal financial data,
credentials, or signing material.

### Attaching the owner acceptance bundle

The signed-candidate workflow creates the draft with only its APK, checksum,
and candidate manifest. After all owner checks are complete, create the
acceptance manifest and evidence ZIP from sanitized artifacts, then upload only
those two acceptance files to the same still-draft release:

```powershell
$tag = '<exact draft candidate tag from the GitHub release>'
$candidateDir = Join-Path (Get-Location) "candidate-download-$([guid]::NewGuid().ToString('N'))"
if (Test-Path -LiteralPath $candidateDir) { throw 'Use a fresh candidate download directory.' }
New-Item -ItemType Directory -Path $candidateDir | Out-Null
gh release download $tag --repo MikuMikuMe/border-ledger `
  --pattern candidate-manifest.json --dir $candidateDir
$candidate = Get-Content -Raw -LiteralPath (Join-Path $candidateDir 'candidate-manifest.json') | ConvertFrom-Json
Compress-Archive -Path .\acceptance-evidence\* -DestinationPath .\acceptance-evidence.zip -Force
gh release upload $tag .\acceptance-manifest.json .\acceptance-evidence.zip `
  --repo MikuMikuMe/border-ledger
$manifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath .\acceptance-manifest.json).Hash.ToLowerInvariant()
gh workflow run android-promote.yml --repo MikuMikuMe/border-ledger --ref main `
  -f tag=$tag `
  -f "source_sha=$($candidate.sourceSha)" `
  -f "apk_sha256=$($candidate.apkSha256)" `
  -f "acceptance_manifest_sha256=$manifestHash"
```

Replace the tag placeholder with the exact still-draft candidate release tag.
The commands derive the source and APK digests from that candidate's manifest
and compute the acceptance manifest digest locally. Do not replace the
candidate APK, checksum, or candidate manifest. Promotion independently verifies the downloaded APK's
cryptographic signer with `apksigner` and its package/version metadata with
`aapt2`; it also binds the owner manifest to the exact source and APK digests.
The draft and its acceptance assets remain unpublished until that protected
workflow succeeds. All F01–F18 rows above remain **Pending** until the owner
performs and records the actual checks; automated wiring and fixtures are not
acceptance evidence.

### CMB outcome

CMB is an explicit unsupported outcome for this release. No source package, channel, account type, payload, or parser support is asserted. Keep `CMB_UNSUPPORTED` disabled and use statement import/review until an independent real-sample capability test proves the channel, fields, lifecycle labels, and posting time. No BOC parser reuse or fabricated CMB charge is acceptable.

### Future validation commands

Run from a checkout with a normal local path and the wrapper JAR supplied:

```powershell
pwsh -NoProfile -File android/task17-static-check.ps1
pwsh -NoProfile -File android/task17-static-check.ps1 -RequireAndroidToolchain
cd android
.\gradlew.bat lintDebug testDebugUnitTest assembleRelease --no-daemon
```

After a release APK is produced by the protected release process, verify it with an SDK `apksigner` and record the digest without putting the artifact or key in source control:

```powershell
apksigner verify --verbose .\app\build\outputs\apk\release\app-release.apk
Get-FileHash -Algorithm SHA256 .\app\build\outputs\apk\release\app-release.apk
adb install -r .\app\build\outputs\apk\release\app-release.apk
adb shell dumpsys package com.lofuyu.borderledger
```

These commands are instructions for a future equipped environment, not evidence that they ran here.

