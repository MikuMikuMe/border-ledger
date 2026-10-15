# Task 7 — App-only GitHub build triggers

Read the design and plan before editing. Own only:

- `.github/workflows/app-build.yml` (create or extend)
- `.github/workflows/ci.yml`
- `.github/workflows/android-ci.yml`
- a workflow path assertion test/script and its test file if needed

The checkout is shared: do not revert unrelated edits, do not touch product code/provider/schema/Android source, do not spawn subagents, and do not commit because the mapped checkout has no usable Git object database.

Requirements:

- General backend verification may remain separate, but the app-build workflow runs web typecheck/build and Android lint/unit tests on `push`, `pull_request`, and `workflow_dispatch`.
- The exhaustive app path allowlist is exactly: `android/**`, `src/**`, `index.html`, `contracts/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `public/**`, and the app-build workflow itself. Include any existing app workflow file that is intentionally part of app validation only if it does not broaden backend-only matching.
- Representative backend-only changes (`worker/**`, `wrangler.jsonc`, backend-only tests) must not match the app workflow. App changes must match it. Do not add signing secrets or claim a production APK.
- Keep least-privilege workflow permissions and offline deterministic tests.

Write a failing static/path assertion first, then update YAML and make the assertion pass. Run YAML/static checks available locally and inspect all three workflows. Write `.superpowers/sdd/2026-10-14-reporting-currency-fx/task-7-report.md` with files changed, exact commands/output, and concerns. Return only status/report path/test summary/concerns.
