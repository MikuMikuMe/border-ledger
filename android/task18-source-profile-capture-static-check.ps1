$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$application = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/BorderLedgerApplication.kt'
$container = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/AppContainer.kt'
$profileContract = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/auth/CaptureProfileRepository.kt'
$sourceProfile = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/capture/SourceProfile.kt'
$parserRegistry = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/parser/SourceParserRegistry.kt'
$profileAdapter = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/accounts/devices/DeviceManagementRepository.kt'
$mobileDtos = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/api/MobileDtos.kt'
$captureTransport = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/api/HttpWorkerCaptureApi.kt'
$onboarding = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/auth/CaptureOnboarding.kt'
$onboardingScreen = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/onboarding/CaptureOnboardingScreen.kt'
$devicePresentation = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/accounts/devices/DeviceManagementPresentation.kt'
$deviceScreen = Join-Path $root 'app/src/main/java/com/lofuyu/borderledger/ui/accounts/devices/DeviceManagementScreen.kt'
$workerMobile = Join-Path (Split-Path -Parent $root) 'worker/mobile.ts'
$contract = Join-Path (Split-Path -Parent $root) 'contracts/mobile-v1.openapi.yaml'

function Assert-File([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing required file: $Path" }
}

function Assert-Contains([string]$Path, [string]$Needle, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content.IndexOf($Needle, [System.StringComparison]::Ordinal) -lt 0) { throw "Missing ${Label}: $Needle" }
}

function Assert-NotContains([string]$Path, [string]$Needle, [string]$Label) {
    $content = Get-Content -Raw -LiteralPath $Path
    if ($content.IndexOf($Needle, [System.StringComparison]::Ordinal) -ge 0) { throw "Unexpected ${Label}: $Needle" }
}

foreach ($path in @($application, $container, $profileContract, $sourceProfile, $parserRegistry, $profileAdapter, $mobileDtos, $captureTransport, $onboarding, $onboardingScreen, $devicePresentation, $deviceScreen, $workerMobile, $contract)) {
    Assert-File $path
}

Assert-Contains $application 'deviceIdentity(this)' 'stable application device identity wiring'
Assert-Contains $application 'commit()' 'durable device identity persistence'
Assert-Contains $container 'deviceId: String = deviceIdentity(context)' 'injectable device identity'
Assert-Contains $container 'deviceId = deviceId' 'owner-session device binding'
Assert-Contains $container 'DeviceCaptureProfileRepository' 'capture profile repository wiring'
Assert-Contains $profileContract 'interface CaptureProfileRepository' 'capture profile repository boundary'
Assert-Contains $profileContract 'CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE' 'explicit import-only message'
Assert-Contains $sourceProfile 'CurrencyRegistry.DEFAULT_ENTRIES.keys' 'shared currency registry coverage'
if ((Get-Content -Raw -LiteralPath $sourceProfile).Contains('setOf("CAD", "CNY", "USD", "HKD")')) { throw 'Source profile still hardcodes the initial currency list.' }
Assert-Contains $sourceProfile 'CMB_UNSUPPORTED' 'CMB disabled source kind'
Assert-Contains $parserRegistry 'SourceProfileKind.CMB_UNSUPPORTED' 'CMB parser gate'
Assert-Contains $parserRegistry 'UnsupportedSourceParser()' 'CMB fail-closed parser'
Assert-Contains $profileAdapter 'devices.readDevices()' 'owner device mapping load'
Assert-Contains $profileAdapter 'SourceProfileKind.BOC_CREDIT_CARD' 'supported parser allow-list'
Assert-Contains $profileAdapter 'CaptureProfileLoadResult.Unavailable' 'fail-closed profile mapping'
Assert-Contains $profileAdapter 'local.instrumentHint.matches(mapping.instrumentHint)' 'exact instrument consent boundary'
Assert-Contains $mobileDtos 'val instrumentHint: CaptureInstrumentHint? = null' 'pairing request instrument hint field'
Assert-Contains $captureTransport 'instrumentHint?.let { hint ->' 'pairing JSON instrument hint mapping'
Assert-Contains $captureTransport 'put("kind", hint.kind)' 'exact instrument hint kind transport'
Assert-Contains $captureTransport 'put("value", hint.value)' 'exact instrument hint value transport'
Assert-Contains $onboarding 'sourceScopes = listOf(requireNotNull(current.selected))' 'exact instrument hint request forwarding'
Assert-NotContains $profileAdapter 'CapturePairingRequest currently carries no instrument hint' 'blanket instrument hint rejection'
Assert-Contains $onboarding 'profileRepository: CaptureProfileRepository?' 'profile load injection'
Assert-Contains $onboarding 'CaptureHealth.ImportOnly' 'import-only health gate'
Assert-Contains $onboarding 'current.profiles.isEmpty()' 'credential issuance profile gate'
Assert-Contains $onboarding 'expectedRevision = current.sourceConfigRevision ?: 0' 'owner mapping revision forwarding'
Assert-Contains $onboardingScreen 'CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE' 'visible import-only onboarding state'
Assert-Contains $onboardingScreen 'LazyRow' 'scrollable full currency choice'
Assert-Contains $devicePresentation 'canOpenSecureCaptureSetup' 'device action gate'
Assert-Contains $devicePresentation 'SOURCE_SETUP_UNAVAILABLE_REASON' 'visible device limitation'
Assert-Contains $deviceScreen 'if (device.canOpenSecureCaptureSetup())' 'no unavailable device action'
Assert-Contains $devicePresentation 'does not authorize or renew capture' 'secure coordinator boundary'
Assert-Contains $workerMobile '/api/mobile/v1/devices/self/source-config' 'existing source-config route'
Assert-Contains $workerMobile "authenticateOwner(bearer(request), env.DB, config, 'devices:manage')" 'owner-authenticated source-config route'
Assert-Contains $contract '/api/mobile/v1/devices/self/source-config:' 'contract source-config route'
Assert-Contains $contract 'x-required-scope: devices:manage' 'contract owner scope'

Write-Output 'TASK18_STATIC_OK owner_device_binding=true owner_mapping_load=true import_only_gate=true no_fake_authorize=true cmb_allowlist=true'
