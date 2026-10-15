# Currency Compatibility Audit Implementation Plan
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every production currency boundary accepts any code in the shared registered ISO currency registry, rejects unknown codes, and converts major units using the registered minor-unit metadata. WeChat/source notifications and Plaid imports must work for non-CAD/CNY currencies without changing demo fixtures or display-priority copy.

**Architecture:** Keep `src/domain/currencies.ts` as the TypeScript source of truth and `CurrencyRegistry` as the native source of truth. Replace production CAD/CNY or ISO-shape gates with registry lookups at Worker, web, and Android input boundaries. Preserve wire formats and existing error codes/messages unless the old text falsely describes the accepted currency set. Keep all minor-unit conversion at the boundary that parses major amounts.

**Tech Stack:** TypeScript, Cloudflare Worker services, React web client, Kotlin Android app, Vitest, Gradle/JUnit.

**Spec:** User request in the active chat; no standalone spec file supplied.

## Global Constraints

- Do not modify `worker/recurring-store.ts`.
- Do not revert or rewrite other workers’ edits, synthetic/demo fixtures, or intentional display-priority copy unless it rejects a registered currency or produces an incorrect total.
- Add focused tests for at least one non-CAD/CNY registered currency and unknown-code rejection where each boundary has meaningful validation.
- Run TypeScript and focused tests where possible; report exact commands and environmental blockers.
- The checkout is a shared WebDAV workspace with incomplete Git metadata, so do not initialize or reset Git state and do not create a replacement worktree.

## Task 1: Worker Plaid and connection currency handling

1. Add red tests covering EUR/JPY/TND Plaid amount scaling, unknown Plaid currency rejection, and native connection selection of registered non-CAD/CNY currencies plus unknown-code rejection.
2. Update `worker/plaid.ts`, `worker/connection-service.ts`, and the legacy helpers in `worker/index.ts` to use `getCurrencyMeta` and generic registered-currency error copy.
3. Run the focused worker tests and TypeScript checks.

## Task 2: Worker/web production validation boundaries

1. Add red tests for registered and unknown currencies at mobile import, mobile export, mobile review allocation, and ledger-report query boundaries; add import-parser coverage for an explicit non-CAD/CNY default and invalid default.
2. Replace shape-only regex validation in `worker/mobile-import.ts`, `worker/mobile-export.ts`, `worker/mobile-review.ts`, and `worker/ledger-reports.ts` with registry validation.
3. Remove the web parser’s implicit CAD default by allowing an account/consumer-provided registered default currency, and wire the real selected account currency from the app. Validate API report currencies before formatting them.
4. Run focused Vitest tests and TypeScript checks.

## Task 3: Native source/import/review/export boundaries

1. Add red Kotlin tests for registered non-CAD/CNY major-unit scaling and unknown-code rejection in statement import, review money, export filters, source profiles, and alert event money.
2. Update native validation to use `CurrencyRegistry`, including correct minor-unit metadata in statement import and ledger display formatting.
3. Run focused Gradle tests if the repository’s wrapper/runtime is usable; otherwise run available static checks and document the exact blocker.

## Task 4: Verification and audit review

1. Search all touched production paths for remaining CAD/CNY rejection/default logic and shape-only currency validators, excluding fixtures and intentional display-priority copy.
2. Confirm `worker/recurring-store.ts` was not modified.
3. Run the strongest available TypeScript, focused Worker, and native checks; review the final diff semantically and report exact files/tests.

---

## Review Focus

- Registry validation must reject `XYZ` while accepting codes such as `EUR`, `JPY`, and `TND`.
- Major-unit parsing must use metadata (`EUR=2`, `JPY=0`, `TND=3`) rather than a CAD/CNY or default-two-decimal assumption.
- Source notification parsing and Plaid mapping must preserve currency identity and signed minor units.
- No change may touch `worker/recurring-store.ts`.
