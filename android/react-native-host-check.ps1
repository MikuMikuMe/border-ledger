param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Merged
)

$ErrorActionPreference = 'Stop'

$mainPath = Join-Path $ProjectRoot 'android/app/src/main/AndroidManifest.xml'
$debugPath = Join-Path $ProjectRoot 'android/app/src/debug/AndroidManifest.xml'
$releasePath = Join-Path $ProjectRoot 'android/app/src/release/AndroidManifest.xml'
$mainActivityPath = Join-Path $ProjectRoot 'android/app/src/main/java/com/lofuyu/borderledger/MainActivity.kt'
$reactActivityPath = Join-Path $ProjectRoot 'android/app/src/main/java/com/lofuyu/borderledger/react/BorderLedgerReactActivity.kt'
$applicationPath = Join-Path $ProjectRoot 'android/app/src/main/java/com/lofuyu/borderledger/BorderLedgerApplication.kt'
$mainThemePath = Join-Path $ProjectRoot 'android/app/src/main/res/values/themes.xml'

foreach ($path in @($mainActivityPath, $reactActivityPath, $applicationPath, $mainThemePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required React Native host file is missing: $path" }
}

[xml]$main = Get-Content -LiteralPath $mainPath -Raw
[xml]$debug = Get-Content -LiteralPath $debugPath -Raw
[xml]$release = Get-Content -LiteralPath $releasePath -Raw

$androidNs = 'http://schemas.android.com/apk/res/android'
$toolsNs = 'http://schemas.android.com/tools'
function Attribute($node, [string]$name, [string]$namespace = $androidNs) {
    if ($null -eq $node) { return '' }
    return $node.GetAttribute($name, $namespace)
}
function LauncherNames($manifest) {
    @($manifest.manifest.application.activity | Where-Object {
        @($_.'intent-filter'.category | Where-Object { (Attribute $_ 'name') -eq 'android.intent.category.LAUNCHER' }).Count -gt 0
    } | ForEach-Object { Attribute $_ 'name' })
}

$mainLauncher = @(LauncherNames $main)
if ($mainLauncher.Count -ne 1 -or $mainLauncher[0] -ne '.MainActivity') {
    throw "Production manifest must retain only .MainActivity as launcher; got $($mainLauncher -join ', ')."
}
$mainActivity = Get-Content -Raw -LiteralPath $mainActivityPath
$reactActivity = Get-Content -Raw -LiteralPath $reactActivityPath
$application = Get-Content -Raw -LiteralPath $applicationPath
$mainTheme = Get-Content -Raw -LiteralPath $mainThemePath
if ($mainActivity -notmatch 'class MainActivity\s*:\s*BorderLedgerReactActivity\(\)') {
    throw 'The production MainActivity launcher must inherit the React Native host.'
}
if ($reactActivity -notmatch 'abstract class BorderLedgerReactActivity\s*:\s*ReactActivity\(\),\s*NativeServiceHost') {
    throw 'The shared Activity host must be a ReactActivity implementing native services.'
}
if ($application -notmatch 'add\(com\.lofuyu\.borderledger\.react\.NativeServicePackage\(nativeServices\)\)') {
    throw 'TurboModules must be registered in production and debug React hosts.'
}
$applicationOnCreate = [regex]::Match($application, 'override fun onCreate\(\)\s*\{(?<body>[\s\S]*?)\n    \}')
if (-not $applicationOnCreate.Success -or $applicationOnCreate.Groups['body'].Value -match 'loadReactNative\(') {
    throw 'Application startup must not initialize React Native for headless workers.'
}
if ($mainTheme -notmatch 'parent="Theme\.AppCompat\.DayNight\.NoActionBar"') {
    throw 'The production ReactActivity must use an AppCompat-compatible theme.'
}
$releaseLauncher = @(LauncherNames $release)
if ($releaseLauncher.Count -ne 0) {
    throw "Release overlay must not replace the production launcher; got $($releaseLauncher -join ', ')."
}
$debugLauncher = @(LauncherNames $debug)
if ($debugLauncher.Count -ne 1 -or $debugLauncher[0] -ne 'com.lofuyu.borderledger.react.ReactNativeActivity') {
    throw "Debug overlay must launch only ReactNativeActivity; got $($debugLauncher -join ', ')."
}
$debugReactActivity = @($debug.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.react.ReactNativeActivity' })
if ($debugReactActivity.Count -ne 1 -or (Attribute $debugReactActivity[0] 'theme') -ne '@style/Theme.BorderLedger.ReactNative') {
    throw 'Debug ReactActivity must use its AppCompat-compatible theme.'
}
$debugThemePath = Join-Path $ProjectRoot 'android/app/src/debug/res/values/themes.xml'
[xml]$debugThemes = Get-Content -LiteralPath $debugThemePath -Raw
$reactTheme = @($debugThemes.resources.style | Where-Object { $_.name -eq 'Theme.BorderLedger.ReactNative' })
if ($reactTheme.Count -ne 1 -or $reactTheme[0].parent -ne 'Theme.AppCompat.DayNight.NoActionBar') {
    throw 'Debug ReactActivity theme must inherit Theme.AppCompat.DayNight.NoActionBar.'
}
$removed = @($debug.manifest.application.activity | Where-Object { (Attribute $_ 'node' $toolsNs) -eq 'remove' } | ForEach-Object { Attribute $_ 'name' })
if ($removed -contains 'com.lofuyu.borderledger.auth.AuthCallbackActivity') {
    throw 'Debug overlay removes AuthCallbackActivity and breaks App Link routing.'
}
$callback = @($main.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq '.auth.AuthCallbackActivity' })
if ($callback.Count -ne 1) { throw 'Production callback activity is missing.' }
$callbackData = @($callback[0].'intent-filter'.data)
if ($callbackData.Count -ne 1 -or (Attribute $callbackData[0] 'scheme') -ne 'https' -or
    (Attribute $callbackData[0] 'host') -ne '${mobileCallbackHost}' -or
    (Attribute $callbackData[0] 'path') -ne '/android/auth/callback') {
    throw 'Production callback route changed.'
}
Write-Output 'React Native production launcher, headless initialization, module registration and callback assertions passed.'

if ($Merged) {
    foreach ($variant in @('debug', 'release')) {
        $taskVariant = (Get-Culture).TextInfo.ToTitleCase($variant)
        $path = Join-Path $ProjectRoot "android/app/build/intermediates/merged_manifests/$variant/process${taskVariant}Manifest/AndroidManifest.xml"
        [xml]$manifest = Get-Content -LiteralPath $path -Raw
        $launchers = @(LauncherNames $manifest)
        $expected = if ($variant -eq 'debug') { 'com.lofuyu.borderledger.react.ReactNativeActivity' } else { 'com.lofuyu.borderledger.MainActivity' }
        if ($launchers.Count -ne 1 -or $launchers[0] -ne $expected) { throw "$variant launcher mismatch: $($launchers -join ', ')" }
        $package = if ($variant -eq 'debug') { 'com.lofuyu.borderledger.probe' } else { 'com.lofuyu.borderledger' }
        if ($manifest.manifest.package -ne $package) { throw "$variant application ID changed." }
        $mergedCallback = @($manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.auth.AuthCallbackActivity' })
        if ($mergedCallback.Count -ne 1) { throw "$variant callback activity missing." }
        $route = @($mergedCallback[0].'intent-filter'.data)
        if ($route.Count -ne 1 -or (Attribute $route[0] 'scheme') -ne 'https' -or
            (Attribute $route[0] 'host') -ne 'pf.lofuyu.com' -or
            (Attribute $route[0] 'path') -ne '/android/auth/callback') { throw "$variant callback route changed." }
        if ($variant -eq 'release') {
            if (@($manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.react.ReactNativeActivity' }).Count -ne 0) {
                throw 'React Native debug activity leaked into release.'
            }
            if (@($manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.MainActivity' }).Count -ne 1) {
                throw 'React Native production launcher is missing from the release manifest.'
            }
            if ((Attribute $manifest.manifest.application 'usesCleartextTraffic') -eq 'true') { throw 'Debug cleartext policy leaked into release.' }
            if (@($manifest.manifest.application.service | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.capture.BankNotificationListenerService' }).Count -ne 1) {
                throw 'Release capture service missing.'
            }
        }
        Write-Output "$variant merged manifest assertions passed: launcher=$expected package=$package callback=https://pf.lofuyu.com/android/auth/callback"
    }
}
