$ErrorActionPreference = 'Stop'

function Assert-Contains([string]$Path, [string]$Text, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content -notmatch [regex]::Escape($Text)) { throw "$Label is missing" }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$worker = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/sync/UploadWorker.kt'
$scheduler = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/sync/UploadScheduler.kt'
$api = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/api/CaptureUploadApi.kt'
$intake = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/local/CaptureIntakeStore.kt'
$health = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/capture/CaptureHealth.kt'
$container = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/AppContainer.kt'
$repository = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/LedgerRepository.kt'

Assert-Contains $worker 'CaptureUploadCoordinator' 'injectable upload coordinator'
Assert-Contains $worker 'CaptureIntakeLimits.MAX_BATCH_EVENTS' '50-event ceiling'
Assert-Contains $worker 'batchEncoder' 'injectable 128 KiB JSON sizing seam'
Assert-Contains $api 'CaptureUploadJson.encode' '128 KiB JSON sizing'
Assert-Contains $worker 'store.applyAcknowledgements' 'ack persistence'
Assert-Contains $worker 'store.purgeAcknowledged' 'post-ack purge'
Assert-Contains $worker 'Mutex()' 'coordinator serialization'
Assert-Contains $worker 'is UploadSyncResult.Retry -> Result.retry()' 'WorkManager retry result'
Assert-Contains $scheduler 'ExistingWorkPolicy.KEEP' 'unique WorkManager policy'
Assert-Contains $scheduler 'NetworkType.CONNECTED' 'network constraint'
Assert-Contains $api '200 -> parseSuccess' 'Task 8 per-item acknowledgement response'
Assert-Contains $api '401, 403 -> CaptureUploadResult.PairingRequired' 'credential pause classification'
Assert-Contains $api '409 -> CaptureUploadResult.Permanent' 'content conflict classification'
Assert-Contains $api '429 -> CaptureUploadResult.Retryable' 'rate-limit classification'
Assert-Contains $api 'in 500..599 -> CaptureUploadResult.Retryable' 'server retry classification'
Assert-Contains $api 'Retry-After' 'Retry-After parsing'
Assert-Contains $api 'decoded.eventId == it.eventId' 'immutable payload identity validation'
Assert-Contains $intake 'interface CaptureUploadStore' 'single intake upload DAO boundary'
Assert-Contains $intake 'CaptureAcknowledgementDisposition.REVIEW' 'review quarantine persistence'
Assert-Contains $intake 'acknowledgementReceiptId' 'receipt persistence'
Assert-Contains $health 'lastSuccessfulUploadAtMillis' 'last successful upload health'
Assert-Contains $health 'pairingRenewalRequired' 'pairing renewal health'
Assert-Contains $health 'lastCacheSnapshotAtMillis' 'cache snapshot health'
Assert-Contains $container 'captureHealth.pauseMonitoring()' 'logout monitoring pause wiring'
Assert-Contains $repository 'ownerSession.state.value !is OwnerSessionState.SignedIn' 'owner-only cache boundary'
Assert-Contains $repository 'readCache.clear()' 'signed-out cache clear'
Assert-Contains (Join-Path $root 'app/src/test/java/com/lofuyu/borderledger/sync/UploadCoordinatorTest.kt') 'concurrentForegroundAndBackgroundSyncShareOneImmutableUpload' 'coordinator regression tests'
Assert-Contains (Join-Path $root 'app/src/test/java/com/lofuyu/borderledger/api/CaptureUploadHttpClientTest.kt') 'http200PerItemConflictIsParsedAsAStableQuarantineableAck' 'HTTP regression tests'

Write-Output 'TASK9_STATIC_OK coordinator=injectable serialized=true batch=50 json=128KiB ack-before-purge=true partial-ack=true retry-classification=true pairing-pause=true cache-boundary=true logout-pause=true tests=present'
