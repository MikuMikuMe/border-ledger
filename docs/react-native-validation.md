# React Native migration acceptance

The implementation branch now selects React Native from the existing
`com.lofuyu.borderledger.MainActivity`; the `.probe` host remains debug-only.
The unsigned production APK is built as `versionCode=1000` / `0.2.0`, contains
the embedded RN bundle and local fonts, and excludes the probe/fixture hosts.
This is still a **candidate, not an accepted production release**: live Pixel
verification after the session-state fix, the real-device data-preserving
upgrade, and protected signing/promotion remain open. No signing identity may be
invented to close those gates.

The live `/login-demo` now derives from the first-generated ThreadLoginConcept,
not the superseded simplified migration adaptation: 88 strands ×73 vertices,
original focal band/colors/fonts/copy and compact form, plain wordmark with no
Sparkles/Private, unchecked stay-signed-in. Native-only options retain48dp touch
targets; the native card is about13dp taller while its bottom remains anchored.
Static comparison is evidence for review, not acceptance of every screen.

Current local verification: the latest uninstrumented root web/Worker run passed
484/484, root TypeScript passed, and the production Vite build transformed
1,583 modules successfully; the focused preferences/D1 route passed 6/6
after a clean install. Mobile TypeScript, Codegen, all 210 mobile tests, and the
standalone RN release bundle pass after a clean mobile install. Android lint and
debug/release assembly passed in a sequential one-worker build. A forced fresh
run of `:app:testDebugUnitTest` and `:sharedCore:testAndroidHostTest` passed
296/296 tests across 53 XML suites. The merged-host check confirms the
production launcher and debug-only probe separation. Static inspection of the
local unsigned APK reports `com.lofuyu.borderledger`, versionCode 1000 / 0.2.0,
min SDK 26 / target SDK 36, `index.android.bundle`, the three local fonts, and
Hermes/React Native/Reanimated/Skia/Worklets/screens/codegen libraries for
arm64-v8a and x86_64. Its SHA-256 is
`10B08C8AC2D6BE54B29449E2A85CE889BE4341AD179F32B2F76FF5EA7345D08D`. This is
an unsigned local artifact, not the reviewed-SHA signed candidate; no device
startup or in-place upgrade is implied. The production Worker workflow now
allows `workflow_dispatch` only from `main`; dispatching from this feature
branch would otherwise replace Worker and web assets and apply remote D1
migrations before the planned branch review.

An earlier full root run failed 482/483 in the stale-revision preferences test
with an intermittent Miniflare/Undici `bad port`; the isolated preferences/D1
route passed 6/6, and a later uninstrumented full root run passed 483/483. A
diagnostic full run also passed. The historical trace did not capture the
request URL, so the exact cause remains unconfirmed. No retry or suppression
was added.

Mobile `npm audit --omit=dev` reports 24 high-severity dependency-chain alerts
rooted in `braces@3.0.3` through Metro/React Native CLI (affected range
`<=3.0.3`). The registry reported 3.0.3 as latest at the time checked. The
generated application JS bundle contains none of `braces`, `micromatch`, or
`fast-glob`; this remains a build-tool dependency risk. npm's forced fix
attempts a major Skia downgrade, so no forced dependency change was applied.

The first Android release rebuild also had a one-off CMake/Ninja `-t recompact`
`Permission denied` while configuring `react-native-screens` x86_64, after
compiler ABI compile/link succeeded. D: is healthy NTFS with normal modify ACLs
and no competing Gradle build was found. The exact configure then passed
single-worker, and the complete Android gates plus fresh JVM/core tests passed.
No ACL or source workaround was applied; transient root cause is unconfirmed.

The Samsung currently has `versionCode=921` / `0.1.921`; pulling only its APK
confirmed the installed signer is SHA-256
`1ff2a25e39136eefa79d23cc7531f702b2a162280538410509ca2ff65b4744ed`, matching
the app-link record and candidate checks. The phone has not been installed,
uninstalled, cleared, or updated.

Cloudflare Access has the exact public overrides for
`/.well-known/assetlinks.json` and `/api/mobile/v1/*`; the old `/` and
`/assets/*` overrides and both existing policies/settings were preserved. A
live unauthenticated mobile-status request reaches Worker bearer auth and
returns its expected `401`. Until the branch’s Worker code is deployed, the
live asset-links request still returns the previous SPA HTML, not association
JSON; the deployment workflow now checks both paths and the release signer.

The Pixel 10 emulator stopped answering both ADB shell and its own console
after the QA package update; current visual confirmation is not claimed. A
non-wiping restart was requested. The GitHub repository has the four Android
signing secrets at repository scope, no `android-production-signing` or
`android-production-publish` environments, and `main.protected=false`.
Environment approver/secret relocation and PR protection are required before
signing or publication. The Worker workflow's main-ref guard does not prevent a
direct, unreviewed push to an unprotected `main`.
Canonical debug/emulator live rendering is severely CPU-bound: a15s post-bulk
trace recorded62 main-thread animation slices averaging236.7ms (main≈96.9% of
one core). Geometry-preserving batching leaves static pixels unchanged, but
does not close motion parity. Controlled shadow/grain/blend/frozen isolation
was reverted byte-for-byte; no visual simplification was landed. SurfaceView
animation is not sampled by host HWUI gfxinfo, so zero HWUI frames is not a pass.
Exact entrance-motion matching, full TalkBack, real provider/SAF, production
session/App Link, signed upgrade and actual macOS framework links remain open.

## Repeatable checks

Install both independent npm graphs (`npm ci` at root and in `mobile/`). Use
Node 24, Java 17, the pinned Android SDK/toolchain, and D-drive caches/build
outputs on the Windows workstation. `npm test` in `mobile/` runs the mobile
controller/view/auth/geometry contracts using root Vitest tooling; it changes
neither package's React resolution.

```powershell
npm test
npm run typecheck
npm --prefix mobile run typecheck
npm --prefix mobile test
npm --prefix mobile run codegen
npm --prefix mobile run bundle:release
android/gradlew.bat -p android :app:lintDebug :app:testDebugUnitTest :sharedCore:testAndroidHostTest :app:connectedDebugAndroidTest --no-daemon
android/gradlew.bat -p android :app:assembleRelease -PmobileEnvironment=production --no-daemon
android/react-native-host-check.ps1 -Merged
```

Android instrumentation checks actual Android font selection and independently
measured glyph widths. It targets only the `.probe` package. Synthetic captures
require a signed-out debug host, Metro, and an explicitly selected emulator:

```powershell
node scripts/capture-native-parity.cjs D:/Android-Studio/Install-SDK/platform-tools/adb.exe .tmp/native-parity emulator-5554
```

The capture script uses only debug fixture hosts, records light/dark PNGs and UI
trees, and calls no auth or financial mutation. Fixture globals are excluded
from release bundling. Generated captures are evidence to inspect, not automatic
parity approvals. Compare the approved `/login-demo` at 412×915, device scale 3,
local fonts loaded, reduced-motion phase 1.8, then record live native motion.
Account for real Android system-bar insets rather than adding fake bars to RN.

The Android CI workflow installs mobile dependencies, runs Codegen, mobile
tests, types, standalone JS bundle, app/shared tests, lint, unsigned production
release assembly and merged launcher assertions. A separate emulator job runs
instrumentation. The `macos-26` job explicitly requires Xcode 26.4.1, compiles
both iOS targets, links both frameworks and requires actual framework binaries
before uploading them. A Windows KLIB compile or skipped link never closes that
gate. No CI run is implied by authoring this configuration.

## F01–F18 gate ledger

All rows require owner acceptance before cutover. The contract checks below are
partial synthetic evidence, not completion of the native acceptance boundary
in `android-validation.md`.

| Gate | Automated contract evidence | Remaining acceptance |
|---|---|---|
| F01 login/session | auth model/coordinator, native session/core lifecycle suites | Successful production browser sign-in, verified App Link, preserved installed session and sign-out |
| F02 totals/lenses | finance model/controller/views and report/financial fixtures | Same synthetic web/native screen comparison accepted |
| F03 charts/ranges | finance view accessible text/table and report fixtures | Complete large-text/TalkBack/chart screen comparison |
| F04 activity/edit | controller revision/recovery/facet and view contracts | Full signed-in edit/conflict device flow on test data |
| F05 export | tools controller/views and native export repository | Actual SAF Save/Share cancellation/failure/filtered/full output |
| F06 import/picker | native parser/import and tools contracts | Actual SAF picker, account mapping and interruption flow |
| F07 commit/recovery | journal ownership/no-replay and import parser regression | Durable device flow with synthetic service, receipt and process death |
| F08 accounts | details controller/views and native account repositories | Full metadata/freshness screen comparison |
| F09 Plaid | native callback claim/recreation fences and details contracts | Live provider approval/cancel/selection on permitted test service |
| F10 sync/disconnect | native account and durable-operation contracts | Provider revoke/cancel and history-preservation flow |
| F11 recurring list | filters/paging/state views/controllers | All deterministic screen comparisons accepted |
| F12 recurring estimates | per-currency summary/financial rules | Expected/actual/exclusion device comparison |
| F13 recurring detail | detail/history/classification/conflict recovery | Full device classification/history flow on test data |
| F14 preferences | native settings/reporting and tools contracts | Shared preference round trip on both clients |
| F15 help/review | review/details/auth/About contracts | Complete reachable-page/TalkBack acceptance |
| F16 public preview | labeled isolated fixture hosts and demo | Public introduction/representative preview accepted |
| F17 common semantics | complete root Worker/parser/currency/storage fixtures | Cross-client acceptance and all root checks green |
| F18 motion/capture | shared geometry/phase, native capture/outbox/auth suites | Full accessibility, release performance, capture/offline device acceptance |

## Hard cutover and publication gates

- Every production screen and adverse state must have accepted comparison
  evidence, including TalkBack, 200% text, IME, safe areas and reduced motion.
- `https://pf.lofuyu.com/.well-known/assetlinks.json` must serve valid Android
  association JSON for the actual package/certificate; explicit component
  callback invocation does not prove App Link verification.
- An existing, populated, signed production installation and a higher-version
  artifact signed with the existing owner-controlled key are required. Install
  with `adb install -r`, never uninstall; verify encrypted records, preferences,
  queues/event times and valid production session before/after. Synthetic binary
  codec goldens and `.probe` updates do not substitute for this evidence.
- macOS 26/Xcode 26.4.1 framework compile/link must actually run successfully.
- Measure release startup, frames, memory stability and APK-size delta against
  the prior signed artifact. Metro/debug/emulator timing is diagnostic only.
- Keep the existing signing-secret, explicit-production and protected-release
  workflow gates. A missing secret, failed check or unverified acceptance gate
  stops release; never publish/push to shared `main` to test a workflow.

React Native is already the launcher in this candidate branch. Do not publish
or remove remaining Compose presentation dependencies until the evidence above
is accepted; retain Android services, background workers, native secret
ownership, binary codecs, and the installed signing identity.
