# SDD ledger — plan: docs/superpowers/plans/2026-10-14-native-review-destination.md

Setup: shared WebDAV checkout preserved. Git metadata is incomplete (`.git/HEAD` and `.git/config` are absent), so commit/worktree/review-package commands are unavailable; verification will use focused tests and static checks.

Pre-flight: Task 2 consumes Task 1's `ReviewRepository`/DTO interfaces; the plan names those interfaces consistently. Task 1 also changes the owner interceptor boundary required by the Task 2 HTTP adapter. No other task shares mutable destination code beyond the explicitly scoped Review imports/constructor wiring.

Ruling: use the existing shared checkout rather than creating a worktree — the user explicitly placed this work in the shared workspace, and no usable Git metadata exists to create or review a linked branch; cost if wrong: integration cannot be isolated from concurrent edits.

Implementation complete within the native scope: bounded owner-authenticated Review DTO/repository, strict response decoding, revision-aware ViewModel actions, conflict/error/refresh handling, explicit snapshot/live annotation gates, owner/capture method boundaries, focused tests, and Review-only LedgerShell wiring were added. The Worker checkout was not modified.

Worker audit: `worker/mobile.ts` has `POST /api/mobile/v1/alerts` capture handling only; the owner `GET /api/mobile/v1/alerts`, alert review PATCH, and transaction annotation PATCH branches are absent from the current Worker router. The Android repository maps 404/501 to an explicit unavailable state, and the UI remains read-only/gated when no authoritative Review response exists.

Verification: `android/task-review-static-check.ps1` passes with `worker_review_routes=not-present-in-current-mobile-router`; `npm run typecheck` passes from mapped `Z:`. Android Gradle verification is blocked before compilation because the wrapper JAR is missing and no global Gradle installation is available; the UNC workspace also emits the Windows UNC warning. No native test pass is claimed.
