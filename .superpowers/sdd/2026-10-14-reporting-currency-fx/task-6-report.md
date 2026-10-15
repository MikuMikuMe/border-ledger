# Task 6 report

## Status

`IMPLEMENTATION COMPLETE; USB VISUAL QA COMPLETE`

Android now carries a nullable reporting target independently from the source-currency filter, validates the additive report contract through the shared currency registry and safe monetary integer bounds, exposes the target in Settings, presents converted totals/daily values with source audit lanes and the server-provided Chinese-bank band, and includes a debug-only credential-free `FX_REPORT_PREVIEW` activity.

## Files changed

- `android/app/src/main/java/com/lofuyu/borderledger/api/OwnerLedgerApi.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerSnapshot.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/settings/SettingsScreen.kt`
- `android/app/src/main/java/com/lofuyu/borderledger/ui/settings/ReportingPreferencesRepository.kt`
- `android/app/src/debug/AndroidManifest.xml`
- `android/app/src/debug/java/com/lofuyu/borderledger/debug/FxReportPreviewActivity.kt`
- `android/app/src/debug/java/com/lofuyu/borderledger/debug/FxReportPreviewFixture.kt`
- focused Android unit tests under `android/app/src/test/java`

## Verification

Commands were run from a `cmd.exe` `pushd Z:\Projects\Personal-Finance\android` context to avoid the mapped UNC working-directory limitation, using Java 21 and Gradle 8.13 from the installed local tooling.

```text
gradle :app:testDebugUnitTest --console=plain --no-daemon
```

Result: exit code 0; 208 tests completed successfully.

```text
gradle :app:lintDebug :app:assembleRelease --console=plain --no-daemon
```

Result: exit code 0; lint and unsigned release assembly succeeded. The release APK was produced under `android/app/build/outputs/apk/release/`. The toolchain emitted existing SDK XML-version and Android analytics-permission warnings, plus normal deprecated API warnings; none failed the build.

Debug-only physical install evidence:

```text
gradle :app:assembleDebug --console=plain --no-daemon
adb -s R5CR119NQ7A install -r border-ledger-debug.apk
adb -s R5CR119NQ7A shell cmd package resolve-activity --brief com.lofuyu.borderledger.probe
adb -s R5CR119NQ7A shell am start -W -n com.lofuyu.borderledger.probe/com.lofuyu.borderledger.debug.FxReportPreviewActivity -a com.lofuyu.borderledger.debug.FX_REPORT_PREVIEW --es scenario boc+cny
```

The debug build and install succeeded; Android reported `Status: ok` and resolved `FxReportPreviewActivity`. The USB target was `R5CR119NQ7A` (`SM-G9910`, SDK 33). The activity was then obscured by the phone's secure Samsung PIN bouncer (`CredentialType: Pin`, `mCurrentFocus=NotificationShade`), so the UI tree contained only lockscreen nodes. No UI pass is claimed from that state; the app must be visually inspected after the owner unlocks the device.

`apksigner verify --verbose app-debug.apk` also passed with APK Signature Scheme v2 and one signer. The signer is a disposable local debug key used only to install the debug probe; no release signing material was added.

`aapt2 dump xmltree` confirmed the debug manifest contains `FxReportPreviewActivity`/`FX_REPORT_PREVIEW` and the unsigned release manifest contains neither.

Disposable emulator UI evidence:

- Installed Android 11 Google APIs x86 AVD `border-ledger-fx-qa` after removing the newly installed Android 35 image because the machine did not have enough free space for its userdata partition.
- Installed the debug APK and launched `FxReportPreviewActivity` for `available`, `partial`, `unavailable`, `provisional`, `refund`, and `boc+cny` scenarios. Accessibility dumps and screenshots were captured for each; all activity launches completed and crash-buffer checks were empty.
- The live emulator rendered the partial state with `Unavailable source currencies: EUR`, the unavailable state without a converted total, the provisional/refund states, and the dashed Chinese-bank card with exact `CA$0.99 – CA$1.01 CAD`, `±1.5% Chinese bank settlement estimate; CNY spending excluded`, and purchase-date lock wording. The BOC fixture includes CNY source spending and still excludes it from the band base.
- Signed the unsigned release APK with the same disposable local QA key, installed it as package `com.lofuyu.borderledger`, launched the real `MainActivity`, and visually verified the unauthenticated login and About screens. No crash-buffer entries were produced.

## Physical-device evidence

- After the owner unlocked `R5CR119NQ7A` (`SM-G9910`, SDK 33), the current debug APK was rebuilt with the disposable local QA keystore, installed, and launched successfully.
- On the physical handset, `available`, `partial`, `unavailable`, `provisional`, `refund`, and `boc+cny` scenarios all launched with `Status: ok`; accessibility trees and screenshots were captured for every state, and crash-buffer checks were empty.
- The physical `boc+cny` interaction used the UI-tree scroll bounds `[0,248][1080,2176]` to perform a `540,1976 -> 540,448` swipe. The resulting tree and screenshot showed the dashed card, `±1.5% Chinese bank settlement estimate; CNY spending excluded`, `Range: CA$0.99 – CA$1.01 CAD`, and `rates locked to purchase dates`, with CNY retained in the source audit.
- The current unsigned release APK was signed only with the disposable local QA key, verified with APK Signature Schemes v2/v3, installed as `com.lofuyu.borderledger`, and launched into `MainActivity`. The real release login screen and coordinate-derived About interaction were visually verified on USB; the About screen rendered the privacy copy; crash-buffer checks were empty.
- The USB package remained unlocked and foregrounded during the final checks. No production release signing or signing secret was added.
