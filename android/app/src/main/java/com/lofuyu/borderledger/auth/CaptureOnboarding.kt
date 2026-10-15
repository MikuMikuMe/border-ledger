package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.api.CaptureApi
import com.lofuyu.borderledger.api.CaptureApiHealth
import com.lofuyu.borderledger.api.CaptureInstrumentHint
import com.lofuyu.borderledger.api.CapturePairingRequest
import com.lofuyu.borderledger.api.CaptureScopeConsent
import com.lofuyu.borderledger.api.TransportFailure
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant

enum class NotificationAccessState {
    Unknown,
    Missing,
    Granted,
}

enum class AppNotificationPermissionState {
    Unknown,
    Blocked,
    Granted,
}

enum class SourceTestResult {
    NotRun,
    Awaiting,
    SyntheticOnly,
    Passed,
    Failed,
    Unsupported,
    Unavailable,
}

enum class CaptureHealth {
    OwnerSessionRequired,
    SourceSelectionRequired,
    NotificationAccessRequired,
    SourceTestRequired,
    ConsentRequired,
    Issuing,
    Ready,
    ImportOnly,
    Paused,
    NeedsRenewal,
    ApiUnavailable,
    Error,
}

data class CaptureSourceProfile(
    val sourceProfileId: String,
    val displayName: String,
    val accountId: String,
    val instrumentLabel: String,
    val currencies: List<String>,
    val instrumentHint: CaptureInstrumentHint? = null,
)

/** Evidence supplied by an actual listener/source-test event, not a UI assertion. */
data class SourceTestEvidence(
    val sourceProfileId: String,
    val accountId: String,
    val currency: String,
    val notificationId: String,
    val observedAt: Instant,
)

data class CaptureOnboardingState(
    val profiles: List<CaptureSourceProfile> = emptyList(),
    val selected: CaptureScopeConsent? = null,
    val selectedInstrumentLabel: String? = null,
    val notificationAccess: NotificationAccessState = NotificationAccessState.Unknown,
    val appNotificationPermission: AppNotificationPermissionState = AppNotificationPermissionState.Unknown,
    val sourceTest: SourceTestResult = SourceTestResult.NotRun,
    val consentRecorded: Boolean = false,
    val health: CaptureHealth = CaptureHealth.OwnerSessionRequired,
    val apiHealth: CaptureApiHealth = CaptureApiHealth.OwnerSessionRequired,
    val credentialExpiresAt: String? = null,
    val sourceConfigRevision: Int? = null,
    val sourceSetupStatus: CaptureSourceSetupStatus = CaptureSourceSetupStatus.Unavailable,
    val sourceSetupMessage: String = CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE,
)

interface OwnerSessionStateProvider {
    val state: StateFlow<OwnerSessionState>
}

/**
 * First-run capture policy. The owner state is read from the real session
 * manager, while capture issue/health calls cross the injected capture API
 * boundary. Login alone cannot issue a capture credential.
 */
class CaptureOnboardingCoordinator(
    private val ownerSession: OwnerSessionStateProvider,
    private val captureApi: CaptureApi,
    private val credentials: CaptureCredentialProvider = VolatileCaptureCredentialProvider(),
    private val profileRepository: CaptureProfileRepository? = null,
    private val deviceName: String = "Border Ledger Android",
) {
    private val _state = MutableStateFlow(CaptureOnboardingState())
    val state: StateFlow<CaptureOnboardingState> = _state.asStateFlow()

    fun syncOwnerSessionState() {
        val signedIn = ownerSession.state.value is OwnerSessionState.SignedIn
        _state.value = if (signedIn) {
            _state.value.recalculate()
        } else {
            _state.value.copy(
                profiles = emptyList(),
                selected = null,
                selectedInstrumentLabel = null,
                apiHealth = CaptureApiHealth.OwnerSessionRequired,
                consentRecorded = false,
                credentialExpiresAt = null,
                sourceConfigRevision = null,
                sourceSetupStatus = CaptureSourceSetupStatus.Unavailable,
                sourceSetupMessage = CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE,
            ).recalculate()
        }
    }

    suspend fun refreshApiHealth() {
        syncOwnerSessionState()
        if (ownerSession.state.value !is OwnerSessionState.SignedIn) return
        refreshSourceProfiles()
        _state.value = _state.value.copy(apiHealth = CaptureApiHealth.Checking).recalculate()
        val health = try {
            captureApi.health()
        } catch (_: TransportFailure.Offline) {
            CaptureApiHealth.Offline
        } catch (_: TransportFailure) {
            CaptureApiHealth.Unavailable
        } catch (_: Exception) {
            CaptureApiHealth.Unavailable
        }
        _state.value = _state.value.copy(apiHealth = health).recalculate()
    }

    suspend fun refreshSourceProfiles() {
        syncOwnerSessionState()
        val repository = profileRepository ?: return
        if (ownerSession.state.value !is OwnerSessionState.SignedIn) return
        val result = try {
            repository.load()
        } catch (_: TransportFailure) {
            CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.DeviceMappingUnavailable)
        } catch (_: Exception) {
            CaptureProfileLoadResult.Unavailable(CaptureProfileUnavailableReason.DeviceMappingUnavailable)
        }
        _state.value = when (result) {
            is CaptureProfileLoadResult.Available -> if (result.profiles.isEmpty()) {
                _state.value.copy(
                    profiles = emptyList(),
                    selected = null,
                    selectedInstrumentLabel = null,
                    consentRecorded = false,
                    credentialExpiresAt = null,
                    sourceConfigRevision = null,
                    sourceSetupStatus = CaptureSourceSetupStatus.Unavailable,
                    sourceSetupMessage = CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE,
                )
            } else {
                _state.value.copy(
                    profiles = result.profiles,
                    selected = null,
                    selectedInstrumentLabel = null,
                    consentRecorded = false,
                    credentialExpiresAt = null,
                    sourceConfigRevision = result.revision,
                    sourceSetupStatus = CaptureSourceSetupStatus.Available,
                    sourceSetupMessage = "",
                )
            }
            is CaptureProfileLoadResult.Unavailable -> _state.value.copy(
                profiles = emptyList(),
                selected = null,
                selectedInstrumentLabel = null,
                consentRecorded = false,
                credentialExpiresAt = null,
                sourceConfigRevision = null,
                sourceSetupStatus = CaptureSourceSetupStatus.Unavailable,
                sourceSetupMessage = result.message,
            )
        }.recalculate()
    }

    fun setProfiles(profiles: List<CaptureSourceProfile>) {
        _state.value = _state.value.copy(
            profiles = profiles,
            selected = null,
            selectedInstrumentLabel = null,
            consentRecorded = false,
            credentialExpiresAt = null,
            sourceConfigRevision = null,
            sourceSetupStatus = if (profiles.isEmpty()) CaptureSourceSetupStatus.Unavailable else CaptureSourceSetupStatus.Available,
            sourceSetupMessage = if (profiles.isEmpty()) CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE else "",
        ).recalculate()
    }

    fun select(profile: CaptureSourceProfile, currency: String) {
        require(profile in _state.value.profiles) { "The source profile was not offered by the server." }
        require(currency in profile.currencies) { "The currency was not offered by the source profile." }
        _state.value = _state.value.copy(
            selected = CaptureScopeConsent(profile.sourceProfileId, profile.accountId, currency, profile.instrumentHint),
            selectedInstrumentLabel = profile.instrumentLabel,
            consentRecorded = false,
        ).recalculate()
    }

    fun setNotificationAccess(value: NotificationAccessState) {
        _state.value = _state.value.copy(notificationAccess = value).recalculate()
    }

    fun setAppNotificationPermission(value: AppNotificationPermissionState) {
        _state.value = _state.value.copy(appNotificationPermission = value)
    }

    fun recordSyntheticSelfTest() {
        _state.value = _state.value.copy(
            sourceTest = SourceTestResult.SyntheticOnly,
            consentRecorded = false,
        ).recalculate()
    }

    /** Requests a real observation; only a listener-supplied evidence event can produce Passed. */
    fun requestSourceTest() {
        val current = _state.value.recalculate()
        if (ownerSession.state.value !is OwnerSessionState.SignedIn || current.selected == null) {
            _state.value = current
            return
        }
        val result = when (current.apiHealth) {
            CaptureApiHealth.Offline, CaptureApiHealth.Unavailable -> SourceTestResult.Unavailable
            else -> SourceTestResult.Awaiting
        }
        _state.value = current.copy(sourceTest = result, consentRecorded = false).recalculate()
    }

    /** Accepts only evidence tied to the currently selected source/account/currency scope. */
    fun observeSourceTest(evidence: SourceTestEvidence) {
        val selected = _state.value.selected
        val matches = selected != null &&
            selected.sourceProfileId == evidence.sourceProfileId &&
            selected.accountId == evidence.accountId &&
            selected.currency == evidence.currency &&
            evidence.notificationId.isNotBlank()
        _state.value = _state.value.copy(
            sourceTest = if (matches) SourceTestResult.Passed else SourceTestResult.Failed,
            consentRecorded = false,
        ).recalculate()
    }

    suspend fun authorizeCapture(consent: Boolean) {
        syncOwnerSessionState()
        var current = _state.value.recalculate()
        if (ownerSession.state.value !is OwnerSessionState.SignedIn) {
            _state.value = current
            return
        }
        if (current.profiles.isEmpty()) {
            _state.value = current.copy(health = CaptureHealth.ImportOnly, consentRecorded = false)
            return
        }
        if (current.selected == null) {
            _state.value = current.copy(health = CaptureHealth.SourceSelectionRequired)
            return
        }
        if (current.notificationAccess != NotificationAccessState.Granted) {
            _state.value = current.copy(health = CaptureHealth.NotificationAccessRequired)
            return
        }
        if (current.sourceTest != SourceTestResult.Passed) {
            _state.value = current.copy(health = CaptureHealth.SourceTestRequired)
            return
        }
        if (!consent) {
            _state.value = current.copy(health = CaptureHealth.ConsentRequired, consentRecorded = false)
            return
        }
        current = current.copy(health = CaptureHealth.Issuing, consentRecorded = true)
        _state.value = current
        try {
            val grant = captureApi.issueCaptureCredential(
                CapturePairingRequest(
                    deviceName = deviceName,
                    sourceScopes = listOf(requireNotNull(current.selected)),
                    explicitConsent = true,
                    expectedRevision = current.sourceConfigRevision ?: 0,
                ),
            )
            credentials.save(
                CaptureCredentialRecord(
                    credential = grant.credential,
                    deviceId = grant.deviceId,
                    generation = grant.generation,
                    expiresAt = grant.expiresAt,
                    revocationCapability = grant.revocationCapability,
                ),
            )
            val apiHealth = runCatching { captureApi.health() }.getOrDefault(CaptureApiHealth.Unavailable)
            _state.value = current.copy(
                health = CaptureHealth.Ready,
                apiHealth = apiHealth,
                credentialExpiresAt = grant.expiresAt,
            ).recalculate()
        } catch (_: TransportFailure.Offline) {
            _state.value = current.copy(health = CaptureHealth.ApiUnavailable, apiHealth = CaptureApiHealth.Offline, consentRecorded = false)
        } catch (_: TransportFailure) {
            _state.value = current.copy(health = CaptureHealth.ApiUnavailable, apiHealth = CaptureApiHealth.Unavailable, consentRecorded = false)
        } catch (_: Exception) {
            _state.value = current.copy(health = CaptureHealth.Error, consentRecorded = false)
        }
    }

    fun pause() {
        _state.value = _state.value.copy(health = CaptureHealth.Paused)
    }

    fun resume() {
        _state.value = _state.value.recalculate()
    }

    private fun CaptureOnboardingState.recalculate(): CaptureOnboardingState {
        val ownerSignedIn = ownerSession.state.value is OwnerSessionState.SignedIn
        val health = when {
            !ownerSignedIn -> CaptureHealth.OwnerSessionRequired
            profiles.isEmpty() -> CaptureHealth.ImportOnly
            selected == null -> CaptureHealth.SourceSelectionRequired
            notificationAccess != NotificationAccessState.Granted -> CaptureHealth.NotificationAccessRequired
            sourceTest != SourceTestResult.Passed -> if (sourceTest == SourceTestResult.Unsupported) CaptureHealth.ImportOnly else CaptureHealth.SourceTestRequired
            !consentRecorded -> CaptureHealth.ConsentRequired
            apiHealth == CaptureApiHealth.Offline || apiHealth == CaptureApiHealth.Unavailable -> CaptureHealth.ApiUnavailable
            else -> CaptureHealth.Ready
        }
        return copy(health = health)
    }
}

private class VolatileCaptureCredentialProvider : CaptureCredentialProvider {
    private var value: CaptureCredentialRecord? = null
    override suspend fun current() = value
    override suspend fun save(value: CaptureCredentialRecord) { this.value = value }
    override suspend fun clear() { value = null }
}
