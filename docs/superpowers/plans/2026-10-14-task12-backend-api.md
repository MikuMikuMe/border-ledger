# Task 12 Backend/API Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Worker/D1 import-preview, bounded-chunk, durable-commit, cancel, and streaming-export APIs for the owner-authenticated mobile v1 contract.

**Architecture:** Reuse the existing owner authentication, `import-store`, reconciliation commit service, and ledger report predicates. Keep staged rows owner-bound and invisible until the existing reconciliation batch completes, then close the preview with a durable publication receipt; derive preview identity from owner/idempotency input and use operation-bound replay for retries. Keep route validation and structured error responses in `worker/mobile.ts`, with OpenAPI and migration-fixture registration matching the actual service shapes.

**Tech Stack:** TypeScript, Cloudflare Worker Request/Response APIs, D1-compatible SQL, Miniflare/Vitest, in-memory SQLite direct checks.

**Spec:** `docs/superpowers/specs/2026-10-13-android-bank-alerts-design.md`, Task 12 in `docs/superpowers/plans/2026-10-13-android-bank-alerts.md`, and the user-provided backend/API scope.

## Global Constraints

- Backend/API scope only; preserve existing partial changes and shared-workspace edits.
- Do not edit Android, `src/App*`, `worker/index.ts`, domain, reconciliation, recurring, or Plaid files.
- Owner import routes require `imports:write`; export routes require `exports:read`.
- Import staging is capped at 10 MiB, 24 hours, 128 KiB per chunk, 1,000 rows per chunk, and 10,000 rows total.
- Full/unfiltered export requires owner approval no older than ten minutes and streams all matching records without pagination loss.
- Error payloads remain `{ code, message, requestId, retryable }`; retries and publication receipts are stable.

## Review Focus

- Reusing one preview idempotency key with different file metadata must return a deterministic conflict instead of opening a second import.
- Replaying a chunk with the same operation/content must be a no-op, while changing content at the same index must return a stable conflict.
- A commit retry after publication must return the original receipt and must not add another transaction.
- A capture credential or owner lacking the route scope must never reach import/export storage.
- Formula-like Unicode/comma text must be safe in streamed CSV while numeric minor-unit cells remain unchanged.

### Task 1: Store invariants and migration fixture

**Files:** `worker/import-store.ts`, `worker/migrations/0010-mobile-import-export.sql`, `tests/helpers/d1.ts`, focused Task 12 tests.

- [ ] Add failing tests for declared file-size persistence, preview idempotency conflict, chunk replay/conflict, and publication retry stability.
- [ ] Fix the modern insert binding, derive previews from owner/idempotency identity, and make publication/operation errors deterministic and retry-aware.
- [ ] Register migration 0010 in the Task 12 fixture and resolve migration files relative to the helper rather than the process cwd.
- [ ] Run the focused store tests and record red-to-green evidence.

### Task 2: Mobile import/export behavior

**Files:** `worker/mobile-import.ts`, `worker/mobile-export.ts`, focused Task 12 tests.

- [ ] Add failing tests for safe formula-like cells, bounded chunk request shapes, and recent-approval export behavior.
- [ ] Preserve owner/account validation, map commit failures into mobile import errors, and keep canonical CSV ordering/streaming and approval checks deterministic.
- [ ] Run the focused service tests and inspect the emitted CSV/commit receipts.

### Task 3: Owner routes and contract

**Files:** `worker/mobile.ts`, `contracts/mobile-v1.openapi.yaml`, focused Worker route tests.

- [ ] Add failing API checks for preview POST, chunk PUT/POST, commit POST, cancel DELETE, export GET/stream, scope rejection, and structured error mapping.
- [ ] Add route branches that authenticate/authorize before reading or mutating import/export data, enforce bounded bodies and idempotency headers, and return stable JSON/CSV responses.
- [ ] Align the OpenAPI import/export request, response, method, state, limit, cancel, and error shapes with the implementation.
- [ ] Run strict TypeScript, focused Worker tests, direct in-memory SQLite checks, and the full test suite; report exact failures caused by environment or out-of-scope blockers.
