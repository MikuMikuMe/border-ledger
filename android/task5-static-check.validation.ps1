$ErrorActionPreference = 'Stop'

$checker = Join-Path $PSScriptRoot 'task5-static-check.ps1'
$checkerText = Get-Content -Raw -LiteralPath $checker
$forbiddenSection = [regex]::Match(
    $checkerText,
    '(?s)\$forbiddenPatterns\s*=\s*@\(.*?\n\)\s*\$forbiddenMatches'
).Value
if ([string]::IsNullOrWhiteSpace($forbiddenSection)) {
    throw 'Task 5 checker does not expose a scoped forbidden-API list.'
}
foreach ($requiredForbiddenApi in @('READ_SMS', 'AccessibilityService', 'AlarmManager', 'startForeground', 'android\.util\.Log', 'println')) {
    if (-not $forbiddenSection.Contains($requiredForbiddenApi)) {
        throw "Task 5 checker dropped the fail-closed forbidden API assertion: $requiredForbiddenApi"
    }
}
if ($forbiddenSection -match 'NotificationListenerService|HttpURLConnection|java\.net\.URL|\bTransport\b') {
    throw 'Task 5 checker broadened the forbidden list into the approved listener or Task 12 owner transport boundary.'
}
$forbiddenPatterns = [regex]::Matches($forbiddenSection, "(?m)^\s*'([^']+)'(?:,)?\s*$") | ForEach-Object {
    $_.Groups[1].Value
}
foreach ($sample in @(
    [pscustomobject]@{ Label = 'SMS'; Text = 'check(READ_SMS)' },
    [pscustomobject]@{ Label = 'accessibility'; Text = 'class Scraper : AccessibilityService()' },
    [pscustomobject]@{ Label = 'alarm'; Text = 'val manager = AlarmManager' },
    [pscustomobject]@{ Label = 'foreground'; Text = 'startForeground(1, notification)' },
    [pscustomobject]@{ Label = 'logging'; Text = 'android.util.Log.d("tag", "value")' },
    [pscustomobject]@{ Label = 'println'; Text = 'println("value")' }
)) {
    if (-not ($forbiddenPatterns | Where-Object { $sample.Text -match $_ } | Select-Object -First 1)) {
        throw "Task 5 checker failed to catch synthetic $($sample.Label) usage."
    }
}
foreach ($allowedText in @(
    'class BankNotificationListenerService : NotificationListenerService()',
    'private val connection: HttpURLConnection',
    'URL(request.url).openConnection()',
    'throw TransportFailure.Retryable'
)) {
    if ($forbiddenPatterns | Where-Object { $allowedText -match $_ } | Select-Object -First 1) {
        throw "Task 5 checker misclassified an approved listener/Task 12 transport snippet: $allowedText"
    }
}

$stdoutPath = [System.IO.Path]::GetTempFileName()
$stderrPath = [System.IO.Path]::GetTempFileName()
try {
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', "`"$checker`""
    ) -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -Wait -WindowStyle Hidden
    $output = (Get-Content -Raw -LiteralPath $stdoutPath) + (Get-Content -Raw -LiteralPath $stderrPath)
    if ($process.ExitCode -ne 0) {
        throw "Task 5 checker rejected the current production surface:`n$output"
    }
    if ($output -notmatch 'TASK5_STATIC_OK') {
        throw "Task 5 checker did not emit its success marker:`n$output"
    }
}
finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}

Write-Output 'TASK5_STATIC_VALIDATION_OK required_listener_and_task12_transport_are_not_false_positives'
