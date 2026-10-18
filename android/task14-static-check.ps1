$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$launcher = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/bank/OfficialPlaidLinkLauncher.kt'
$coordinator = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/bank/PlaidLinkCoordinator.kt'
$activity = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/react/BorderLedgerReactActivity.kt'
$build = Join-Path $root 'app/build.gradle.kts'

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing required file: $Path" }
}

function Assert-Contains([string]$Path, [string]$Needle, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content.IndexOf($Needle, [System.StringComparison]::Ordinal) -lt 0) {
        throw "Missing ${Label}: $Needle"
    }
}

function Assert-NotContains([string]$Path, [string]$Needle, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content.IndexOf($Needle, [System.StringComparison]::Ordinal) -ge 0) {
        throw "Unexpected ${Label}: $Needle"
    }
}

foreach ($path in @($launcher, $coordinator, $activity, $build)) { Assert-File $path }

Assert-Contains $launcher 'registerForActivityResult(OpenPlaidLink())' 'official Activity Result bridge'
Assert-Contains $launcher 'onOrphanedResult' 'ActivityResult recovery handoff'
Assert-Contains $launcher 'Plaid.createPlaidLinkSession' 'session-based Link API'
Assert-Contains $launcher 'linkTokenConfiguration' 'server-issued Link token configuration'
Assert-Contains $launcher 'withTimeoutOrNull' 'bounded SDK preload'
Assert-Contains $launcher 'pendingResult' 'suspend result handoff'
Assert-Contains $launcher 'result.publicToken' 'public-token-only result boundary'
Assert-Contains $launcher 'PlaidLinkResult.Canceled' 'explicit cancellation mapping'
Assert-Contains $launcher 'PlaidLinkResult.Failed' 'explicit SDK error mapping'
Assert-NotContains $launcher 'accessToken' 'provider access-token handling'
Assert-NotContains $launcher 'clientSecret' 'Plaid secret handling'
Assert-Contains $coordinator 'fun attachLauncher' 'Activity bridge attachment boundary'
Assert-Contains $activity 'OfficialPlaidLinkLauncher(this)' 'production bridge wiring'
Assert-Contains $build 'implementation(libs.plaid.link.sdk)' 'official SDK dependency'

$versions = Join-Path $root 'gradle/libs.versions.toml'
Assert-File $versions
Assert-Contains $versions 'plaidLink = "6.2.2"' 'current Plaid SDK patch release'

Write-Output 'TASK14_SOURCE_WIRING_STATIC_OK official_sdk_dependency=true activity_result_registration=true recovery_handoff_source=true public_token_boundary_source=true no_provider_secret_source=true build_verified=false'
