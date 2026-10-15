param(
    [switch]$RequireAndroidToolchain
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$docs = Join-Path $repoRoot 'docs\android-validation.md'
$product = Join-Path $PSScriptRoot 'PRODUCT.md'
$manifest = Join-Path $PSScriptRoot 'app\src\main\AndroidManifest.xml'
$releaseManifest = Join-Path $PSScriptRoot 'app\src\release\AndroidManifest.xml'
$backupRules = Join-Path $PSScriptRoot 'app\src\main\res\xml\backup_rules.xml'
$extractionRules = Join-Path $PSScriptRoot 'app\src\main\res\xml\data_extraction_rules.xml'
$wrapper = Join-Path $PSScriptRoot 'gradlew.bat'
$wrapperJar = Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar'

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file is missing: $Path"
    }
}

function Assert-Contains([string]$Text, [string]$Needle, [string]$Label) {
    if ($Text.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "Missing ${Label}: $Needle"
    }
}

foreach ($path in @($docs, $product, $manifest, $releaseManifest, $backupRules, $extractionRules, $wrapper)) {
    Assert-File $path
}

$validation = Get-Content -Raw -LiteralPath $docs
$androidProduct = Get-Content -Raw -LiteralPath $product
$mainXml = Get-Content -Raw -LiteralPath $manifest
$releaseXml = Get-Content -Raw -LiteralPath $releaseManifest
$backupXml = Get-Content -Raw -LiteralPath $backupRules
$extractionXml = Get-Content -Raw -LiteralPath $extractionRules

foreach ($id in 1..18) {
    $featureId = "F{0:D2}" -f $id
    Assert-Contains $validation ("| $featureId |") "$featureId parity ledger row"
}
foreach ($section in @(
    'Owner / capture boundary',
    'Offline, logout, and cache recovery',
    'Migration, backup, and restore gate',
    'Signing and release gate',
    'CMB outcome',
    'Future validation commands'
)) {
    Assert-Contains $validation $section "validation section"
}
foreach ($phrase in @('owner credentials', 'capture credentials', 'logout', 'CMB', 'same-ledger')) {
    Assert-Contains $androidProduct $phrase "Android product recovery/boundary note"
}

Assert-Contains $mainXml 'android:allowBackup="false"' 'main manifest backup fail-closed setting'
Assert-Contains $mainXml 'android:dataExtractionRules="@xml/data_extraction_rules"' 'data extraction rules reference'
Assert-Contains $releaseXml 'android.permission.INTERNET' 'release network permission'
Assert-Contains $backupXml '<exclude domain="database" path="." />' 'legacy database backup exclusion'
Assert-Contains $extractionXml '<device-transfer>' 'device-transfer extraction policy'
Assert-Contains $extractionXml '<exclude domain="database" path="." />' 'device-transfer database exclusion'

$toolchainAvailable = (Test-Path -LiteralPath $wrapperJar -PathType Leaf)
if ($RequireAndroidToolchain -and -not $toolchainAvailable) {
    throw "Android validation requires $wrapperJar; the Gradle wrapper JAR is unavailable in this checkout. Supply it before running Gradle."
}

$toolchainState = if ($toolchainAvailable) { 'available' } else { 'gated-wrapper-jar-missing' }
Write-Output "TASK17_STATIC_OK parity=F01-F18 backup=fail-closed toolchain=$toolchainState"
