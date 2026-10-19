package com.lofuyu.borderledger.auth

import android.net.Uri
import com.lofuyu.borderledger.api.OwnerLoginClient
import com.lofuyu.borderledger.api.OwnerLoginStartRequest
import com.lofuyu.borderledger.api.OwnerLoginStartResponse
import com.lofuyu.borderledger.api.OwnerTokenResponse
import com.lofuyu.borderledger.api.RevocationIntent
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.local.LocalDataPolicy
import com.lofuyu.borderledger.local.SecureStorageException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

class OwnerSessionManagerTest {
    private val callback = CallbackConfiguration(
        scheme = "https",
        host = "pf.example.com",
        path = "/android/auth/callback",
    )

    @Test
    fun callbackExchangeCommitsBeforeSignedInAndDuplicateCallbackIsReplaySafe() = runTest {
        val store = TestOwnerSessionStore()
        val client = TestOwnerLoginClient()
        val manager = manager(store, client)

        val launch = manager.beginLogin(staySignedIn = false, pendingDestination = "/capture")
        val state = requireNotNull(client.lastStart).state
        val callbackUri = Uri.parse("https://pf.example.com/android/auth/callback?code=synthetic-code&state=$state")

        assertEquals(CallbackResult.SignedIn, manager.handleCallback(callbackUri))
        assertEquals("/capture", (manager.state.value as OwnerSessionState.SignedIn).pendingDestination)
        assertNotNull(store.session)
        assertEquals(CallbackResult.DuplicateIgnored, manager.handleCallback(callbackUri))
        assertEquals(1, client.exchangeCalls.get())
    }

    @Test
    fun wrongHostAndStateAreRejectedWithoutExchangingTheCode() = runTest {
        val store = TestOwnerSessionStore()
        val client = TestOwnerLoginClient()
        val manager = manager(store, client)
        manager.beginLogin(staySignedIn = false, pendingDestination = null)
        val state = requireNotNull(client.lastStart).state

        assertEquals(
            CallbackResult.CallbackRejected,
            manager.handleCallback(Uri.parse("https://evil.example/android/auth/callback?code=synthetic-code&state=$state")),
        )
        assertEquals(
            CallbackResult.CallbackRejected,
            manager.handleCallback(Uri.parse("https://pf.example.com/android/auth/callback?code=synthetic-code&state=wrong-state")),
        )
        assertEquals(0, client.exchangeCalls.get())
    }

    @Test
    fun duplicateCallbackParametersAreRejectedAsAmbiguousInput() = runTest {
        val duplicateQueries = listOf(
            "state=first&state=second",
            "code=first&code=second",
            "error=first&error=second",
            "error_description=first&error_description=second",
            "state=first&s%74ate=second",
        )

        duplicateQueries.forEach { query ->
            assertThrows<CallbackValidationException> {
                callback.verify(Uri.parse("https://pf.example.com/android/auth/callback?$query"))
            }
        }
    }

    @Test
    fun canceledReturnIsRecoverableAndDoesNotCreateOwnerState() = runTest {
        val store = TestOwnerSessionStore()
        val client = TestOwnerLoginClient()
        val manager = manager(store, client)
        manager.beginLogin(staySignedIn = true, pendingDestination = "/review")
        val state = requireNotNull(client.lastStart).state

        assertEquals(
            CallbackResult.Canceled,
            manager.handleCallback(Uri.parse("https://pf.example.com/android/auth/callback?error=access_denied&state=$state")),
        )
        assertTrue(manager.state.value is OwnerSessionState.SignedOut)
        assertEquals(null, store.session)
        assertEquals(0, client.exchangeCalls.get())
    }

    @Test
    fun stalledLoginStartReturnsToRetryableOfflineState() = runTest {
        val store = TestOwnerSessionStore()
        val client = TestOwnerLoginClient(startDelayMillis = 20_000)
        val manager = manager(store, client)

        assertThrows<TransportFailure.Offline> {
            manager.beginLogin(staySignedIn = false, pendingDestination = "/capture")
        }

        assertEquals(
            OwnerSessionState.SignedOut(reason = SignedOutReason.StartFailed),
            manager.state.value,
        )
        assertEquals(null, store.pendingLogin)
    }

    @Test
    fun unexpectedLoginStartFailureReturnsToRetryableStartFailedState() = runTest {
        val store = TestOwnerSessionStore()
        val client = TestOwnerLoginClient(startFailure = IllegalStateException("malformed response"))
        val manager = manager(store, client)

        assertThrows<IllegalStateException> {
            manager.beginLogin(staySignedIn = false, pendingDestination = "/capture")
        }

        assertEquals(
            OwnerSessionState.SignedOut(reason = SignedOutReason.StartFailed),
            manager.state.value,
        )
        assertEquals(null, store.pendingLogin)
    }

    @Test
    fun rotationMetadataSurvivesResponseCommitFailureForReplayRecovery() = runTest {
        val store = TestOwnerSessionStore(
            session = syntheticSession(expiresAt = "2020-01-01T00:00:00Z"),
            failSessionWrite = true,
        )
        val manager = manager(store, TestOwnerLoginClient())

        manager.restore()

        assertTrue(manager.state.value is OwnerSessionState.StorageFailure)
        assertNotNull(store.pendingRotation)
    }

    @Test
    fun storageFailureDoesNotClaimSignInOrResetEncryptedState() = runTest {
        val store = TestOwnerSessionStore(failSessionWrite = true)
        val client = TestOwnerLoginClient()
        val manager = manager(store, client)
        manager.beginLogin(staySignedIn = false, pendingDestination = null)
        val state = requireNotNull(client.lastStart).state

        assertEquals(
            CallbackResult.StorageFailure,
            manager.handleCallback(Uri.parse("https://pf.example.com/android/auth/callback?code=synthetic-code&state=$state")),
        )
        assertFalse(manager.state.value is OwnerSessionState.SignedIn)
        assertTrue(manager.state.value is OwnerSessionState.StorageFailure)
        assertTrue(store.pendingLogin != null)
    }

    @Test
    fun expiredAccessUsesOneRefreshForConcurrentOwnerCalls() = runTest {
        val store = TestOwnerSessionStore(session = syntheticSession(expiresAt = "2020-01-01T00:00:00Z"))
        val client = TestOwnerLoginClient()
        var now = Instant.parse("2026-10-13T12:00:00Z")
        val manager = manager(store, client) { now }
        manager.restore()
        client.refreshCalls.set(0)
        now = Instant.parse("2100-01-01T00:00:00Z")
        client.refreshResponseExpiresAt = "2200-01-01T00:00:00Z"
        client.refreshGate = CompletableDeferred()

        val first = async { manager.withOwnerAuthorization { "first" } }
        val second = async { manager.withOwnerAuthorization { "second" } }
        runCurrent()
        assertEquals(1, client.refreshCalls.get())
        client.refreshGate!!.complete(Unit)
        assertEquals(listOf("first", "second"), awaitAll(first, second))
    }

    @Test
    fun ownerAuthInterceptorRefreshesExpiredAccessWithOneRefresh() = runTest {
        val store = TestOwnerSessionStore(session = syntheticSession(expiresAt = "2020-01-01T00:00:00Z"))
        val client = TestOwnerLoginClient()
        var now = Instant.parse("2026-10-13T12:00:00Z")
        val manager = manager(store, client) { now }
        manager.restore()
        client.refreshCalls.set(0)
        now = Instant.parse("2100-01-01T00:00:00Z")
        client.refreshResponseExpiresAt = "2200-01-01T00:00:00Z"
        client.refreshGate = CompletableDeferred()
        val interceptor = OwnerAuthInterceptor(manager, ApiEnvironment("https://pf.example.com", "sandbox"))
        val request = MobileRequest("GET", "https://pf.example.com/api/mobile/v1/accounts")

        val first = async { interceptor.intercept(request) }
        val second = async { interceptor.intercept(request) }
        runCurrent()
        assertEquals(1, client.refreshCalls.get())
        client.refreshGate!!.complete(Unit)

        assertEquals("Bearer synthetic-owner-access-new", first.await().headers["Authorization"])
        assertEquals("Bearer synthetic-owner-access-new", second.await().headers["Authorization"])
    }

    @Test
    fun remoteAuthorizationFailureRequiresReauthenticationWithoutPausingCapture() = runTest {
        val store = TestOwnerSessionStore(session = syntheticSession(expiresAt = "2099-01-01T00:00:00Z"))
        val capture = TestCaptureCredentialProvider(
            CaptureCredentialRecord(
                credential = "synthetic-capture",
                deviceId = "synthetic-device",
                generation = 1,
                expiresAt = "2099-01-01T00:00:00Z",
                revocationCapability = "synthetic-capture-revocation",
            ),
        )
        val local = TestLocalDataPolicy()
        val manager = manager(store, TestOwnerLoginClient(), capture, local)
        manager.restore()

        manager.markRemoteAuthorizationFailure()

        assertTrue(manager.state.value is OwnerSessionState.Expired)
        assertFalse(local.paused)
        assertNotNull(store.session)
        assertNotNull(capture.value)
    }

    @Test
    fun offlineLogoutClearsVisibleOwnerDataButRetainsEncryptedOutboxAndQueuesRevocations() = runTest {
        val store = TestOwnerSessionStore(session = syntheticSession(expiresAt = "2099-01-01T00:00:00Z"))
        val client = TestOwnerLoginClient(offline = true)
        val capture = TestCaptureCredentialProvider(
            CaptureCredentialRecord(
                credential = "synthetic-capture-credential",
                deviceId = "synthetic-device",
                generation = 1,
                expiresAt = "2099-01-01T00:00:00Z",
                revocationCapability = "synthetic-capture-revocation",
            ),
        )
        val local = TestLocalDataPolicy()
        val manager = manager(store, client, capture, local)
        manager.restore()

        manager.signOut()

        assertTrue(local.paused)
        assertTrue(local.readCacheCleared)
        assertTrue(local.outboxRetained)
        assertEquals(2, local.revocations.size)
        assertEquals(null, capture.value)
        assertEquals(2, (manager.state.value as OwnerSessionState.SignedOut).pendingRevocations)
    }

    @Test
    fun ownerAndCaptureInterceptorsRejectEachOthersRoutes() = runTest {
        val owner = OwnerAuthInterceptor(
            provider = object : OwnerCredentialProvider {
                override suspend fun accessToken(): String = "synthetic-owner-access"
            },
            environment = ApiEnvironment("https://pf.example.com", "sandbox"),
        )
        val capture = CaptureAuthInterceptor(
            provider = object : CaptureCredentialProvider {
                override suspend fun current(): CaptureCredentialRecord = CaptureCredentialRecord(
                    credential = "synthetic-capture",
                    deviceId = "synthetic-device",
                    generation = 1,
                    expiresAt = "2099-01-01T00:00:00Z",
                    revocationCapability = "synthetic-revocation",
                )

                override suspend fun save(value: CaptureCredentialRecord) = Unit
                override suspend fun clear() = Unit
            },
            environment = ApiEnvironment("https://pf.example.com", "sandbox"),
        )

        val ownerRequest = MobileRequest("GET", "https://pf.example.com/api/mobile/v1/accounts")
        val captureRequest = MobileRequest("POST", "https://pf.example.com/api/mobile/v1/alerts")
        assertEquals("Bearer synthetic-owner-access", owner.intercept(ownerRequest).headers["Authorization"])
        assertEquals("Bearer synthetic-capture", capture.intercept(captureRequest).headers["Authorization"])
        assertThrows<CredentialBoundaryException> { owner.intercept(captureRequest) }
        assertThrows<CredentialBoundaryException> { capture.intercept(ownerRequest) }
        assertThrows<CredentialBoundaryException> {
            capture.intercept(MobileRequest("GET", "https://pf.example.com/api/mobile/v1/alerts"))
        }
        assertThrows<CredentialBoundaryException> {
            capture.intercept(MobileRequest("PATCH", "https://pf.example.com/api/mobile/v1/alerts/event/review"))
        }
    }

    @Test
    fun ownerCanReadAlertsButCannotPostCaptureAlerts() = runTest {
        val owner = OwnerAuthInterceptor(
            provider = object : OwnerCredentialProvider {
                override suspend fun accessToken(): String = "synthetic-owner-access"
            },
            environment = ApiEnvironment("https://pf.example.com", "sandbox"),
        )

        val read = owner.intercept(MobileRequest("GET", "https://pf.example.com/api/mobile/v1/alerts"))
        assertEquals("Bearer synthetic-owner-access", read.headers["Authorization"])
        assertThrows<CredentialBoundaryException> {
            owner.intercept(MobileRequest("POST", "https://pf.example.com/api/mobile/v1/alerts"))
        }
    }

    private fun manager(
        store: TestOwnerSessionStore,
        client: TestOwnerLoginClient,
        capture: TestCaptureCredentialProvider = TestCaptureCredentialProvider(null),
        local: TestLocalDataPolicy = TestLocalDataPolicy(),
        clock: () -> Instant = { Instant.parse("2026-10-13T12:00:00Z") },
    ) = OwnerSessionManager(
        store = store,
        client = client,
        captureCredentials = capture,
        localData = local,
        callbackConfiguration = callback,
        clock = clock,
    )

    private fun syntheticSession(expiresAt: String) = OwnerSessionRecord(
        accessToken = "synthetic-owner-access",
        refreshToken = "synthetic-owner-refresh",
        expiresAt = expiresAt,
        scopes = listOf("ledger:read", "devices:manage"),
        revision = 1,
        revocationCapability = "synthetic-owner-revocation",
        deviceId = "synthetic-device",
    )
}

private class TestOwnerSessionStore(
    var session: OwnerSessionRecord? = null,
    var pendingLogin: PendingOwnerLogin? = null,
    private val failSessionWrite: Boolean = false,
) : OwnerSessionStore {
    val revocations = mutableListOf<RevocationIntent>()
    var pendingRotation: PendingOwnerRotation? = null
    var completedCallback: CompletedCallbackMarker? = null

    override suspend fun readSession() = session
    override suspend fun writeSession(value: OwnerSessionRecord) {
        if (failSessionWrite) throw SecureStorageException("synthetic storage failure")
        session = value
    }

    override suspend fun clearSession() { session = null }
    override suspend fun readPendingLogin() = pendingLogin
    override suspend fun writePendingLogin(value: PendingOwnerLogin) { pendingLogin = value }
    override suspend fun clearPendingLogin() { pendingLogin = null }
    override suspend fun readPendingRotation() = pendingRotation
    override suspend fun writePendingRotation(value: PendingOwnerRotation) { pendingRotation = value }
    override suspend fun clearPendingRotation() { pendingRotation = null }
    override suspend fun readCompletedCallback() = completedCallback
    override suspend fun writeCompletedCallback(value: CompletedCallbackMarker) { completedCallback = value }
    override suspend fun readPendingRevocations() = revocations.toList()
    override suspend fun writePendingRevocations(values: List<RevocationIntent>) {
        revocations.clear()
        revocations.addAll(values)
    }
}

private class TestOwnerLoginClient(
    private val offline: Boolean = false,
    private val startDelayMillis: Long = 0,
    private val startFailure: Throwable? = null,
) : OwnerLoginClient {
    var lastStart: OwnerLoginStartRequest? = null
    val exchangeCalls = AtomicInteger()
    val refreshCalls = AtomicInteger()
    var refreshGate: CompletableDeferred<Unit>? = null
    var refreshResponseExpiresAt = "2099-01-01T00:00:00Z"

    override suspend fun startLogin(input: OwnerLoginStartRequest): OwnerLoginStartResponse {
        lastStart = input
        if (startDelayMillis > 0) delay(startDelayMillis)
        startFailure?.let { throw it }
        return OwnerLoginStartResponse("synthetic-request", "https://access.example/authorize", "2099-01-01T00:00:00Z")
    }

    override suspend fun exchangeCode(input: com.lofuyu.borderledger.api.OwnerCodeExchangeRequest): OwnerTokenResponse {
        exchangeCalls.incrementAndGet()
        return syntheticTokenResponse()
    }

    override suspend fun refresh(input: com.lofuyu.borderledger.api.OwnerRefreshRequest): OwnerTokenResponse {
        refreshCalls.incrementAndGet()
        refreshGate?.await()
        return syntheticTokenResponse(refreshResponseExpiresAt)
    }

    override suspend fun logout(accessToken: String) {
        if (offline) throw TransportFailure.Offline
    }

    override suspend fun revoke(intent: RevocationIntent) {
        if (offline) throw TransportFailure.Offline
    }

    private fun syntheticTokenResponse(expiresAt: String = refreshResponseExpiresAt) = OwnerTokenResponse(
        accessToken = "synthetic-owner-access-new",
        refreshToken = "synthetic-owner-refresh-new",
        expiresAt = expiresAt,
        scopes = listOf("ledger:read", "devices:manage"),
        revision = 2,
        revocationCapability = "synthetic-owner-revocation-new",
    )
}

private class TestCaptureCredentialProvider(var value: CaptureCredentialRecord?) : CaptureCredentialProvider {
    override suspend fun current() = value
    override suspend fun save(value: CaptureCredentialRecord) { this.value = value }
    override suspend fun clear() { value = null }
}

private class TestLocalDataPolicy : LocalDataPolicy {
    var paused = false
    var readCacheCleared = false
    var outboxRetained = false
    val revocations = mutableListOf<RevocationIntent>()

    override suspend fun pauseMonitoring() { paused = true }
    override suspend fun clearOwnerReadCache() { readCacheCleared = true }
    override suspend fun retainEncryptedOutbox() { outboxRetained = true }
    override suspend fun queueRevocation(value: RevocationIntent) { revocations.add(value) }
    override suspend fun pendingRevocationCount() = revocations.size
}

private fun syntheticTokenResponse() = OwnerTokenResponse(
    accessToken = "synthetic-owner-access",
    refreshToken = "synthetic-owner-refresh",
    expiresAt = "2099-01-01T00:00:00Z",
    scopes = listOf("ledger:read", "devices:manage"),
    revision = 1,
    revocationCapability = "synthetic-owner-revocation",
)

private suspend inline fun <reified T : Throwable> assertThrows(block: suspend () -> Unit) {
    try {
        block()
    } catch (error: Throwable) {
        assertTrue("Expected ${T::class.simpleName}, got ${error::class.simpleName}", error is T)
        return
    }
    throw AssertionError("Expected ${T::class.simpleName}")
}
