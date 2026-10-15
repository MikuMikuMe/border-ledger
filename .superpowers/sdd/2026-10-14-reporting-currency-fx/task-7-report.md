# Task 7 report — app-only CI trigger

Status: COMPLETE

## Delivered

- Added `.github/workflows/app-build.yml` with `push` and `pull_request` path filters for `android/**`, `src/**`, `contracts/**`, the web build inputs, public assets, and the workflow itself.
- Kept backend-only paths such as `worker/**`, `wrangler.jsonc`, and worker tests outside the app workflow allowlist.
- Added a web typecheck/build job and an Android lint/unit-test job.
- Added an explicit Android toolchain availability gate. The checked-in wrapper script and wrapper JAR are present, so the Android job is enabled; if a checkout ever lacks the wrapper JAR, the gated job reports that Android validation was not claimed instead of silently passing.
- The workflow has `contents: read` only and contains no signing secrets or release-APK claim.

## Verification

- `npx vitest run tests/workflow-paths.test.ts --pool=threads --maxWorkers=1 --testTimeout=15000 --reporter=verbose` — 2/2 passed.
- The workflow-path contract test asserts every representative app-owned path matches and every representative backend-only path does not match.
- `android/gradlew.bat` and `android/gradle/wrapper/gradle-wrapper.jar` both exist in the workspace, so the GitHub Android checks are not expected to be gated in CI.
- Local full suite after the fixture repair: 54 files, 289 tests passed.

## Boundary

The mapped checkout exposes an incomplete `.git` directory, so no remote GitHub Actions run or commit is claimed here. The workflow and its path contract are statically verified in the working tree.
