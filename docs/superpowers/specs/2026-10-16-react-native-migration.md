# Border Ledger React Native Migration Specification

This is the active native migration specification. It supersedes any earlier WebView proposal for this app. The existing web client remains a separate React 18 application; the Android production UI will become React Native after all production screens reach parity.

## Product outcome

Deliver Border Ledger for Android with React Native native components, Hermes and Fabric, preserving the existing app's features, logo, light/dark/system theme, backend contracts, authentication behavior, and encrypted on-device records. Prepare a shared Kotlin Multiplatform core for a later iOS app. Do not package an iOS app in this migration.

The app explicitly uses production financial data at `https://pf.lofuyu.com`. Release/deploy work targets the existing `border-ledger` Worker with production D1 `border-ledger` (`14378887-f604-4d04-95f1-26930405b5a8`) and Queue `border-ledger-sync`. Do not create or deploy a shadow `border-ledger-production` Worker. Sandbox credentials are segregated and require fresh production sign-in; sandbox records do not migrate into production.

## Repository and package boundaries

- Seed the D-drive migration branch from recovery commit `017d9f61439b389cc2a16d71002fe4888a3d0f81`, then reconcile authenticated remote `main` before feature implementation.
- Keep `mobile/` as a separate React Native Community CLI package and lockfile. Do not hoist its React 19 dependencies into the existing React 18 web package.
- Keep Android SDK, emulator, npm/Gradle caches, temporary files, and Android build output on D.
- Keep the existing backend DTOs, Worker, Cloudflare configuration, and financial API contracts unchanged except for migration CI/release integration.
- Keep Android background capture, notifications, and upload workers operational without starting JavaScript or React Native.

## Pinned mobile toolchain

- React Native 0.87.1, React 19.2.3, Hermes, Fabric, and Community CLI.
- Reanimated 4.7.1, Worklets 0.13.0, Shopify Skia 2.14.0, and Uniwind 1.12.2.
- Use React Native Reusables for shadcn-style source components, adapted to existing Border Ledger tokens. Do not apply a new visual preset.
- Gradle 9.4.1, AGP 9.2.1 with built-in Kotlin, Kotlin 2.4.21, Java 17, Node 24, compile SDK 37, target SDK 36, min SDK 26.
- Keep the application ID `com.lofuyu.borderledger`, release signing identity, callback scheme/host/path, and existing Android services.

## Shared Kotlin core

Create `shared/core/`, registered as `:sharedCore`, targeting Android, `iosArm64`, and `iosSimulatorArm64`. Move portable models, repository orchestration, financial rules, and session state into common code. Inject interfaces for HTTP, secure storage, cryptography, clocks, browser launch, and files. Keep Android-only capture and device integrations in Android adapters.

Preserve installed records byte-for-byte: retain the existing binary storage codecs, record names, encryption keys, preferences, device identity, and outbox formats. Portable serialization is for shared API models only and must not replace persisted Android blobs. Android adapters own Android URI, keystore, file, browser, Plaid, notification, and WorkManager behavior.

## Native bridge contract

Generate typed TurboModules for session, ledger, recurring, review, accounts, capture/devices, files, and preferences. Map existing repository operations and outcomes directly. Use promises for requests and typed events for state changes, publish an initial snapshot, and refresh after resume.

Transfer monetary minor units as decimal strings and timestamps as ISO strings. Keep backend DTOs unchanged. Credentials, PKCE material, capture secrets, and authorization tokens stay inside the native core, never JavaScript or AsyncStorage. Stream files natively instead of passing whole documents or exports through JavaScript.

Browser sign-in, App Link verification, the unchecked “Stay signed in” default, retry/cancellation states, and pending-destination behavior remain intact. Persist recoverable external-operation identifiers and reconcile after Activity recreation. Completing a lost JavaScript promise must never replay a financial write.

## Login and theme

Preserve the current Border Ledger palette and typography. Remove the rejected star and Private badge. Use real Android system bars.

Extract the approved original Threads geometry into a DOM-free source shared by the web demo and native renderer. Render the Android background with Skia and Reanimated using the original 88 strands, speed `0.58`, curve equations, colors, and selective glow; use deterministic phase `1.8` for reduced motion and visual comparisons. Pause rendering when hidden or backgrounded. Bundle the existing DM Sans and Newsreader fonts locally; do not substitute them.

## Screen migration order

1. Login, About, authentication navigation, and the main app shell.
2. Overview/reports, Activity, Recurring and details, Review, Accounts, and bank connections.
3. Capture onboarding, Devices, Settings, Import, and Export.

Port existing behaviors and states, including loading, empty, locked, offline, error, cancellation, and retry states. Do not use production fake data. Probe and fixture tools remain debug-only and are excluded from release builds.

## Verification and cutover

- Establish web/Worker and Android baselines before implementation; resolve migration-owned failures.
- Exercise the existing F01–F18 feature matrix, financial/parser fixtures, revisions, offline queues, and authorization boundaries against the shared core.
- Test browser callbacks, duplicate returns, concurrent session refresh, sign-out, Activity recreation, process death, Plaid cancellation, document cancellation, and export failures.
- Verify an in-place signed upgrade preserves encrypted records, preferences, queued events, and valid production sessions. Never require uninstalling the existing app.
- Compare every migrated screen with deterministic fixtures. Verify Threads against the original demo at a fixed phase, then inspect live motion on Pixel 10 and at 412×915.
- Check TalkBack, larger text, reduced motion, safe areas, keyboard handling, and background/resume behavior. Measure release startup, frame timing, memory stability, and APK-size changes.
- Add a macOS 26 CI job using Xcode 26.4.1 to compile `iosArm64` and `iosSimulatorArm64` core targets and link the simulator framework.
- Keep web/Worker validation running. Extend Android CI to install mobile dependencies, run Codegen and mobile tests, bundle JavaScript, and build a release that starts without Metro.
- Keep Compose in production until every screen has parity; then switch the application entry to React Native and remove the replaced production Compose UI.
- Publish the signed APK and checksum through the existing GitHub Release workflow only after production authentication and upgrade checks pass. Use fixtures or sandbox services for mutating integration tests; production checks are connectivity and sign-in only.

## Global constraints

- Preserve existing backend contracts, financial calculations, capture limitations, application ID, callback identity, release signing identity, theme, logo, and in-place upgrade behavior.
- Production mobile environment is explicitly `production` and uses `https://pf.lofuyu.com`.
- Never copy Sandbox credentials or records into production. Sandbox credentials require a fresh production sign-in.
- Preserve the exact existing persisted Android storage formats and keep capture/upload/background services independent of React Native startup.
- No WebView. All production app UI is native React Native.
- Missing signing credentials or a failed production release gate stops publication; do not bypass a gate or expand Cloudflare Access.
