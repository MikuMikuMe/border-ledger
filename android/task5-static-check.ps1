$ErrorActionPreference = 'Stop'

$androidRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appRoot = Join-Path $androidRoot 'app'
$mainRoot = Join-Path $appRoot 'src\main'
$testRoot = Join-Path $appRoot 'src\test'

$required = @(
    'build.gradle.kts',
    'app\src\main\AndroidManifest.xml',
    'app\src\main\java\com\lofuyu\borderledger\BorderLedgerApplication.kt',
    'app\src\main\java\com\lofuyu\borderledger\MainActivity.kt',
    'app\src\main\java\com\lofuyu\borderledger\auth\OwnerSessionManager.kt',
    'app\src\main\java\com\lofuyu\borderledger\auth\OwnerSessionStore.kt',
    'app\src\main\java\com\lofuyu\borderledger\auth\CaptureCredentialProvider.kt',
    'app\src\main\java\com\lofuyu\borderledger\auth\CredentialInterceptors.kt',
    'app\src\main\java\com\lofuyu\borderledger\auth\AuthCallbackActivity.kt',
    'app\src\main\java\com\lofuyu\borderledger\local\KeyStoreVault.kt',
    'app\src\main\java\com\lofuyu\borderledger\local\EncryptedRecordStore.kt',
    'app\src\main\java\com\lofuyu\borderledger\local\OutboxDao.kt',
    'app\src\main\java\com\lofuyu\borderledger\local\OwnerReadCache.kt',
    'app\src\main\java\com\lofuyu\borderledger\ui\theme\BorderLedgerTheme.kt',
    'app\src\main\java\com\lofuyu\borderledger\ui\theme\MotionPolicy.kt',
    'app\src\main\java\com\lofuyu\borderledger\ui\login\LoginScreen.kt',
    'app\src\main\java\com\lofuyu\borderledger\ui\login\LoginFlowBackdrop.kt',
    'app\src\main\java\com\lofuyu\borderledger\ui\onboarding\CaptureOnboardingScreen.kt',
    'app\src\test\java\com\lofuyu\borderledger\auth\OwnerSessionManagerTest.kt',
    'app\src\test\java\com\lofuyu\borderledger\auth\CaptureOnboardingCoordinatorTest.kt'
)
$missing = $required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $androidRoot $_)) }
if ($missing) { throw "Missing required Task 5 files: $($missing -join ', ')" }

$androidNs = 'http://schemas.android.com/apk/res/android'
$toolsNs = 'http://schemas.android.com/tools'
$main = [xml](Get-Content -Raw -LiteralPath (Join-Path $appRoot 'src\main\AndroidManifest.xml'))
$debug = [xml](Get-Content -Raw -LiteralPath (Join-Path $appRoot 'src\debug\AndroidManifest.xml'))
$release = [xml](Get-Content -Raw -LiteralPath (Join-Path $appRoot 'src\release\AndroidManifest.xml'))
$mainApplication = $main.SelectSingleNode('/manifest/application')
$callback = $main.SelectNodes('/manifest/application/activity') | Where-Object { $_.GetAttribute('name', $androidNs) -eq '.auth.AuthCallbackActivity' } | Select-Object -First 1
$callbackFilter = if ($callback) { $callback.SelectSingleNode('intent-filter') } else { $null }
$releaseInternet = $release.SelectNodes('/manifest/uses-permission') | Where-Object { $_.GetAttribute('name', $androidNs) -eq 'android.permission.INTERNET' } | Select-Object -First 1
$debugListener = $debug.SelectNodes('/manifest/application/service') | Where-Object { $_.GetAttribute('name', $androidNs) -eq 'com.lofuyu.borderledger.debug.ProbeNotificationListener' } | Select-Object -First 1
$debugMainRemoval = $debug.SelectNodes('/manifest/application/activity') | Where-Object { $_.GetAttribute('name', $androidNs) -eq 'com.lofuyu.borderledger.MainActivity' } | Select-Object -First 1

if ($null -eq $mainApplication -or $mainApplication.GetAttribute('allowBackup', $androidNs) -ne 'false') { throw 'Main manifest does not fail closed on backup.' }
if ($mainApplication.GetAttribute('name', $androidNs) -ne '.BorderLedgerApplication') { throw 'Production application class is not wired.' }
if ($null -eq $callback -or $callback.GetAttribute('exported', $androidNs) -ne 'true') { throw 'Callback activity is not explicitly exported.' }
if ($null -eq $callbackFilter -or $callbackFilter.GetAttribute('autoVerify', $androidNs) -ne 'true') { throw 'Callback App Link is not auto-verified.' }
if (($callbackFilter.SelectNodes('data') | Where-Object { $_.GetAttribute('path', $androidNs) -eq '/android/auth/callback' } | Select-Object -First 1) -eq $null) { throw 'Callback path is not exact.' }
if ($null -eq $releaseInternet) { throw 'Release network permission is missing.' }
if ($null -eq $debugListener -or $debugListener.GetAttribute('permission', $androidNs) -ne 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE') { throw 'Debug listener boundary is missing.' }
if ($null -eq $debugMainRemoval -or $debugMainRemoval.GetAttribute('node', $toolsNs) -ne 'remove') { throw 'Debug probe does not remove production launcher wiring.' }

$productionFiles = Get-ChildItem -LiteralPath $mainRoot -Recurse -Filter '*.kt'
$productionKotlin = ($productionFiles | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
$productionText = $productionKotlin + "`n" + (Get-Content -Raw -LiteralPath (Join-Path $appRoot 'src\main\AndroidManifest.xml'))
$versionCatalog = Get-Content -Raw -LiteralPath (Join-Path $androidRoot 'gradle\libs.versions.toml')
$appContainer = Get-Content -Raw -LiteralPath (Join-Path $mainRoot 'java\com\lofuyu\borderledger\AppContainer.kt')
$mainActivity = Get-Content -Raw -LiteralPath (Join-Path $mainRoot 'java\com\lofuyu\borderledger\MainActivity.kt')
$outbox = Get-Content -Raw -LiteralPath (Join-Path $mainRoot 'java\com\lofuyu\borderledger\local\OutboxDao.kt')
$captureScreen = Get-Content -Raw -LiteralPath (Join-Path $mainRoot 'java\com\lofuyu\borderledger\ui\onboarding\CaptureOnboardingScreen.kt')
$backdrop = Get-Content -Raw -LiteralPath (Join-Path $mainRoot 'java\com\lofuyu\borderledger\ui\login\LoginFlowBackdrop.kt')
if ($versionCatalog -notmatch 'compose-foundation\s*=\s*\{\s*module\s*=\s*"androidx\.compose\.foundation:foundation"') { throw 'Compose Foundation catalog alias is missing.' }
if ($appContainer -match 'UnavailableMobileApi') { throw 'Production AppContainer still defaults capture to UnavailableMobileApi.' }
if ($appContainer -notmatch 'HttpWorkerCaptureApi' -or $mainActivity -notmatch 'syncOwnerSessionState' -or $mainActivity -notmatch 'refreshApiHealth') { throw 'Capture onboarding is not wired to the signed-in owner/API boundary.' }
if ($productionText -match 'ownerSignedIn\s*=\s*false') { throw 'Capture onboarding still has a production false owner-sign-in default.' }
if ($outbox -notmatch 'private val mutex = Mutex\(\)' -or $outbox -notmatch 'enqueue\(event: QueuedAlert\): EnqueueResult = mutex\.withLock') { throw 'Outbox enqueue is not protected by its read-modify-write mutex.' }
if ($captureScreen -match 'onClick\s*=\s*\{\s*coordinator\.[^}]*SourceTestResult\.Passed') { throw 'A source-test button can assert Passed without evidence.' }
if (($backdrop -notmatch 'MaterialTheme\.colorScheme\.primary' -and $backdrop -notmatch 'colors\.primary') -or ($backdrop -notmatch 'MaterialTheme\.colorScheme\.secondary' -and $backdrop -notmatch 'colors\.secondary')) { throw 'Login backdrop does not derive ribbon colors from MaterialTheme.' }
$requiredMarkers = @(
    'AndroidKeyStore', 'AES/GCM/NoPadding', 'noBackupFilesDir', 'SecureStorageException',
    'OwnerAuthInterceptor', 'CaptureAuthInterceptor', 'StateFlow<OwnerSessionState>', 'Mutex',
    'PendingOwnerRotation', 'OWNER_REVOCATIONS', 'OUTBOX_QUEUE', 'retainEncryptedOutbox',
    'clearOwnerReadCache', 'allowsContinuousMotion', 'FLOW_CYCLE_MILLIS = 18_000',
    'CaptureHealth.SourceTestRequired', 'CaptureApiHealth', 'OwnerSessionStateProvider',
    'observeSourceTest', 'requestSourceTest', 'explicitConsent = true', 'POST_NOTIFICATIONS'
)
foreach ($marker in $requiredMarkers) {
    if ($productionText -notmatch [regex]::Escape($marker)) { throw "Missing production marker: $marker" }
}

# NotificationListenerService is the approved production capture boundary. Keep
# this list limited to the prohibited SMS/accessibility/alarm/foreground/logging
# APIs and scan each source file so a match cannot report unrelated code.
$forbiddenPatterns = @(
    '\bREAD_SMS\b',
    '\bAccessibilityService\b',
    '\bAlarmManager\b',
    '\bstartForeground(?:Service)?\s*\(',
    '\bandroid\.util\.Log\b',
    '\bprintln\s*\('
)
$forbiddenMatches = foreach ($file in $productionFiles) {
    Select-String -LiteralPath $file.FullName -Pattern $forbiddenPatterns -AllMatches
}
if ($forbiddenMatches) {
    $forbiddenDetails = $forbiddenMatches | ForEach-Object {
        "$($_.Path):$($_.LineNumber):$($_.Line.Trim())"
    }
    throw "Forbidden capture/runtime API in production source:`n$($forbiddenDetails -join "`n")"
}

$testText = (Get-ChildItem -LiteralPath $testRoot -Recurse -Filter '*.kt' | ForEach-Object { Get-Content -Raw -LiteralPath $_.FullName }) -join "`n"
foreach ($testName in @('callbackExchangeCommitsBeforeSignedInAndDuplicateCallbackIsReplaySafe', 'storageFailureDoesNotClaimSignInOrResetEncryptedState', 'expiredAccessUsesOneRefreshForConcurrentOwnerCalls', 'ownerAuthInterceptorRefreshesExpiredAccessWithOneRefresh', 'offlineLogoutClearsVisibleOwnerDataButRetainsEncryptedOutboxAndQueuesRevocations', 'ownerAndCaptureInterceptorsRejectEachOthersRoutes', 'loginDoesNotSilentlyAuthorizeCaptureAndSyntheticTestCannotMarkReady', 'signedOutOwnerStateBlocksCaptureAuthorization', 'sourceTestStaysAwaitingUntilObservedEvidence', 'explicitConsentAndRealSourceTestAreRequiredBeforeCredentialIssuance', 'concurrentEnqueuesPreserveEveryEvent')) {
    if ($testText -notmatch [regex]::Escape($testName)) { throw "Missing required test: $testName" }
}

Write-Output 'TASK5_STATIC_OK production_manifest=ok debug_probe_isolated=ok crypto_storage=ok auth_boundaries=ok ui_motion_onboarding=ok synthetic_tests=present'
