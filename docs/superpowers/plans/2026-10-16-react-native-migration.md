# React Native Migration Execution Plan

Spec: [2026-10-16-react-native-migration.md](../specs/2026-10-16-react-native-migration.md)

The migration starts from recovery commit `017d9f61439b389cc2a16d71002fe4888a3d0f81`, reconciled with authenticated remote `main`. Work is on the D-drive branch `codex/react-native-migration`.

## Global constraints

- Follow the active specification above. Keep mobile dependencies isolated in `mobile/` and preserve the separate React 18 web package.
- Preserve the current brand, logo, light/dark/system tokens, login behavior, production session, backend contracts, Android services, release signing identity, and binary persisted formats.
- Use the pinned versions and D-drive Android SDK, emulator, caches, temp paths, and build outputs from the spec.
- Production environment is explicitly `production` at `https://pf.lofuyu.com`. Do not mix Sandbox sessions or records into production.
- Keep production Compose until all React Native screens pass parity and in-place upgrade gates. The debug launcher may exercise the React Native host during migration.
- Native credentials, PKCE, and capture secrets never cross into JavaScript storage. Do not replay a financial mutation after losing a JS promise.
- Use test-first changes for behavior. Review each task before proceeding. Do not publish or push to shared `main` until all release gates pass.

## Task 1: React Native Android foundation

Create the isolated `mobile/` Community CLI package, lockfile, Hermes/Fabric setup, Codegen configuration, React Navigation, Reanimated/Worklets, Skia, Uniwind, and React Native Reusables source setup. Keep the root web dependency graph independent. Upgrade the Android host to the pinned Gradle/AGP/Kotlin/JDK/SDK versions, migrate the Android build to AGP built-in Kotlin, and add a debug-only React Native launcher while preserving the current production Compose launcher and callback activity. Set the normal debug launch to React Native and route App Links through the existing native callback path.

Tests: clean mobile `npm ci`; Codegen; TypeScript; Android debug assemble/install on D SDK; debug manifest and release manifest assertions; release JS bundle succeeds without Metro.

Produces: isolated React Native app, native host boundary, generated module build path, debug launcher and mobile CI entry points.

## Task 2: Kotlin Multiplatform shared core

Add `shared/core/` as `:sharedCore` with Android, `iosArm64`, and `iosSimulatorArm64` targets. Extract portable models, orchestration, financial rules, and session state; inject HTTP, secure storage, crypto, clock, browser, and file ports. Keep Android adapters for keystore, URI, notification, browser, Plaid, filesystem, and background work. Preserve current Android binary codecs, record names, keys, preferences, device identity, and queue formats with golden compatibility fixtures.

Tests: common unit tests for domain/session rules; Android adapter codec round-trip and legacy byte-fixture tests; Android app compile; `:sharedCore:compileKotlinIosArm64` and `:sharedCore:compileKotlinIosSimulatorArm64`.

Produces: stable common-core interfaces and shared domain contract consumed by Task 3.

## Task 3: Typed native service bridge

Generate typed TurboModules for session, ledger, recurring, review, accounts, capture/devices, files, and preferences. Connect them to the existing `AppContainer` and shared core without moving secrets into JS. Use decimal strings for minor units, ISO timestamps, request promises, typed state events, initial snapshots, and resume refresh. Add native reconciliation for persisted external operations, browser callback outcomes, cancellation, and Activity recreation; never replay writes.

Tests: Codegen and Android compilation; module contract/unit tests for each operation group; event snapshot and resume refresh; duplicate callback/session refresh/sign-out/recreation tests; lost-promise financial write idempotency.

Produces: typed module APIs consumed by Tasks 4–7.

## Task 4: Login, authentication, About, and app shell

Port login and authentication navigation to React Native while preserving browser sign-in, App Links, pending destinations, unchecked stay-signed-in default, retries, cancellation, and production session behavior. Port About and the primary app shell. Extract pure Threads geometry from the approved mounted web concept into a DOM-free shared source used by the web demo and RN Skia renderer. Preserve 88 strands, speed `0.58`, original equations/colors/selective glow, reduced-motion phase `1.8`, pause/resume, local DM Sans/Newsreader fonts, system bars, and the existing theme. Remove the star and Private badge.

Tests: login/auth state tests; native callback and destination tests; web demo and Skia geometry tests against fixed samples; 412×915 layout; Pixel 10 callback and login verification; reduced-motion and background/resume checks.

Produces: native authentication entry and shell consumed by Tasks 5–7.

## Task 5: Overview, reports, Activity, and Recurring

Port Overview, reporting queries/charts, Activity filters and detail, and Recurring list/actions to native components using the typed bridge and current design tokens. Preserve ordering, currency display, revisions, empty/loading/offline/error states, and existing feature behavior.

Tests: screen model/unit tests; deterministic fixtures for every view state; F01–F18 coverage for migrated behaviors; accessibility checks for labels, focus, text size, and TalkBack.

Produces: primary financial screens consumed alongside Task 6.

## Task 6: Recurring detail, Review, Accounts, and bank connections

Port recurring details, review queue and decisions, account details, bank connections, Plaid linking, cancellation, and connection errors. Reuse existing native Plaid SDK/coordinator through a typed native boundary. Preserve backend DTOs, authorization checks, revision handling, and no-replay guarantees.

Tests: fixture-driven review/recurring/account tests; Plaid success/cancel/error flows; authorization and revision tests; deterministic mobile layout and accessibility checks.

Produces: second-stage financial screens consumed by Task 8 parity gate.

## Task 7: Capture, Devices, Settings, Import, and Export

Port capture onboarding, Devices, Settings, statement/document Import, and Export. Keep notification capture and upload workers operational with no React Native runtime. Use native file streams/pickers and preserve cancellation, parse/preview/review, export failures, and preferences.

Tests: capture permission/device tests; document cancellation and import parser fixtures; export error/stream tests; settings persistence/theme tests; background service operation without RN startup; accessibility and larger-text checks.

Produces: final production screen set for Task 8 cutover.

## Task 8: Full parity, CI, and production cutover

Add mobile CI for install, Codegen, tests, bundle, and Android release. Add macOS 26/Xcode 26.4.1 CI to compile/link both iOS core targets. Run the F01–F18 matrix, parser/financial fixtures, offline queues, authorization boundaries, lifecycle cases, deterministic screen comparisons, Pixel 10 412×915 checks, accessibility, reduced motion, and performance measurements. Deliberately iterate the native login against the original approved Thread Field login demo on the Pixel 10 at 412×915: capture fixed-phase and live-motion renders, correct concrete visual mismatches between iterations, and repeat until no material layout, artwork, readability, or motion mismatch remains. Preserve the original brand, fonts, thread geometry, and no-star/no-Private treatment. Verify an in-place signed upgrade retains production records/preferences/queues/session without uninstall. Only after every production screen passes parity, make React Native the release launcher and remove replaced production Compose UI while retaining non-UI Android adapters and background work.

Tests: complete root web/Worker suite; mobile unit and Android instrumentation; release bundle without Metro; in-place upgrade evidence; macOS KMP compile/link.

Produces: release-ready React Native Android app and cutover evidence.

## Task 9: Production release gate

Verify production connectivity and sign-in against the live `border-ledger` Worker and production database without mutating live financial data. Verify the signed in-place upgrade, manifest/application identity, production environment, callback routing, APK signature, checksum, and existing GitHub Release workflow inputs. Publish the signed APK and checksum only when all gates pass.

Tests/evidence: production read-only health/sign-in; signed upgrade without uninstall; APK signature and SHA-256; GitHub release artifact confirmation. Missing credentials or any failed gate means stop before publication.

## Review focus

- No JavaScript path can retrieve, persist, or log auth/capture secrets.
- No changed binary codec, encryption key, record name, or device identity can strand installed data.
- No callback, Activity recreation, lost promise, process death, or cancellation can duplicate a financial mutation.
- No release can select Sandbox, change application ID/signing identity, or target a shadow Worker/database.
- No React Native screen silently substitutes fake production data or drops existing user-visible states/actions.
- The original thread geometry remains deterministic and equivalent in the web demo and Skia renderer.
