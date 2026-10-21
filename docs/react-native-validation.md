# React Native migration acceptance

> **Release policy update — 2026-10-21:** Android 0.2.0 is a normal public
> release. App changes on `main` build, sign, and publish a normal release
> through one workflow. F01–F18 device checks are post-release validation;
> checks requiring bank or WeChat apps do not delay publication.

The implementation branch now selects React Native from the existing
`com.lofuyu.borderledger.MainActivity`; the `.probe` host remains debug-only.
The unsigned production APK is built as `versionCode=1000` / `0.2.0`, contains
the embedded RN bundle and local fonts, and excludes the probe/fixture hosts.
This validation record predates the public release. Current-source Pixel debug
instrumentation and a 412×915 login capture pass, and the live production App
Links file authorizes the expected release certificate. The Pixel debug build
uses a different signer and is not eligible for domain verification. Physical
device upgrade and owner F01–F18 checks remain useful follow-up validation, not
release blockers.

The live `/login-demo` now derives from the first-generated ThreadLoginConcept,
not the superseded simplified migration adaptation: 88 strands ×73 vertices,
original focal band/colors/fonts/copy and compact form, plain wordmark with no
Sparkles/Private, unchecked stay-signed-in. Native-only options retain48dp touch
targets; the native card is about13dp taller while its bottom remains anchored.
Static comparison is evidence for review, not acceptance of every screen.

Current local verification: the latest root web/Worker suite passed 510/510,
root TypeScript passed, and the production Vite build transformed 1,583 modules
successfully. Mobile TypeScript passed, and the latest mobile suite passed
219/219 across 29 files; Codegen and the standalone RN release bundle passed.
Android lint and debug/release assembly passed in a sequential one-worker build.
A fresh callback-inclusive JVM/core rerun passed 323 tests (305 app tests
across 58 suites and 18 shared-core tests across 4 suites), with zero failures
or errors. Pixel instrumentation passed 8/8 tests. The merged-host check
confirms the production launcher and debug-only probe separation. Static
inspection of the
local unsigned APK reports `com.lofuyu.borderledger`, versionCode 1000 / 0.2.0,
min SDK 26 / target SDK 36, `index.android.bundle`, the three local fonts, and
Hermes/React Native/Reanimated/Skia/Worklets/screens/codegen libraries for
arm64-v8a and x86_64. Its SHA-256 is
`10B08C8AC2D6BE54B29449E2A85CE889BE4341AD179F32B2F76FF5EA7345D08D`. This is
an unsigned local artifact, not the signed production release; no device
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

The Android production release signer is SHA-256 fingerprint
5827e817ebad9d478ca2c3c470a3742d783fc7d2bfbffb8cc58219b5f3e68417. This
fingerprint was verified against the owner-provided GitHub keystore certificate.
The Android release workflow and debug-signer guard use this identity. The
Worker response and static App Links file authorize it alongside
the previous production signer during the transition.

The previous validation observed a Samsung installation signed by
1F:F2:A2:5E:39:13:6E:EF:A7:9D:23:CC:75:31:F7:02:B2:A1:62:28:05:38:41:05:09:CA:2F:F6:5B:47:44:ED.
Switching to the GitHub key changes the package signature, so a new APK signed
with this key cannot update that installation. App Links temporarily authorizes
both fingerprints to preserve verified auth callbacks for legacy installs; new
APK artifacts continue to use only the GitHub signing key. Verify a fresh install
and App Links after deploying this configuration.

On the Pixel 10 Pro API 37, the current-source debug install reports its separate
debug signer and domain state 1024; this is expected for a signer mismatch, not
evidence that the production association is wrong. A production-signed build of
this exact source is required for the Pixel Package Manager check.

The Pixel 10 Pro API 37 emulator is currently reachable. Current-source
instrumentation passed, including root recreation and local-font checks; a
visual login capture at 412×915 shows the Thread Field background and readable
form with no React Native bundle-load or fatal log in the inspected window. A
System UI “not responding” prompt appeared once during concurrent Android
builds, cleared after waiting, and was not recorded by `dumpsys activity
lastanr`; a second capture rendered normally. This remains a load-sensitive
observation, not a performance pass. The owner reports that main rulesets and
the signing/publish environments are configured; those controls were not
independently inspected here. No signing secrets were read or used.
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
- Keep signing secrets, explicit-production builds, and main-branch protections.
  Automated build, instrumentation, and signing checks still gate publication;
  device-specific owner acceptance happens after release.

React Native is the production launcher. Retain Android services, background
workers, native secret ownership, binary codecs, and the installed signing
identity while iterating on post-release findings.
