# Task 0 — Establish the authoritative source and database baseline

## Owner/dependencies

Implementation/platform owner; before any product/schema edit.

## Files

No product changes. Record a sanitized baseline in `docs/android-validation.md` when source authority is established.

## Requirements

- Identify the intended existing project/repository through app attachments, saved project context and available repository metadata; inspect current checkout/branch and uncommitted changes. Attach/recover the authoritative checkout while preserving current workspace edits. If this project has never been a repository, initialize this same project during authorized implementation rather than creating an unrelated replacement.
- Record the authoritative revision and relevant source inventory. Verify the deployed sandbox/production Worker environment, database binding and actually applied migration history before designing an executable upgrade. A README/schema file is not proof of remote database state.
- Gate schema changes and release work on this baseline; plan artifact creation itself does not require modifying Git or a remote database. Checkpoint only after source authority is resolved.

## Known context and constraints

- Workspace: `Z:\Projects\Personal-Finance`.
- Current files are the existing Border Ledger React/TypeScript/Worker project. No Android module exists.
- There is no attached managed worktree and the mounted workspace currently exposes no writable Git metadata; do not create a replacement repository.
- Do not access or record secrets, private screenshots, real transaction data, credentials, or signing material.

## TDD/verification

This task is documentation/baseline work, so production-code TDD does not apply. Verify the note accurately distinguishes observed local facts from unverified remote/device facts.

## Report

Write the detailed result to `.superpowers/sdd/2026-10-13-android-bank-alerts/task-0-report.md`, including files changed, commands/checks, blockers, and the exact baseline status. Do not dispatch subagents. If Git/remote authority cannot be established, report `DONE_WITH_CONCERNS` rather than claiming it was verified.
