# Task 12 report — native statement import, durable commit and CSV export

Status: complete with concern.

Implemented owner-authorized staged import previews, bounded chunks, canonical row/file identities, durable duplicate candidates and explicit `resolve`/`keep_separate` decisions, plus the final publication barrier. Staged data stays out of reports until commit; retries and session expiry retain the same operation identity. Native import/export code uses bounded document reads, complete filtered/all-record CSV export, safe text quoting and registry-backed currency scale validation. Unsupported or unverified formats remain visible as review rather than becoming a fake successful import.

Evidence:

- The changed-path Vitest suite passed 7 files / 55 tests, including `mobile-import-export-task12.test.ts`.
- The alert/recurring/auth/settings regression suite passed 13 files / 62 tests.
- Direct TypeScript project check passed.
- Android Gradle/Kotlin tests, real BOC export samples, Pixel document-picker and Save/Share verification remain unavailable.

No commit was recorded because the mounted workspace has no writable Git metadata.
