$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$shell = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt'
$model = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerUiModel.kt'
$test = Join-Path $root 'app/src/test/java/com/lofuyu/borderledger/ui/ledger/LedgerDestinationTask12Test.kt'

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing required file: $Path" }
}

function Assert-Contains([string]$Path, [string]$Needle, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content.IndexOf($Needle, [System.StringComparison]::Ordinal) -lt 0) { throw "Missing ${Label}: $Needle" }
}

foreach ($path in @($shell, $model, $test)) { Assert-File $path }
Assert-Contains $model 'Import("Import", "Import")' 'Import destination'
Assert-Contains $model 'Export("Export", "Export")' 'Export destination'
Assert-Contains $shell 'onOpenImport: () -> Unit' 'Import navigation callback'
Assert-Contains $shell 'onOpenExport: () -> Unit' 'Export navigation callback'
Assert-Contains $shell 'onClick = onOpenImport' 'reachable statement import action'
Assert-Contains $shell 'onClick = onOpenExport' 'reachable ledger export action'
Assert-Contains $shell 'LedgerDestination.Import' 'Import destination rendering/back path'
Assert-Contains $shell 'LedgerDestination.Export' 'Export destination rendering/back path'
Assert-Contains $test 'primaryLedgerDestinations.none' 'navigation regression coverage'

Write-Output 'TASK11_12_NAVIGATION_STATIC_OK import_reachable=true export_reachable=true back_path=true regression_test=true'
