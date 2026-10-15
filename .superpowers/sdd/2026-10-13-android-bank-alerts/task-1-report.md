# Task 1 report — Android notification probe

Date: 2026-10-13  
Status: `DONE_WITH_CONCERNS` for the bounded debug scaffold. Android compilation, APK installation, Pixel capture, and source acceptance are unverified.

## Delivered

- Created a pinned Android project skeleton in `android/`: `settings.gradle.kts`, root and app `build.gradle.kts`, `gradle/libs.versions.toml`, `gradle/wrapper/gradle-wrapper.properties`, `gradlew.bat`, and a main manifest with no listener or launcher.
- Added the debug-only manifest, `ProbeActivity.kt`, `NotificationProbeScreen.kt`, `ProbeNotificationListener.kt`, `ProbePreview.kt`, and `ProbeStore.kt` under `app/src/debug`. The debug application ID is `com.lofuyu.borderledger.probe`; the future production ID is `com.lofuyu.borderledger`. The debug listener is protected by `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`.
- The listener ignores packages other than `com.tencent.mm` before reading extras. It derives title/body presence, standard/big/text-line representation flags and counts, bounded public `MessagingStyle` message counts, bounded individual timestamp count/min/max on API 30+, a whitelisted category, source package, `sbn.postTime`, callback time, and observation origin. No title/body content, sender, notification key, account, amount, or raw notification bundle crosses into the UI buffer. At most 20 pending UI updates and 20 retained metadata previews exist in process memory. On reconnect it inspects currently active matching notifications through the same package-first path and labels them recovered; it does not read dismissed history or promise backfill. There is no network, database, log, backup, automatic file write, SMS permission, accessibility service, exact alarm, or foreground service.
- The screen shows permission/listener state, a controlled package-only source-identification procedure, bounded representation/timestamp previews, device timezone and Toronto reporting day, and an explicit document-picker action to export sanitized metadata CSV. It reports completion, cancellation, and write failure without crashing. It is static, uses Material 3 structure and textual statuses, and gives actions a 48 dp minimum height. It does not claim any source or transaction parser is verified. The test string is synthetic.
- Added `android/PRODUCT.md` and updated `docs/android-validation.md` with a sanitized `not tested here` matrix and explicit automatic-capture gates.

## TDD record

1. Before production code, wrote `app/src/test/java/com/lofuyu/borderledger/debug/ProbePreviewTest.kt` for metadata-only preview/CSV and rejection of unapproved packages or invalid post time. The test uses the literal `SYNTHETIC_SECRET_TEXT`, not a real financial fixture.
2. RED attempt, from `android`: `if (Test-Path -LiteralPath '.\gradlew.bat') { & '.\gradlew.bat' :app:testDebugUnitTest } else { Write-Output 'BLOCKED: android/gradlew.bat is absent; Gradle is not installed'; exit 127 }` → exit 127, `BLOCKED: android/gradlew.bat is absent; Gradle is not installed`. This was a toolchain stop before test compilation, not an observed failing assertion.
3. Added the minimal `ProbePreview` production implementation and debug probe wiring. Later `& '.\gradlew.bat' :app:testDebugUnitTest` → exit 1, `Gradle wrapper JAR is missing. Generate it with a trusted Gradle 8.13 installation before building.` CMD also printed that the mounted UNC working directory is unsupported and defaulted to Windows. No GREEN run occurred. The test is present but its behavior has not been executed or verified.

## Build, install, and other checks

| Command/check | Observed result |
|---|---|
| `java -version` | Exit 0; Temurin OpenJDK `21.0.7+6-LTS` |
| `Get-Command gradle,adb,kotlinc,npm,node` and SDK environment/path checks | Only npm and node found; Gradle, ADB, and Kotlin compiler absent; `ANDROID_HOME` and `ANDROID_SDK_ROOT` unset; `android/gradle/wrapper/gradle-wrapper.jar` absent |
| `& '.\gradlew.bat' :app:assembleDebug` from `android` | Exit 1; missing Gradle wrapper JAR, with the same UNC CMD warning. No APK exists. |
| `adb install -r '.\app\build\outputs\apk\debug\app-debug.apk'` | Guarded attempt exited 127: `BLOCKED: adb is not installed; no APK exists`. No installation occurred. |
| `adb shell getprop ro.build.version.release` | Guarded attempt exited 127: `BLOCKED: adb is not installed; no Android device inventory available`. No Pixel facts obtained. |
| Manifest XML parse | Exit 0; both main and debug manifests parsed. |
| Corrected manifest isolation check | Exit 0; `main_service_present=False debug_service_present=True permission=android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`. An earlier PowerShell count check falsely counted a null main service as one; this was a check error, corrected with XML node selection. |
| Python `tomllib` parse of `gradle/libs.versions.toml` | Exit 0; versions parsed as pinned below. |
| Source scan for network, DB, logging, SMS, accessibility, alarm, foreground-service, and message-array APIs | Exit 0; only manifest namespace URLs matched the scan. This is static evidence, not a build or runtime guarantee. |
| `npm run typecheck` in repository root | Exit 0; existing web TypeScript check passed. |
| `npm test` in repository root | Exit 1 at Vitest startup: `ERR_MODULE_NOT_FOUND` for mounted `node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs`; no test assertions ran. This was not caused or repaired by the Android scaffold. |
| `git status --short --branch` | Exit 1: `fatal: not a git repository (or any of the parent directories): .git`. No commit was available or attempted; no Git initialization or remote write was performed. |

Pinned source choices: Gradle 8.13, Android Gradle Plugin 8.13.2, Kotlin and Compose compiler plugin 2.2.20, Compose BOM 2025.10.00, Activity Compose 1.11.0, JUnit 4.13.2, compile/target SDK 36, min SDK 26, Java/Kotlin bytecode target 17. [AGP compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes), [Kotlin release](https://kotlinlang.org/docs/releases.html), and [Activity release](https://developer.android.com/jetpack/androidx/releases/activity) support the version selection. No dependency resolution, compile, or device run has confirmed this combination. The text wrapper script/property are present, but the binary wrapper JAR is missing; a trusted Gradle 8.13 installation must generate/supply it. The current UNC mount may need a local or mapped drive for a future build. No Gradle, SDK, ADB, or caches were installed in this task.

## Hardware/source acceptance still open

No Pixel or private user/device source evidence was available. Installed Android and WeChat versions, actual BOC conversation identifier/source package, CMB account/channel, actual BOC credit/debit export formats, notification field contents, and individual message timestamp accessibility are unknown. No real notification, screenshot, transaction, account suffix, credential, or signing material was copied into the workspace. The probe can derive bounded representation flags/counts and API-exposed individual timestamp ranges, but this was not observed on a device and does not prove that `sbn.postTime` belongs to each item in a summary.

On the owner's Pixel, test new BOC delivery with locked/unlocked screen, WeChat foreground/background, silent/muted conversation or channel, content-preview changes, permission revoke/regrant, and listener reconnect. Compare the original `sbn.postTime`, any accessible individual message timestamp, callback time, and the user's clock in `America/Toronto`; inspect actual BOC app notifications and statement export formats when the user supplies them. A genuine posted notification and accessible data are required; screenshots alone do not establish listener fields. The current fixed WeChat package filter is a feasibility choice, not a verified BOC source identity.

Automatic capture remains gated on an approved source and recognizable type, labeled amount and currency, resolvable instrument, and original individual posting time. Generic, redacted, summary-only, or untimestamped data are unsupported/review-only. If both WeChat and a verified BOC app source fail, mark the source import-only and automatic-monitoring acceptance unmet. CMB remains unsupported until its own source evidence is verified. No production parser, listener wiring, upload, or financial projection was implemented.

## Fix round 1 — review findings (2026-10-13)

Status remains `DONE_WITH_CONCERNS`. All four findings were addressed in the scoped debug probe and documentation. Source acceptance, Android compilation, APK installation, and Pixel evidence remain open.

### Finding 1 — capability evidence

Added `NotificationRepresentationSummary` with bounded flags/counts for standard text, big text, text lines, and `Notification.EXTRA_MESSAGES`. On API 30 and newer, the listener uses Android's public `Notification.MessagingStyle.Message.getMessagesFromBundleArray` API on at most 20 message parcels and retains only positive timestamp count/min/max scalars. Raw text and message objects are not retained or exported. The screen states that source identity is package-only, gives a controlled procedure to trigger one new alert from the known BOC conversation and compare the visible source/package/timing, and keeps BOC acceptance unproven.

### Finding 2 — reconnect recovery

`onListenerConnected` now reads `activeNotifications` inside a guarded call, filters package identity before extras, inspects at most 20 matching active notifications through the same enqueue path, and labels rows `recovered active notification`. The UI and docs explicitly say this is a current active snapshot, not notification history or backfill; dismissed alerts remain unavailable.

### Findings 3 and 4 — time and export UX

Each preview shows the device timezone and the `America/Toronto` reporting day derived from `sbn.postTime`. The action is now `Export sanitized metadata CSV`, with a user-selected Android document destination. The activity reports success, cancellation, or failure and catches null streams, `IOException`, `SecurityException`, and runtime write errors without crashing. Only the derived CSV scalars are written.

### TDD and fix-round checks

Tests were updated before the production fix for representation/timestamp summaries, recovered-row labeling, raw-text exclusion, Toronto day formatting, and the 20-item count cap. The Android test was not rerun because the user instructed this fix round to stop unavailable Gradle/SDK/ADB attempts. The prior exact test command and failure remain: `& '.\\gradlew.bat' :app:testDebugUnitTest` from `android` → exit 1, `Gradle wrapper JAR is missing. Generate it with a trusted Gradle 8.13 installation before building.` No GREEN Android test result exists.

Safe fix-round commands and observed output:

```powershell
$main = [xml](Get-Content -LiteralPath 'android/app/src/main/AndroidManifest.xml' -Raw)
$debug = [xml](Get-Content -LiteralPath 'android/app/src/debug/AndroidManifest.xml' -Raw)
$androidNs = 'http://schemas.android.com/apk/res/android'
$mainService = $main.SelectSingleNode('/manifest/application/service')
$debugService = $debug.SelectSingleNode('/manifest/application/service')
$permission = $debugService.GetAttribute('permission',$androidNs)
Write-Output "MANIFEST_XML_OK main_service_present=$($null -ne $mainService) debug_service_present=$($null -ne $debugService) permission=$permission"
if ($null -ne $mainService -or $null -eq $debugService -or $permission -ne 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE') { exit 1 }
```

Exit 0. Output: `MANIFEST_XML_OK main_service_present=False debug_service_present=True permission=android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`.

```powershell
python -c "import tomllib,pathlib; d=tomllib.loads(pathlib.Path('android/gradle/libs.versions.toml').read_text(encoding='utf-8')); print('TOML_OK', d['versions'])"
```

Exit 0. Output: `TOML_OK {'agp': '8.13.2', 'kotlin': '2.2.20', 'composeBom': '2025.10.00', 'activity': '1.11.0', 'junit': '4.13.2'}`.

```powershell
$pattern = 'android\.permission\.INTERNET|READ_SMS|AccessibilityService|AlarmManager|ForegroundService|androidx\.room|sqlite|retrofit|okhttp|Log\.|EXTRA_MESSAGES.*toString|\.getText\(\)'
$matches = rg -n $pattern android
if ($LASTEXITCODE -eq 1) { Write-Output 'PRIVACY_SCAN_OK no forbidden APIs/raw-text export patterns found' } else { $matches; exit 1 }
```

Exit 0. Output: `PRIVACY_SCAN_OK no forbidden APIs/raw-text export patterns found`.

```powershell
rg -n "RECOVERED_ACTIVE|activeNotifications|MessagingStyle\.Message|getMessagesFromBundleArray|individualTimestamp|Controlled source check|Export sanitized metadata CSV|ProbeExportState|heightIn\(min = 48\.dp\)" android docs/android-validation.md
```

Exit 0. Output contained matches for the recovery enum/path, public timestamp inspection, source procedure, export states, and 48 dp controls.

```powershell
npm run typecheck
```

Exit 0. Output: `> cross-border-spending-tracker@0.1.0 typecheck`, `> tsc --noEmit`, and no diagnostics.

No Gradle, SDK, or ADB command was run in this fix round. No build, install, device capture, or Git commit is claimed. No Worker or domain file was edited.
