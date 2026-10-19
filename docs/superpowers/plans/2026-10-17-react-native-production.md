# React Native Android production release

## Baseline and recovery

- [x] Clone authenticated `main` into a persistent D-drive checkout and preserve the original orphan migration tree.
- [x] Carry the reviewed React Native migration snapshot onto current `main`; review diffs and preserve production backend fixes.
- [x] Install from the checked-in lockfiles and record a clean validation baseline.

## Production app entry

- [x] Promote the React Native host to the production `.MainActivity` while retaining the debug-only probe and fixture tools.
- [x] Register TurboModules and local fonts in release; initialize React Native only when the UI starts so workers stay headless.
- [x] Keep the established package/application ID, owner storage formats, device identity, notification listener and worker behavior.
- [x] Restore the approved logo as the Android launcher icon and retain the existing appearance tokens.
- [x] Remove superseded Compose presentation code and dependencies only where no shared native model or repository still depends on them; the user explicitly authorized deleting the disconnected Compose screens. Kotlin models, auth/session, repositories, storage, workers, and debug-only probe code remain outside this deletion.

## Authentication and production routing

- [x] Add a direct `/.well-known/assetlinks.json` response with the production package and verified release certificate; preserve normal SPA routing elsewhere.
- [x] Add exact Cloudflare Access public overrides for only the asset-links file and `/api/mobile/v1/*`; preserve browser OAuth, web APIs, policies, Plaid webhook, and the Worker authorization checks.
- [ ] Deploy and verify these routing prerequisites before production sign-in.
- [ ] Verify the app-link signing certificate matches the retained Samsung installation before an in-place upgrade.

## Candidate build and acceptance

- [x] Replace run-number versions with checked-in release identity `versionCode=1000`, `versionName=0.2.0`; stop if the installed/published maximum is higher.
- [ ] Build a production candidate from an explicit reviewed source SHA. Build/test code without signing secrets; use a main-branch-controlled signing job that consumes only the unsigned APK and never checks out candidate code.
- [ ] Sign with the existing CI key, verify package/version/environment/manifest/certificate, and create an unpublished draft release with APK, SHA-256, and candidate manifest.
- [ ] Pass root web/Worker, mobile TypeScript/tests/Codegen, Android lint/unit/instrumentation/release gates. Diagnose the intermittent Miniflare `bad port` failure without suppressing or retrying it away.
- [ ] Verify release startup without Metro, production bundle and native modules, debug-tool exclusion, and the canonical Thread Field at 412×915 on Pixel 10.
- [ ] Exercise F01–F18, authentication/callback/lifecycle/revision/offline/background/file/Plaid/appearance/accessibility flows with fixtures for mutations.
- [ ] Upgrade the already-installed Samsung build in place with the same signer; verify encrypted records, preferences, device identity, outbox and production session remain readable before fresh browser sign-in checks.
- [ ] Record redacted, objective evidence bound to candidate SHA and APK hash; only CPU optimization and iOS packaging are deferred.

## Promotion

- [ ] Complete a fresh whole-branch review, fix all findings, and rerun gates affected by changes.
- [ ] Merge the exact candidate tree to `main` and verify the deployed main tree matches the tested source.
- [ ] Promote the accepted draft release without rebuilding or replacing its APK bytes; verify published checksum/source/environment and installed React Native UI.
- [ ] Keep the previous same-signer production APK as a private rollback artifact; rollback builds use a strictly higher version code.

## Explicit deferrals

- CPU tuning is deferred as authorized; runtime crashes, ANRs, unresponsive input and broken background rendering still fail acceptance.
- iOS app packaging is deferred. The Kotlin core remains portable and its iOS targets stay in CI.
