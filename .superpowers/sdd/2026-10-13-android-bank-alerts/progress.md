# SDD ledger — plan: docs/superpowers/plans/2026-10-13-android-bank-alerts.md

## Execution setup

- The approved design is `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md`.
- The plan headings are `Task 0` through `Task 17` (18 tasks), despite older prose saying “14 tasks”.
- The current workspace contains the existing Border Ledger TypeScript/Worker project but no Android module or Git metadata.
- `git init -b android-bank-alerts` was attempted and failed because the mounted WebDAV workspace denies writes to `.git/config`.
- No attached managed worktree or pull-request artifact was found.

## Rulings

- Ruling: execute all 18 numbered task headings and use the completion matrix as the task-count authority — the detailed task bodies and matrix are the current plan, while “14” is stale revision prose — cost if wrong: four extra task scopes may be attempted beyond the author’s intended count.
- Ruling: treat this same workspace as the implementation authority without creating a replacement repository; preserve a file-based ledger/reports and use direct diffs/contents for review because Git/worktree creation is unavailable — cost if wrong: commits and native diff review packages cannot be produced until an authoritative writable checkout is attached.

## Pre-flight interface scan

| Task | Own files / interfaces | Shared dependency checked | Finding / ruling |
|---|---|---|---|
| 0 | `docs/android-validation.md` and source authority | all later tasks | Must establish source, remote bindings, applied migrations before schema/release work; currently unverified. |
| 1 | Android probe, validation notes | Task 2/6/7 source capability and time | Hardware/source payload evidence gates parser/listener claims; Pixel and private source data are unavailable in this session. |
| 2 | shared contracts/domain/tests | Tasks 3–15 all consume DTOs, identities, money/lifecycle/time | Must freeze names before persistence/API/native work. |
| 3 | migrations/stores/schema types | Tasks 4/8/10/12/15 consume identities/scopes/staging/preferences | Provider/recurring IDs and existing FKs must survive; depends on Task 0 authority. |
| 4 | owner auth/pairing/routes | Tasks 5/8/9/12/14/15 consume scopes and grant lifetimes | Owner and capture credentials must remain separate across all routes. |
| 5 | Android encrypted store/session/login/theme | Tasks 6–9/11–15 consume session/storage/onboarding | Capture and owner state must not share credential/cache authority. |
| 6 | Android extractor/parser/identity | Tasks 7/8/9 and Task 16 consume event DTO/time | Generic/redacted payloads must produce review/unsupported, never fabricated charges. |
| 7 | listener/outbox/scheduler | Tasks 8/9 consume durable events | Local transaction and original post time precede queued status/upload. |
| 8 | Worker ingest/acks | Tasks 9/10/11/12 consume receipts/projections | Ledger-scoped event idempotency and atomic acknowledgement are load-bearing. |
| 9 | Android upload/cache sync | Tasks 11–15 consume owner reads and capture receipts | Ack persistence precedes deletion; signed-out cache and credential boundaries remain visible. |
| 10 | reconciliation/import/web review | Tasks 11/12 consume canonical projections and identity | Weak matches stay candidates; same-file/row replay differs from amount fingerprint. |
| 11 | reports/theme/native shell | Tasks 12–15 consume read services/theme/motion | Full-window aggregation is independent of list pagination; all owned surfaces share theme. |
| 12 | import/export services and native flows | Tasks 13–15 and 17 consume owner routes/parity | Durable staging/publication and complete CSV are prerequisites for parity. |
| 13 | recurring service/native screens | Task 17 consumes parity evidence | Source estimates cannot create ledger transactions; actuals use canonical projections. |
| 14 | Plaid connection service/native Link | Task 17 consumes connection/recovery evidence | Provider item/token lifecycle stays server-side and owner-scoped. |
| 15 | preferences/devices/about/parity | Task 17 consumes complete feature inventory | Device settings are local; reporting preferences are shared and revisioned. |
| 16 | CMB profile/parser | Task 17 consumes conditional source outcome | Independent source gate; never reuse BOC assumptions without evidence. |
| 17 | CI/release/recovery/runbook | all tasks | Cannot claim signed Pixel acceptance without hardware, signing custody, and verified authority. |

## Task checklist

- [x] Task 0: authoritative source and database baseline
- [x] Task 1: Pixel capture feasibility probe
- [x] Task 2: currency/event/lifecycle/time contracts
- [x] Task 3: populated D1 and native-parity storage
- [x] Task 4: owner login broker and pairing boundaries
- [x] Task 5: encrypted storage, native login, onboarding
- [x] Task 6: source extraction/parser/observation identity
- [x] Task 7: production listener and durable intake
- [x] Task 8: atomic Worker ingestion/acknowledgement
- [x] Task 9: upload/retry/cache synchronization
- [x] Task 10: BOC statements and reconciliation
- [x] Task 11: reports/theme/native shell
- [x] Task 12: native import/commit/CSV export
- [x] Task 13: recurring analysis/classification
- [x] Task 14: native Plaid connection management
- [x] Task 15: settings/devices/about/parity closure
- [x] Task 16: independent CMB source gate
- [ ] Task 17: visual verification/signed release/recovery

## Completed task records

- Task 0: complete with concern (no Git/worktree commit available; local baseline and API-observed D1 metadata documented; task review clean after one fix round).
- Task 1: complete with concern (debug-only Android probe scaffold and bounded metadata/reconnect inspection reviewed; no Android toolchain, APK, Pixel, or source-capability evidence; task review clean after one fix round).
- Task 1: minor (deferred): the baseline's earlier “no Android application/module files were found” inventory sentence predates the scaffold and should be corrected in the final validation/documentation pass.
- Task 2: complete with concern (currency/event/lifecycle/time contracts, OpenAPI contract, and compatibility updates accepted after independent review and three scoped fix/re-review rounds; direct TypeScript and isolated domain smoke checks passed; Vitest could not collect because `@jridgewell/trace-mapping/dist/trace-mapping.mjs` is missing; no Git metadata or runtime suite evidence available).
- Task 3: complete with concern (0003–0005 migrations, schema snapshot, bounded stores, provider-ingestion identity update, and focused preservation/integrity tests accepted after one scoped fix/re-review round; direct TypeScript and SQLite foreign-key/immutability smoke passed; Vitest is blocked by missing `trace-mapping.mjs`, Miniflare by missing `workerd`, and hosted D1 behavior remains unverified).
- Task 4: complete with concern (owner login/PKCE/Access approval, rotating sessions/replay, capture pairing/scopes, route guards, and revocation boundaries accepted after one scoped fix/re-review round; direct auth/pairing/route and TypeScript checks passed; Vitest/Miniflare/hosted-D1 execution and Git metadata remain unavailable; one expired-token coverage case is minor).
- Task 5: complete with concern (Android encrypted/session/capture foundation, verified callback boundary, System/Light/Dark motion/login/onboarding surfaces, and static security checker accepted after one scoped fix/re-review round; static check passed; Gradle/Kotlin tests, APK, emulator/ADB, Pixel/App Link runtime and live permission-state reporting remain unverified on this host).
- Task 6: complete with concern (bounded extractor/tracker/parser/BOC synthetic adapter and DTO mapping accepted after two scoped fix/re-review rounds; static checks passed; Gradle/Kotlin tests, real BOC payload/source gate, Pixel and persistent event-store integration remain unverified).
- Task 7: complete with concern (production notification listener, fail-closed profile/context handling, activation-before-recovery, original notification timing, atomic encrypted observation/candidate/outbox intake, event-level 5,000 cap/retention, duplicate/conflict identity handling, credential pause, health/reconciliation, unique network-constrained scheduling, and bounded scheduler retry accepted after scoped fix/review loops; static checks passed; Gradle/Kotlin/device/Pixel/runtime evidence unavailable; the older Task 5 checker still falsely flags the required `NotificationListenerService` declaration).
- Task 8: complete with concern (Worker alert ingestion, capture-scope authorization, atomic D1 event/projection/transaction persistence, stable acknowledgement/status recovery, idempotency/conflict handling, route guards, and focused tests added; direct TypeScript and in-memory SQLite transaction/route checks passed; Vitest collection is blocked by UNC `cmd.exe` fallback plus missing `@jridgewell/trace-mapping/dist/trace-mapping.mjs`; Miniflare/hosted-D1 behavior remains unverified; no Git metadata or commit is available.)
- Task 9: complete with concern (bounded Android upload coordination, acknowledgement-before-purge, partial-ack handling, retry classification, pairing pause, owner-read cache invalidation and static policy checks accepted; Android/Gradle/ADB/device execution remains unavailable, so native unit/instrumented and Pixel evidence are pending.)
- Task 10: complete with concern (statement identity/reconciliation, candidate ranking, bank-reference matching, atomic commit, immutable provenance, alert-first/statement-first transitions, duplicate-safe migration, new-operation same-file replay, annotated evidence preservation, voided lifecycle exclusion and web review integration accepted after scoped corrective workers and independent review; direct TypeScript and in-memory SQLite report/reconciliation smokes passed; Vitest/Miniflare/hosted D1, actual BOC export evidence and Pixel validation remain unavailable.)
- Task 11: complete with concern (full-window Worker reports, owner snapshot bounds, superseded-source filtering, dynamic currency handling, web report-backed Overview and native Compose ledger shell/theme/cache boundary accepted after scoped corrective workers; full TypeScript passed and report smoke passed; Compose/Gradle/device visual/accessibility/runtime evidence remains unavailable.)
- Task 12: complete with concern (durable staged import previews/chunks, duplicate-candidate decisions, final publication barrier, complete CSV export, native document-reader bounds and registered-currency scale validation implemented; focused import/export/review coverage passed inside the 55-test changed-path suite and the 62-test alert/recurring suite; Gradle/native execution, real BOC export and Pixel Save/Share evidence remain unavailable.)
- Task 13: complete with concern (owner recurring list/summary/detail/classification APIs, revision-aware mobile saves, legacy web-route compatibility, registry-driven currency filters/summaries across Worker/web/native, source-vs-actual semantics and native screens implemented; recurring API/routes passed 7/7 and recurring/web currency coverage passed in the focused suites; Gradle/Compose/Pixel parity remains unavailable.)
- Task 14: complete with concern (server-side Plaid Link token/exchange/account verification, encrypted provider credential boundary, idempotent pending selection/cancel/sync/disconnect, owner-vs-capture guards, and native coordinator/repository implemented; the production Activity now attaches an official Plaid Link SDK 6.2.2 bridge with bounded preload, single-flight/cancellation handling, ActivityResult recovery handoff, and short-lived public-token-only mapping; connection-service/Plaid coverage passed in the 55-test focused suite, the redelivered-result unit case is present, and `android/task14-static-check.ps1` passed with `build_verified=false`; a registered package, provider OAuth return, valid Sandbox token, and Pixel evidence are still required, so no Sandbox/Pixel or live RBC evidence is claimed.)
- Task 15: complete with concern (owner preferences/device/capture/about/parity routes and native surfaces, full registered-currency validation/selection across legacy web/mobile/native paths, revisioned legacy `/api/preferences` persistence, separated owner/capture lifecycle and import-only source gate implemented; native settings now use an explicit save with registry validation; preference/UI route coverage and static checks passed; Gradle/native navigation, accessibility and Pixel verification remain unavailable.)
- Task 16: complete with concern (CMB remains independently gated and fail-closed/import-only; no BOC parser reuse or fabricated CMB support; source-profile/onboarding static validation passed, but no approved CMB sample or Pixel capability evidence exists.)
- Task 17: incomplete with explicit release gate (TypeScript, focused backend/native-contract suites, OpenAPI uniqueness, 162-code registry parity and static security/parity checks pass; Gradle wrapper JAR, Gradle/ADB/apksigner, signing custody, APK, Pixel visual/accessibility/install/update and live WeChat/Plaid evidence are unavailable. No release artifact is claimed.)

## Verification update after the initial task records

- The older Task 2–8 notes refer to an earlier missing Vitest dependency/UNC collection failure. On this mounted workspace, Vitest runs reliably from the mapped `Z:\Projects\Personal-Finance` path with an explicit 30-second timeout. The current changed-path evidence is 14 files/70 tests passed, 7 files/55 tests passed, 7 files/23 tests passed, 2 files/16 storage tests passed, plus direct TypeScript success; the full unconstrained run is not represented as a blanket pass because the mounted workspace remains slow and some unrelated legacy fixtures need separate cleanup.
- Currency follow-up: WeChat/source alerts accept every code in the validated 162-entry registry with per-currency minor units; unknown codes and ambiguous symbols remain review-only. The JSON contract and Android registry are equal at 162 entries with no missing/extra codes.
- Preference follow-up: the authenticated legacy web surface now reads and writes the same revisioned reporting preferences as mobile, including any registered currency; stale writes return 409 and invalid/unknown values fail closed. The web UI falls back to defaults when that protected route is unavailable.
