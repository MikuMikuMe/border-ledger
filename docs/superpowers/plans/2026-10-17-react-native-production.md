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
- [ ] Deploy and verify the GitHub signing-key certificate with App Links and a fresh Android install.

## Normal release and post-release validation

- [x] Build, sign, and publish Android 0.2.0 as a normal public release from main.
- [x] Trigger automatic releases for application changes; backend-only changes do not trigger an APK release.
- [x] Keep the release workflow on one path from app-change detection through public release.
- [ ] Install the published APK on Pixel 10 and record any issues for the next iteration.
- [ ] Complete F01–F18 checks that apply after installation. Bank/WeChat-dependent checks may remain pending and do not block publication.
## Explicit deferrals

- CPU tuning is deferred as authorized; runtime crashes, ANRs, unresponsive input and broken background rendering still fail acceptance.
- iOS app packaging is deferred. The Kotlin core remains portable and its iOS targets stay in CI.
