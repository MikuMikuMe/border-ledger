$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$reviewRepository = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/review/ReviewRepository.kt'
$reviewViewModel = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/review/ReviewViewModel.kt'
$reviewScreen = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/review/ReviewScreen.kt'
$interceptors = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/auth/CredentialInterceptors.kt'
$container = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/AppContainer.kt'
$activity = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/MainActivity.kt'
$shell = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/ledger/LedgerShell.kt'
$repositoryTests = Join-Path $root 'app/src/test/java/com/lofuyu/borderledger/review/ReviewRepositoryTest.kt'
$viewModelTests = Join-Path $root 'app/src/test/java/com/lofuyu/borderledger/review/ReviewViewModelTest.kt'
$worker = Join-Path (Split-Path -Parent $root) 'worker/mobile.ts'
$workerReview = Join-Path (Split-Path -Parent $root) 'worker/mobile-review.ts'
$mobileAuth = Join-Path (Split-Path -Parent $root) 'worker/mobile-auth.ts'

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing required file: $Path" }
}

function Assert-Contains([string]$Path, [string]$Needle, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content.IndexOf($Needle, [System.StringComparison]::Ordinal) -lt 0) { throw "Missing ${Label}: $Needle" }
}

function Assert-TextContains([string]$Text, [string]$Needle, [string]$Label) {
    if ($Text.IndexOf($Needle, [System.StringComparison]::Ordinal) -lt 0) { throw "Missing ${Label}: $Needle" }
}

function Assert-TextNotContains([string]$Text, [string]$Needle, [string]$Label) {
    if ($Text.IndexOf($Needle, [System.StringComparison]::Ordinal) -ge 0) { throw "Unexpected ${Label}: $Needle" }
}

function Assert-RouteWiring([string]$Source, [string]$RouteGuard, [string]$RequiredScope, [string]$Handler, [string]$Label) {
    $start = $Source.IndexOf($RouteGuard, [System.StringComparison]::Ordinal)
    if ($start -lt 0) { throw "Missing ${Label} route guard: $RouteGuard" }
    $nextRoute = $Source.IndexOf('    if (request.method ===', $start + $RouteGuard.Length, [System.StringComparison]::Ordinal)
    $blockEnd = if ($nextRoute -ge 0) { $nextRoute } else { $Source.Length }
    $block = $Source.Substring($start, $blockEnd - $start)
    Assert-TextContains $block "authenticateOwner(bearer(request), env.DB, config, '$RequiredScope')" "${Label} owner authentication"
    Assert-TextContains $block "authorizeMobileRoute(owner, url.pathname, '$RequiredScope')" "${Label} owner authorization"
    Assert-TextContains $block $Handler "${Label} handler"
}

foreach ($path in @($reviewRepository, $reviewViewModel, $reviewScreen, $interceptors, $container, $activity, $shell, $repositoryTests, $viewModelTests, $worker, $workerReview, $mobileAuth)) {
    Assert-File $path
}

foreach ($check in @(
    @($reviewRepository, '/api/mobile/v1/alerts', 'alert read/review route'),
    @($reviewRepository, '/api/mobile/v1/transactions/', 'annotation route'),
    @($reviewRepository, 'expectedRevision', 'optimistic revision field'),
    @($reviewRepository, 'ReviewJson.decodeAck', 'acknowledgement decoding'),
    @($reviewRepository, 'ReviewRevisionConflict', 'revision conflict mapping'),
    @($reviewRepository, 'ReviewLimits.MAX_PAGE_ITEMS', 'bounded page'),
    @($reviewRepository, 'ReviewSourceEvidenceDto', 'source evidence DTO'),
    @($reviewRepository, 'ReviewCandidateDto', 'candidate comparison DTO'),
    @($reviewRepository, 'ReviewLinkActionDto', 'link action DTO'),
    @($reviewRepository, 'candidateTransactionId', 'candidate mutation field'),
    @($reviewRepository, 'decodeCandidates', 'bounded candidate decoding'),
    @($reviewViewModel, 'refreshPage', 'authoritative refresh'),
    @($reviewViewModel, 'no change was applied', 'truthful action errors'),
    @($reviewViewModel, 'SNAPSHOT_REVIEW_ACTION_DISABLED_REASON', 'snapshot review gate'),
    @($reviewViewModel, 'SNAPSHOT_ANNOTATION_DISABLED_REASON', 'snapshot annotation gate'),
    @($reviewViewModel, 'LIVE_ANNOTATION_DISABLED_REASON', 'live annotation gate'),
    @($reviewViewModel, 'CLASSIFICATION_UNSUPPORTED_REASON', 'unsupported classification state'),
    @($reviewViewModel, 'LINK_ACTION_UNAVAILABLE_REASON', 'precise link gate'),
    @($reviewViewModel, 'LINK_RELATION_UNSUPPORTED_REASON', 'unsupported link relation state'),
    @($reviewViewModel, 'candidateTransactionId = linkAction?.candidateTransactionId', 'candidate link action wiring'),
    @($reviewScreen, 'onResolve(alert, ReviewDecision.KEEP_SEPARATE)', 'real keep-separate action'),
    @($reviewScreen, 'onResolve(alert, ReviewDecision.IGNORE)', 'real ignore action'),
    @($reviewScreen, 'onResolve(alert, ReviewDecision.LINK)', 'real candidate link action'),
    @($reviewScreen, 'alert.affectedMoney', 'visible affected money'),
    @($reviewScreen, 'alert.sourceEvidence', 'visible source evidence'),
    @($reviewScreen, 'Candidate transaction comparison', 'visible candidate comparison'),
    @($reviewScreen, 'SNAPSHOT_REVIEW_ACTION_DISABLED_REASON', 'visible snapshot reason'),
    @($reviewScreen, 'Category/note annotation — disabled', 'visible annotation gate'),
    @($interceptors, 'path == "/api/mobile/v1/alerts" && method != "GET"', 'owner/capture alert method boundary'),
    @($interceptors, 'path == "/api/mobile/v1/alerts" && request.method == "POST"', 'capture write-only alert boundary'),
    @($container, 'val reviewRepository: ReviewRepository', 'container Review wiring'),
    @($activity, 'reviewRepository = container.reviewRepository', 'activity Review wiring'),
    @($shell, 'reviewRepository: ReviewRepository', 'shell Review constructor'),
    @($shell, 'ReviewDestination(snapshotState, reviewViewModel)', 'Review destination wiring'),
    @($shell, 'ReviewScreen(', 'Review-only screen call'),
    @($repositoryTests, 'decodeRejectsMalformedOrOversizedAlertPage', 'repository bounded test'),
    @($repositoryTests, 'decodeRejectsUnboundedReviewEvidence', 'repository evidence bounds test'),
    @($repositoryTests, 'linkMutationCarriesCandidateTargetRelationAllocationAndExpectedRevision', 'repository link mutation test'),
    @($viewModelTests, 'conflictRetainsRowsAndRefreshesAuthoritativePage', 'ViewModel conflict test')
)) {
    Assert-Contains $check[0] $check[1] $check[2]
}

$reviewSource = (Get-Content -Raw -LiteralPath $reviewRepository) + (Get-Content -Raw -LiteralPath $reviewViewModel) + (Get-Content -Raw -LiteralPath $reviewScreen)
foreach ($forbidden in @('/api/mobile/v1/devices', '/api/mobile/v1/exports', '/api/mobile/v1/imports', '/api/mobile/v1/recurring')) {
    if ($reviewSource.IndexOf($forbidden, [System.StringComparison]::Ordinal) -ge 0) { throw "Review package reached outside its route scope: $forbidden" }
}
if ($reviewScreen -and (Get-Content -Raw -LiteralPath $reviewScreen) -match 'onClick\s*=\s*\{\s*\}') {
    throw 'Review UI contains a no-op click callback.'
}

$workerText = Get-Content -Raw -LiteralPath $worker
$workerReviewText = Get-Content -Raw -LiteralPath $workerReview
$mobileAuthText = Get-Content -Raw -LiteralPath $mobileAuth
Assert-Contains $mobileAuth "'ledger:read'," 'owner read scope'
Assert-Contains $mobileAuth "'ledger:review'," 'owner review scope'
Assert-Contains $workerReview 'export async function readMobileAlertPage' 'Worker alert page handler'
Assert-Contains $workerReview 'export async function applyMobileAlertReview' 'Worker alert review handler'
Assert-Contains $workerReview 'export async function annotateMobileTransaction' 'Worker annotation handler'
Assert-Contains $workerReview 'MAX_PROVENANCE_PER_ALERT' 'bounded provenance'
Assert-Contains $workerReview 'MAX_CANDIDATES_PER_ALERT' 'bounded candidates'
Assert-Contains $workerReview 'MAX_LINKS_PER_ALERT' 'bounded links'
Assert-Contains $workerReview 'alert_projection_provenance' 'projection provenance read'
Assert-Contains $workerReview 'statement_reconciliation_candidates' 'reconciliation candidate read'
Assert-Contains $workerReview 'sourceEvidence' 'source evidence response'
Assert-Contains $workerReview 'affectedMoney' 'affected money response'
Assert-Contains $workerReview 'candidateTransactionId' 'candidate link target'
Assert-Contains $workerReview 'linkAction' 'safe link action gate'
Assert-Contains $workerReview 'openCandidateForReview' 'durable candidate validation'
Assert-TextNotContains $workerReview 'UPDATE alert_events' 'source evidence mutation'
Assert-TextNotContains $workerReview 'DELETE FROM alert_events' 'source evidence deletion'
Assert-TextNotContains $workerReview 'UPDATE transaction_source_records' 'source record mutation'
Assert-TextNotContains $workerReview 'DELETE FROM transaction_source_records' 'source record deletion'
Assert-TextContains $workerText 'const mobileAlertReviewMatch = url.pathname.match(/^\/api\/mobile\/v1\/alerts\/([^/]+)\/review$/);' 'PATCH alert review route matcher'
Assert-TextContains $workerText 'const mobileAnnotationMatch = url.pathname.match(/^\/api\/mobile\/v1\/transactions\/([^/]+)\/annotation$/);' 'PATCH annotation route matcher'
Assert-RouteWiring $workerText "if (request.method === 'GET' && url.pathname === '/api/mobile/v1/alerts') {" 'ledger:read' 'readMobileAlertPage(' 'GET alerts'
Assert-RouteWiring $workerText "if (request.method === 'PATCH' && mobileAlertReviewMatch) {" 'ledger:review' 'applyMobileAlertReview(' 'PATCH alert review'
Assert-RouteWiring $workerText "if (request.method === 'PATCH' && mobileAnnotationMatch) {" 'ledger:review' 'annotateMobileTransaction(' 'PATCH annotation'
$workerRouteState = 'present'

Write-Output "TASK_REVIEW_STATIC_OK bounded_dto=true owner_get_alerts=true capture_post_alerts_rejected=true revision_actions=true snapshot_gates=true no_noop_ui=true worker_review_routes=$workerRouteState"
