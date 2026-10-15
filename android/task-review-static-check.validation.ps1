$ErrorActionPreference = 'Stop'

$checker = Join-Path $PSScriptRoot 'task-review-static-check.ps1'
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
        throw "Task Review checker rejected the current Review surface:`n$output"
    }
    if ($output -notmatch 'TASK_REVIEW_STATIC_OK') {
        throw "Task Review checker did not emit its success marker:`n$output"
    }
    if ($output -notmatch 'worker_review_routes=present(?:\r?\n|$)') {
        throw "Task Review checker did not truthfully report wired Worker Review routes:`n$output"
    }
}
finally {
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
}

Write-Output 'TASK_REVIEW_STATIC_VALIDATION_OK worker_review_routes=present'
