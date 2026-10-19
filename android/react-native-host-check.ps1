param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$Merged
)

$ErrorActionPreference = 'Stop'

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

function Assert-RequiredFiles([string[]]$Paths) {
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required React Native host file is missing: $path"
        }
    }
}

function Assert-CallbackRoute($Data, [string]$ExpectedHost, [string]$Message) {
    $route = @($Data)
    if ($route.Count -ne 1) { throw $Message }
    if ((Attribute $route[0] 'scheme') -ne 'https') { throw $Message }
    if ((Attribute $route[0] 'host') -ne $ExpectedHost) { throw $Message }
    if ((Attribute $route[0] 'path') -ne '/android/auth/callback') { throw $Message }
}

function Assert-ProductionHostFiles([string]$Root) {
    $mainActivityPath = Join-Path $Root 'android/app/src/main/java/com/lofuyu/borderledger/MainActivity.kt'
    $reactActivityPath = Join-Path $Root 'android/app/src/main/java/com/lofuyu/borderledger/react/BorderLedgerReactActivity.kt'
    $applicationPath = Join-Path $Root 'android/app/src/main/java/com/lofuyu/borderledger/BorderLedgerApplication.kt'
    $mainThemePath = Join-Path $Root 'android/app/src/main/res/values/themes.xml'
    Assert-RequiredFiles @($mainActivityPath, $reactActivityPath, $applicationPath, $mainThemePath)

    $mainActivity = Get-Content -Raw -LiteralPath $mainActivityPath
    if ($mainActivity -notmatch 'class MainActivity\s*:\s*BorderLedgerReactActivity\(\)') {
        throw 'The production MainActivity launcher must inherit the React Native host.'
    }
    $reactActivity = Get-Content -Raw -LiteralPath $reactActivityPath
    if ($reactActivity -notmatch 'abstract class BorderLedgerReactActivity\s*:\s*ReactActivity\(\),\s*NativeServiceHost') {
        throw 'The shared Activity host must be a ReactActivity implementing native services.'
    }
    $application = Get-Content -Raw -LiteralPath $applicationPath
    if ($application -notmatch 'add\(com\.lofuyu\.borderledger\.react\.NativeServicePackage\(nativeServices\)\)') {
        throw 'TurboModules must be registered in production and debug React hosts.'
    }
    $applicationOnCreate = [regex]::Match($application, 'override fun onCreate\(\)\s*\{(?<body>[\s\S]*?)\n    \}')
    if (-not $applicationOnCreate.Success -or $applicationOnCreate.Groups['body'].Value -match 'loadReactNative\(') {
        throw 'Application startup must not initialize React Native for headless workers.'
    }
    $mainTheme = Get-Content -Raw -LiteralPath $mainThemePath
    if ($mainTheme -notmatch 'parent="Theme\.AppCompat\.DayNight\.NoActionBar"') {
        throw 'The production ReactActivity must use an AppCompat-compatible theme.'
    }
}

function Assert-ProductionManifest($Manifest) {
    $launchers = @(LauncherNames $Manifest)
    if ($launchers.Count -ne 1 -or $launchers[0] -ne '.MainActivity') {
        throw "Production manifest must retain only .MainActivity as launcher; got $($launchers -join ', ')."
    }
    $callback = @($Manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq '.auth.AuthCallbackActivity' })
    if ($callback.Count -ne 1) { throw 'Production callback activity is missing.' }
    Assert-CallbackRoute $callback[0].'intent-filter'.data '${mobileCallbackHost}' 'Production callback route changed.'
}

function Assert-DebugManifest($Manifest, [string]$Root) {
    $launchers = @(LauncherNames $Manifest)
    if ($launchers.Count -ne 1 -or $launchers[0] -ne 'com.lofuyu.borderledger.react.ReactNativeActivity') {
        throw "Debug overlay must launch only ReactNativeActivity; got $($launchers -join ', ')."
    }
    $activity = @($Manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.react.ReactNativeActivity' })
    if ($activity.Count -ne 1) { throw 'Debug ReactActivity is missing.' }
    if ((Attribute $activity[0] 'theme') -ne '@style/Theme.BorderLedger.ReactNative') {
        throw 'Debug ReactActivity must use its AppCompat-compatible theme.'
    }
    $debugThemePath = Join-Path $Root 'android/app/src/debug/res/values/themes.xml'
    [xml]$debugThemes = Get-Content -LiteralPath $debugThemePath -Raw
    $reactTheme = @($debugThemes.resources.style | Where-Object { $_.name -eq 'Theme.BorderLedger.ReactNative' })
    if ($reactTheme.Count -ne 1) { throw 'Debug ReactActivity theme is missing.' }
    if ($reactTheme[0].parent -ne 'Theme.AppCompat.DayNight.NoActionBar') {
        throw 'Debug ReactActivity theme must inherit Theme.AppCompat.DayNight.NoActionBar.'
    }
    $removed = @($Manifest.manifest.application.activity | Where-Object { (Attribute $_ 'node' $toolsNs) -eq 'remove' } | ForEach-Object { Attribute $_ 'name' })
    if ($removed -contains 'com.lofuyu.borderledger.auth.AuthCallbackActivity') {
        throw 'Debug overlay removes AuthCallbackActivity and breaks App Link routing.'
    }
}

function Assert-ReleaseOverlay($Manifest) {
    $launchers = @(LauncherNames $Manifest)
    if ($launchers.Count -ne 0) {
        throw "Release overlay must not replace the production launcher; got $($launchers -join ', ')."
    }
}

function Assert-SourceManifests([string]$Root) {
    $mainPath = Join-Path $Root 'android/app/src/main/AndroidManifest.xml'
    $debugPath = Join-Path $Root 'android/app/src/debug/AndroidManifest.xml'
    $releasePath = Join-Path $Root 'android/app/src/release/AndroidManifest.xml'
    [xml]$main = Get-Content -LiteralPath $mainPath -Raw
    [xml]$debug = Get-Content -LiteralPath $debugPath -Raw
    [xml]$release = Get-Content -LiteralPath $releasePath -Raw
    Assert-ProductionManifest $main
    Assert-DebugManifest $debug $Root
    Assert-ReleaseOverlay $release
}

function Assert-SourceHost([string]$Root) {
    Assert-ProductionHostFiles $Root
    Assert-SourceManifests $Root
}

function Assert-ReleaseMerged($Manifest) {
    if (@($Manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.react.ReactNativeActivity' }).Count -ne 0) {
        throw 'React Native debug activity leaked into release.'
    }
    if (@($Manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.MainActivity' }).Count -ne 1) {
        throw 'React Native production launcher is missing from the release manifest.'
    }
    if ((Attribute $Manifest.manifest.application 'usesCleartextTraffic') -eq 'true') {
        throw 'Debug cleartext policy leaked into release.'
    }
    if (@($Manifest.manifest.application.service | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.capture.BankNotificationListenerService' }).Count -ne 1) {
        throw 'Release capture service missing.'
    }
}

function Assert-MergedVariant([string]$Root, [string]$Variant) {
    $taskVariant = (Get-Culture).TextInfo.ToTitleCase($Variant)
    $path = Join-Path $Root "android/app/build/intermediates/merged_manifests/$Variant/process${taskVariant}Manifest/AndroidManifest.xml"
    [xml]$manifest = Get-Content -LiteralPath $path -Raw
    $launchers = @(LauncherNames $manifest)
    $expectedLauncher = if ($Variant -eq 'debug') { 'com.lofuyu.borderledger.react.ReactNativeActivity' } else { 'com.lofuyu.borderledger.MainActivity' }
    if ($launchers.Count -ne 1 -or $launchers[0] -ne $expectedLauncher) {
        throw "$Variant launcher mismatch: $($launchers -join ', ')"
    }
    $expectedPackage = if ($Variant -eq 'debug') { 'com.lofuyu.borderledger.probe' } else { 'com.lofuyu.borderledger' }
    if ($manifest.manifest.package -ne $expectedPackage) { throw "$Variant application ID changed." }
    $mergedCallback = @($manifest.manifest.application.activity | Where-Object { (Attribute $_ 'name') -eq 'com.lofuyu.borderledger.auth.AuthCallbackActivity' })
    if ($mergedCallback.Count -ne 1) { throw "$Variant callback activity missing." }
    Assert-CallbackRoute $mergedCallback[0].'intent-filter'.data 'pf.lofuyu.com' "$Variant callback route changed."
    if ($Variant -eq 'release') { Assert-ReleaseMerged $manifest }
    Write-Output "$Variant merged manifest assertions passed: launcher=$expectedLauncher package=$expectedPackage callback=https://pf.lofuyu.com/android/auth/callback"
}

function Assert-MergedManifests([string]$Root) {
    foreach ($variant in @('debug', 'release')) {
        Assert-MergedVariant $Root $variant
    }
}

function Invoke-HostCheck([string]$Root) {
    Assert-SourceHost $Root
    Write-Output 'React Native production launcher, headless initialization, module registration and callback assertions passed.'
    if ($Merged) { Assert-MergedManifests $Root }
}

Invoke-HostCheck $ProjectRoot
