package com.lofuyu.borderledger.core

import com.lofuyu.borderledger.api.*
import com.lofuyu.borderledger.auth.*
import com.lofuyu.borderledger.local.*
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class OwnerSessionCoreTest {
    @Test fun legacySessionRequiresReloginAndRetainsRevocation() = runTest {
        val store = MemorySessionStore().apply { session = record("future").copy(identity = null, epoch = null) }
        val policy = LogoutPolicy()
        val manager = Session(store, LoginClient(), policy = policy)
        manager.restore()
        assertIs<OwnerSessionState.SignedOut>(manager.state.value)
        assertNull(manager.accessToken())
        assertEquals("owner-revoke", policy.queued.single().capability)
    }

    @Test fun malformedCallbackInputIsRejectedWithoutLosingPendingLogin() = runTest {
        val store = MemorySessionStore()
        val client = LoginClient()
        val manager = Session(store, client)
        manager.beginLogin(false, null)
        val pending = requireNotNull(store.pending)

        assertEquals(CallbackResult.CallbackRejected, manager.malformedCallback())
        assertEquals(OwnerSessionState.CallbackRejected(recoverable = false), manager.state.value)
        assertEquals(pending, store.pending)
        assertEquals(0, client.exchanges)
        assertEquals(CallbackResult.SignedIn, manager.callback(VerifiedCallback(pending.state, "code", null)))
    }

    @Test fun callbackCommitsOnceAcrossRecreationAndConsumesDestinationOnce() = runTest {
        val store = MemorySessionStore()
        val client = LoginClient()
        val first = Session(store, client)
        first.beginLogin(false, "/capture")
        assertFalse(requireNotNull(store.pending).staySignedIn)
        val returned = VerifiedCallback(requireNotNull(store.pending).state, "code", null)
        assertEquals(CallbackResult.SignedIn, first.callback(returned))
        assertNotNull(store.session)
        assertNotNull(store.marker)
        val recreated = Session(store, client)
        recreated.restore()
        assertEquals(CallbackResult.DuplicateIgnored, recreated.callback(returned))
        assertEquals(1, client.exchanges)
        assertEquals("/capture", recreated.consumePendingDestination())
        assertNull(recreated.consumePendingDestination())
        assertNull(store.session?.pendingDestination)
    }

    @Test fun concurrentAccessRefreshesOnceAndReusesPersistedRotationKey() = runTest {
        val store = MemorySessionStore().apply {
            session = record("past")
            rotation = PendingOwnerRotation("original-key", "earlier")
        }
        val client = LoginClient()
        val manager = Session(store, client)
        assertEquals(List(8) { "new-access" }, List(8) { async { manager.accessToken() } }.awaitAll())
        assertEquals(listOf("original-key"), client.rotationKeys)
        assertNull(store.rotation)
        assertIs<OwnerSessionState.SignedIn>(manager.state.value)
    }

    @Test fun storageFailureNeverPublishesSignedIn() = runTest {
        val store = MemorySessionStore().apply { failWrite = true }
        val manager = Session(store, LoginClient())
        manager.beginLogin(false, null)
        assertEquals(CallbackResult.StorageFailure, manager.callback(VerifiedCallback(store.pending?.state, "code", null)))
        assertEquals(OwnerSessionState.StorageFailure(StorageOperation.LoginCommit), manager.state.value)
    }

    @Test fun offlineSignOutPausesCaptureClearsReadCacheAndRetainsOutbox() = runTest {
        val store = MemorySessionStore().apply { session = record("future") }
        val capture = CaptureProvider(CaptureCredentialRecord("capture", "device", 4, "future", "capture-revoke", identity = com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), sessionEpoch = "test-session"))
        val policy = LogoutPolicy()
        val manager = Session(store, LoginClient(offline = true), capture, policy)
        manager.signOut()
        assertEquals(listOf("pause", "clear-cache", "retain-outbox"), policy.operations)
        assertEquals(listOf(RevocationGrantType.OwnerFamily, RevocationGrantType.CaptureCredential), policy.queued.map { it.grantType })
        assertNull(store.session)
        assertNull(capture.value)
        assertEquals(OwnerSessionState.SignedOut(2, SignedOutReason.Offline), manager.state.value)
    }

    @Test fun flushingAnEmptyRevocationQueueKeepsAnExplicitSignedOutState() = runTest {
        val manager = Session(MemorySessionStore(), LoginClient())
        manager.restore()
        assertEquals(OwnerSessionState.SignedOut(0, SignedOutReason.Explicit), manager.state.value)

        manager.flushPendingRevocations()

        assertEquals(OwnerSessionState.SignedOut(0, SignedOutReason.Explicit), manager.state.value)
    }

    @Test fun canceledAndWrongStateReturnsDoNotExchange() = runTest {
        val store = MemorySessionStore()
        val client = LoginClient()
        val manager = Session(store, client)
        manager.beginLogin(false, null)
        assertEquals(CallbackResult.CallbackRejected, manager.callback(VerifiedCallback("wrong", "code", null)))
        assertNotNull(store.pending)
        assertEquals(CallbackResult.Canceled, manager.callback(VerifiedCallback(store.pending?.state, null, "access_denied")))
        assertNull(store.pending)
        assertEquals(0, client.exchanges)
    }
}

private fun record(expiry: String) = OwnerSessionRecord("old-access", "refresh", expiry, listOf("ledger:read"), 1, "owner-revoke", "device", identity = com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), epoch = "test-session")
private val testClock = object : CoreClock {
    override fun nowIso() = "2026-10-16T12:00:00Z"
    override fun isAfterNow(iso: String) = iso == "future"
}
private class TestCrypto : CoreCrypto {
    private var counter = 0
    override fun randomToken(byteCount: Int) = "token-${byteCount}-${counter++}"
    override fun sha256Hex(value: String) = "digest:$value"
    override fun pkceChallenge(verifier: String) = "challenge:$verifier"
}
private class Session(store: MemorySessionStore, client: LoginClient, capture: CaptureProvider = CaptureProvider(), policy: LogoutPolicy = LogoutPolicy()) :
    OwnerSessionCore(store, client, capture, policy, "https://pf.example.com/android/auth/callback", "sandbox", "device", testClock, TestCrypto()) {
    suspend fun callback(value: VerifiedCallback) = handleVerifiedCallback { value }
    suspend fun malformedCallback() = handleVerifiedCallback { throw IllegalArgumentException("secret callback input") }
}
private class MemorySessionStore : OwnerSessionStore {
    var session: OwnerSessionRecord? = null
    var pending: PendingOwnerLogin? = null
    var rotation: PendingOwnerRotation? = null
    var marker: CompletedCallbackMarker? = null
    var revocations = emptyList<RevocationIntent>()
    var failWrite = false
    override suspend fun readSession() = session
    override suspend fun writeSession(value: OwnerSessionRecord) { if (failWrite) throw SecureStorageException("fixture failure"); session = value }
    override suspend fun clearSession() { session = null }
    override suspend fun readPendingLogin() = pending
    override suspend fun writePendingLogin(value: PendingOwnerLogin) { pending = value }
    override suspend fun clearPendingLogin() { pending = null }
    override suspend fun readPendingRotation() = rotation
    override suspend fun writePendingRotation(value: PendingOwnerRotation) { rotation = value }
    override suspend fun clearPendingRotation() { rotation = null }
    override suspend fun readCompletedCallback() = marker
    override suspend fun writeCompletedCallback(value: CompletedCallbackMarker) { marker = value }
    override suspend fun readPendingRevocations() = revocations
    override suspend fun writePendingRevocations(values: List<RevocationIntent>) { revocations = values }
}
private class CaptureProvider(var value: CaptureCredentialRecord? = null) : CaptureCredentialProvider {
    override suspend fun current() = value
    override suspend fun save(value: CaptureCredentialRecord) { this.value = value }
    override suspend fun clear() { value = null }
}
private class LogoutPolicy : LocalDataPolicy {
    val operations = mutableListOf<String>()
    val queued = mutableListOf<RevocationIntent>()
    override suspend fun pauseMonitoring() { operations += "pause" }
    override suspend fun clearOwnerReadCache() { operations += "clear-cache" }
    override suspend fun retainEncryptedOutbox() { operations += "retain-outbox" }
    override suspend fun queueRevocation(value: RevocationIntent) { queued += value }
    override suspend fun pendingRevocationCount() = queued.size
}
private class LoginClient(val offline: Boolean = false) : OwnerLoginClient {
    var exchanges = 0
    val rotationKeys = mutableListOf<String>()
    override suspend fun startLogin(input: OwnerLoginStartRequest) = OwnerLoginStartResponse("request", "https://access.example/authorize", "future")
    override suspend fun exchangeCode(input: OwnerCodeExchangeRequest): OwnerTokenResponse { exchanges++; return token() }
    override suspend fun refresh(input: OwnerRefreshRequest): OwnerTokenResponse { rotationKeys += input.idempotencyKey; return token() }
    override suspend fun logout(accessToken: String) { if (offline) throw TransportFailure.Offline }
    override suspend fun revoke(intent: RevocationIntent) { if (offline) throw TransportFailure.Offline }
    private fun token() = OwnerTokenResponse("new-access", "new-refresh", "future", listOf("ledger:read"), 2, "revoke", userId = "owner", ledgerId = "personal")
}
