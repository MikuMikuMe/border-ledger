# Lunch Flow Implementation Plan

> For agentic workers: Use superpowers:subagent-driven-development. Read the spec before implementing.

Goal: Verified RBC transactions in web and Android, deployed to main.
Architecture: Server-only Personal API adapter, additive selection mappings, first-class source provenance, existing owner authentication, manual and daily queued sync.
Tech Stack: TypeScript/React/React Native, Kotlin, Cloudflare Workers/D1/Queues.
Spec: docs/superpowers/specs/2026-10-22-lunchflow-design.md

## Global Constraints
- No secrets or real financial rows in source/tests/logs. No Plaid token/table overloading.
- Preserve existing data, currency/sign semantics, explicit selection and native owner auth.
- Follow CodeScene gates in AGENTS.md and use test-first verification.

## Review Focus
- Migration retains all dependent FK/cascade data and indexes.
- Partial/error provider responses never erase history or advance last success.
- Selection changes fence delayed queue writes and mobile replay.
- Repeat sync and pending-to-posted changes do not double count.
- Both client surfaces expose failures without requiring provider secrets.

## Tasks
- [x] 1. Migration/source types: add tested lunchflow source and additive mappings; preserve every existing dependent row.
- [x] 2. Provider/backend: adapter, shared service, authenticated routes, durable sync scheduling, source labels/filters, meaningful tests.
- [x] 3. Website: account discovery/selection/refresh UI and accurate source display; rendering and behavior tests.
- [x] 4. Native: bearer-backed bridge operations and mobile account selection/refresh UI; contract/decoder/operation tests.
- [ ] 5. Verify, independently review, CodeScene gates, PR/main merge, terminal CI/deploy/release, production data/idempotency smoke.

## Progress
- Live Lunch Flow destination created and two RBC spending accounts enabled.
- Direct authenticated API verified 117 chequing + 43 Visa rows; no raw financial fixtures saved.
- LUNCHFLOW_API_KEY installed in production Worker; only secret name verified.
- Branch feat/lunch-flow-rbc created from origin/main 6e7f8a0. Untracked local Android files preserved.
