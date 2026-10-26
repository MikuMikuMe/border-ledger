package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.api.CaptureCredentialGrant
import com.lofuyu.borderledger.api.CaptureApi
import com.lofuyu.borderledger.api.CaptureApiHealth
import com.lofuyu.borderledger.api.CaptureInstrumentHint
import com.lofuyu.borderledger.api.CapturePairingRequest
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class CaptureOnboardingCoordinatorTest {
    @Test
    fun changingSelectedScopeRequiresNewMatchingListenerEvidenceBeforeAuthorization() = runTest {
        val client=FakeCaptureApi()
        val owner=TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z",emptyList(),null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val coordinator=CaptureOnboardingCoordinator(owner,client)
        coordinator.setProfiles(listOf(profile))
        coordinator.select(profile,"CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.observeSourceTest(evidence())
        assertEquals(SourceTestResult.Passed,coordinator.state.value.sourceTest)
        coordinator.select(profile,"CNY")
        coordinator.authorizeCapture(consent=true)
        assertEquals(SourceTestResult.NotRun,coordinator.state.value.sourceTest)
        assertEquals(0,client.issueCalls)
        coordinator.observeSourceTest(evidence().copy(currency="CNY"))
        coordinator.authorizeCapture(consent=true)
        assertEquals(1,client.issueCalls)
        assertEquals("CNY",client.lastRequest?.sourceScopes?.single()?.currency)
    }
    private val profile = CaptureSourceProfile(
        sourceProfileId = "synthetic-source",
        displayName = "Approved source profile",
        accountId = "synthetic-account",
        instrumentLabel = "Selected instrument",
        currencies = listOf("CAD", "CNY"),
    )

    private val hintedProfile = profile.copy(
        instrumentLabel = "card_suffix: 1234",
        instrumentHint = CaptureInstrumentHint("card_suffix", "1234"),
    )

    @Test
    fun loginDoesNotSilentlyAuthorizeCaptureAndSyntheticTestCannotMarkReady() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val coordinator = CaptureOnboardingCoordinator(owner, client)
        coordinator.setProfiles(listOf(profile))
        coordinator.select(profile, "CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.setAppNotificationPermission(AppNotificationPermissionState.Blocked)
        coordinator.recordSyntheticSelfTest()

        assertEquals(CaptureHealth.SourceTestRequired, coordinator.state.value.health)
        assertEquals(SourceTestResult.SyntheticOnly, coordinator.state.value.sourceTest)
        assertEquals(0, client.issueCalls)
    }

    @Test
    fun signedOutOwnerStateBlocksCaptureAuthorization() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedOut())
        val coordinator = CaptureOnboardingCoordinator(owner, client)
        coordinator.setProfiles(listOf(profile))
        coordinator.select(profile, "CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.setAppNotificationPermission(AppNotificationPermissionState.Blocked)
        coordinator.observeSourceTest(evidence())

        coordinator.authorizeCapture(consent = true)

        assertEquals(CaptureHealth.OwnerSessionRequired, coordinator.state.value.health)
        assertEquals(0, client.issueCalls)
    }

    @Test
    fun sourceTestStaysAwaitingUntilObservedEvidence() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val coordinator = CaptureOnboardingCoordinator(owner, client)
        coordinator.setProfiles(listOf(profile))
        coordinator.select(profile, "CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)

        coordinator.requestSourceTest()
        assertEquals(SourceTestResult.Awaiting, coordinator.state.value.sourceTest)
        assertEquals(CaptureHealth.SourceTestRequired, coordinator.state.value.health)
        coordinator.authorizeCapture(consent = true)
        assertEquals(0, client.issueCalls)

        coordinator.observeSourceTest(evidence())
        assertEquals(SourceTestResult.Passed, coordinator.state.value.sourceTest)
    }

    @Test
    fun emptyProfileSetIsImportOnlyAndCannotIssueCaptureCredential() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val coordinator = CaptureOnboardingCoordinator(owner, client)

        coordinator.setProfiles(emptyList())
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.authorizeCapture(consent = true)

        assertEquals(CaptureHealth.ImportOnly, coordinator.state.value.health)
        assertEquals(CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE, coordinator.state.value.sourceSetupMessage)
        assertEquals(0, client.issueCalls)
    }

    @Test
    fun ownerMappingRevisionIsForwardedToTheRealCaptureCoordinator() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val repository = object : CaptureProfileRepository {
            override suspend fun load() = CaptureProfileLoadResult.Available(listOf(profile), revision = 7)
        }
        val coordinator = CaptureOnboardingCoordinator(owner, client, profileRepository = repository)

        coordinator.refreshSourceProfiles()
        coordinator.select(profile, "CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.observeSourceTest(evidence())
        coordinator.authorizeCapture(consent = true)

        assertEquals(7, coordinator.state.value.sourceConfigRevision)
        assertEquals(7, client.lastRequest?.expectedRevision)
    }

    @Test
    fun selectedInstrumentHintIsForwardedWithOwnerMappingRevision() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val repository = object : CaptureProfileRepository {
            override suspend fun load() = CaptureProfileLoadResult.Available(listOf(hintedProfile), revision = 11)
        }
        val coordinator = CaptureOnboardingCoordinator(owner, client, profileRepository = repository)

        coordinator.refreshSourceProfiles()
        coordinator.select(hintedProfile, "CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.observeSourceTest(evidence())
        coordinator.authorizeCapture(consent = true)

        assertEquals(CaptureInstrumentHint("card_suffix", "1234"), client.lastRequest?.sourceScopes?.single()?.instrumentHint)
        assertEquals(11, client.lastRequest?.expectedRevision)
    }

    @Test
    fun emptyAvailableProfileResultStillRemainsImportOnly() = runTest {
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val coordinator = CaptureOnboardingCoordinator(
            ownerSession = owner,
            captureApi = FakeCaptureApi(),
            profileRepository = object : CaptureProfileRepository {
                override suspend fun load() = CaptureProfileLoadResult.Available(emptyList(), revision = 9)
            },
        )

        coordinator.refreshSourceProfiles()

        assertEquals(CaptureHealth.ImportOnly, coordinator.state.value.health)
        assertEquals(CaptureSourceSetupStatus.Unavailable, coordinator.state.value.sourceSetupStatus)
        assertEquals(null, coordinator.state.value.sourceConfigRevision)
    }

    @Test
    fun explicitConsentAndRealSourceTestAreRequiredBeforeCredentialIssuance() = runTest {
        val client = FakeCaptureApi()
        val owner = TestOwnerStateProvider(OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val coordinator = CaptureOnboardingCoordinator(owner, client)
        coordinator.setProfiles(listOf(profile))
        coordinator.select(profile, "CAD")
        coordinator.setNotificationAccess(NotificationAccessState.Granted)
        coordinator.observeSourceTest(evidence())

        coordinator.authorizeCapture(consent = false)
        assertEquals(CaptureHealth.ConsentRequired, coordinator.state.value.health)
        assertEquals(0, client.issueCalls)

        coordinator.authorizeCapture(consent = true)
        assertEquals(CaptureHealth.Ready, coordinator.state.value.health)
        assertEquals(1, client.issueCalls)
        assertEquals(CaptureApiHealth.Ready, coordinator.state.value.apiHealth)
        assertEquals(AppNotificationPermissionState.Unknown, coordinator.state.value.appNotificationPermission)
        assertEquals(true, client.lastRequest?.explicitConsent)
        assertEquals(listOf(com.lofuyu.borderledger.api.CaptureScopeConsent("synthetic-source", "synthetic-account", "CAD")), client.lastRequest?.sourceScopes)
    }

    private fun evidence() = SourceTestEvidence(
        sourceProfileId = profile.sourceProfileId,
        accountId = profile.accountId,
        currency = "CAD",
        notificationId = "synthetic-observation",
        observedAt = Instant.parse("2026-10-13T12:00:00Z"),
    )
}

private class TestOwnerStateProvider(initial: OwnerSessionState) : OwnerSessionStateProvider {
    override val state = MutableStateFlow(initial)
}

private class FakeCaptureApi : CaptureApi {
    var issueCalls = 0
    var lastRequest: CapturePairingRequest? = null

    override suspend fun health() = CaptureApiHealth.Ready

    override suspend fun issueCaptureCredential(input: CapturePairingRequest): CaptureCredentialGrant {
        issueCalls++
        lastRequest = input
        return CaptureCredentialGrant(
            credential = "synthetic-capture",
            deviceId = "synthetic-device",
            generation = 1,
            expiresAt = "2099-01-01T00:00:00Z",
            revocationCapability = "synthetic-revocation",
        identity = com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"))
    }
}
