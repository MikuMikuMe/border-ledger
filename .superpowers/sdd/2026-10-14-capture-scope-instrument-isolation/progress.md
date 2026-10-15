# SDD ledger — plan: docs/superpowers/plans/2026-10-14-capture-scope-instrument-isolation.md

Pre-flight: the relevant interfaces are the persisted `device_source_scopes` tuple, `CaptureScopeRecord`, and the alert-ingestion resolver/recheck; Task 2 consumes Task 1's hint-aware record.

Ruling: work inline in the shared checkout — the user explicitly scoped the owned files and required direct edits, while this environment exposes no usable Git worktree metadata.
