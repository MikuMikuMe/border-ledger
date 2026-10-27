package com.lofuyu.borderledger

import kotlinx.coroutines.async
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.api.CaptureEventAcknowledgement
import com.lofuyu.borderledger.api.CaptureUploadClient
import com.lofuyu.borderledger.api.CaptureUploadEvent
import com.lofuyu.borderledger.api.CaptureUploadResult
import com.lofuyu.borderledger.api.OwnerLedgerApi
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.OwnerSessionAuthorizationHandler
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.local.AlertAcknowledgement
import com.lofuyu.borderledger.local.OwnerReadCache
import com.lofuyu.borderledger.local.OwnerReadCacheEntry
import com.lofuyu.borderledger.sync.CaptureUploadCoordinator
import com.lofuyu.borderledger.local.CaptureUploadStore
import com.lofuyu.borderledger.local.QueuedAlert
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class LedgerRepositoryTest {
    @Test
    fun lateSnapshotFromPreviousAccountCannotReplaceNewAccountCache() = runTest {
        val first = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")
        val second = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("b", "b-ledger"), "b-session")
        val owner = FakeOwnerState(OwnerSessionState.SignedIn("2200-01-01T00:00:00Z", emptyList(), null, binding = first))
        val cache = FakeOwnerReadCache()
        val response = kotlinx.coroutines.CompletableDeferred<ByteArray>()
        val repository = repository(owner, cache, object : OwnerLedgerApi {
            override suspend fun readSnapshot() = response.await()
        })
        val loading = kotlinx.coroutines.CoroutineScope(coroutineContext).async { repository.refreshOwnerSnapshot() }
        testScheduler.runCurrent()
        owner.state.value = OwnerSessionState.SignedIn("2200-01-01T00:00:00Z", emptyList(), null, binding = second)
        val secondEntry = entry().copy(ownerUserId = "b", ownerLedgerId = "b-ledger", sessionEpoch = "b-session")
        repository.writeOwnerSnapshot(secondEntry)
        response.complete(byteArrayOf(9))
        assertEquals(LedgerRepository.SnapshotRefreshResult.NotSignedIn, loading.await())
        assertEquals(listOf(secondEntry), cache.writes)
        assertFalse(cache.cleared)
    }

    @Test
    fun signedOutOrRevokedOwnerCannotReadOrWriteFinancialCache() = runTest {
        val cache = FakeOwnerReadCache()
        val owner = FakeOwnerState(OwnerSessionState.SignedOut())
        val repository = repository(owner, cache)

        assertNull(repository.readCachedOwnerSnapshot(Instant.parse("2026-10-13T00:00:00Z")))
        assertFalse(repository.writeOwnerSnapshot(entry()))
        assertTrue(cache.cleared)
        assertTrue(cache.writes.isEmpty())

        owner.state.value = OwnerSessionState.Expired()
        assertNull(repository.readCachedOwnerSnapshot(Instant.parse("2026-10-13T00:00:00Z")))
        assertTrue(cache.cleared)
    }

    @Test
    fun onlySignedInOwnerCanPersistAndReadSnapshot() = runTest {
        val cache = FakeOwnerReadCache()
        val owner = FakeOwnerState(OwnerSessionState.SignedIn("2026-10-13T01:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val repository = repository(owner, cache)

        assertTrue(repository.writeOwnerSnapshot(entry()))
        assertTrue(repository.readCachedOwnerSnapshot(Instant.parse("2026-10-13T00:30:00Z")) != null)
    }

    @Test
    fun remoteUnauthorizedRefreshClearsOwnerReadCache() = runTest {
        val cache = FakeOwnerReadCache()
        val owner = FakeOwnerState(OwnerSessionState.SignedIn("2026-10-13T01:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val api = object : OwnerLedgerApi {
            override suspend fun readSnapshot(): ByteArray = throw TransportFailure.Unauthorized
        }
        val repository = repository(owner, cache, api)
        repository.writeOwnerSnapshot(entry())

        assertEquals(
            LedgerRepository.SnapshotRefreshResult.Unauthorized,
            repository.refreshOwnerSnapshot(Instant.parse("2026-10-13T00:30:00Z")),
        )
        assertTrue(cache.cleared)
        assertTrue(cache.writes.isEmpty())
        assertTrue(owner.state.value is OwnerSessionState.Expired)
    }

    @Test
    fun offlineRefreshRetainsOwnerReadCacheAndSignedInState() = runTest {
        val cache = FakeOwnerReadCache()
        val owner = FakeOwnerState(OwnerSessionState.SignedIn("2026-10-13T01:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val api = object : OwnerLedgerApi {
            override suspend fun readSnapshot(): ByteArray = throw TransportFailure.Offline
        }
        val repository = repository(owner, cache, api)
        repository.writeOwnerSnapshot(entry())

        assertEquals(
            LedgerRepository.SnapshotRefreshResult.Offline,
            repository.refreshOwnerSnapshot(Instant.parse("2026-10-13T00:30:00Z")),
        )
        assertFalse(cache.cleared)
        assertTrue(cache.writes.isNotEmpty())
        assertTrue(owner.state.value is OwnerSessionState.SignedIn)
    }

    @Test
    fun acknowledgedCaptureInvalidatesOwnerReadCacheWithoutRefreshingIt() = runTest {
        val cache = FakeOwnerReadCache()
        val owner = FakeOwnerState(OwnerSessionState.SignedIn("2026-10-13T01:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session")))
        val store = SingleUploadStore(QueuedAlert("local-1", "personal", EVENT_ID, byteArrayOf(1), 10L))
        val client = object : com.lofuyu.borderledger.api.CaptureUploadClient {
            override suspend fun upload(batch: List<CaptureUploadEvent>): CaptureUploadResult =
                CaptureUploadResult.Success(listOf(CaptureEventAcknowledgement(EVENT_ID, "accepted", "provisional", listOf("accepted"))))
        }
        val repository = LedgerRepository(
            owner,
            cache,
            CaptureUploadCoordinator(store, client, CaptureHealthStore(), batchEncoder = { ByteArray(1) }, boundary = com.lofuyu.borderledger.IdentityFixture().boundary),
            CaptureHealthStore(),
        )
        repository.writeOwnerSnapshot(entry())

        repository.syncCapture()

        assertTrue(cache.cleared)
        assertTrue(cache.writes.isEmpty())
    }

    private fun repository(owner: FakeOwnerState, cache: FakeOwnerReadCache, ownerLedgerApi: OwnerLedgerApi? = null): LedgerRepository {
        val store = object : CaptureUploadStore {
            override suspend fun nextBatch(limit: Int): List<QueuedAlert> = emptyList()
            override suspend fun applyAcknowledgements(acknowledgements: List<com.lofuyu.borderledger.local.AlertAcknowledgement>) = Unit
            override suspend fun purgeAcknowledged() = Unit
            override suspend fun pendingCount(): Int = 0
        }
        val client = object : CaptureUploadClient {
            override suspend fun upload(batch: List<CaptureUploadEvent>): CaptureUploadResult = CaptureUploadResult.Success(emptyList())
        }
        return LedgerRepository(owner, cache, CaptureUploadCoordinator(store, client, CaptureHealthStore(), boundary = com.lofuyu.borderledger.IdentityFixture().boundary), CaptureHealthStore(), ownerLedgerApi)
    }

    private fun entry() = OwnerReadCacheEntry(
        ownerLedgerId = "personal",
        snapshotAt = "2026-10-13T00:00:00Z",
        lastAuthenticatedAt = "2026-10-13T00:00:00Z",
        refreshExpiresAt = "2026-10-14T00:00:00Z",
        payload = byteArrayOf(1, 2, 3),
    ownerUserId = "owner", sessionEpoch = "test-session")
}

private val EVENT_ID = "11111111-1111-4111-8111-111111111111"

private class FakeOwnerState(initial: OwnerSessionState) : OwnerSessionAuthorizationHandler {
    override val state = MutableStateFlow(initial)
    override suspend fun markRemoteAuthorizationFailure() {
        state.value = OwnerSessionState.Expired()
    }
}

private class FakeOwnerReadCache : OwnerReadCache {
    val writes = mutableListOf<OwnerReadCacheEntry>()
    var cleared = false
    override suspend fun write(entry: OwnerReadCacheEntry) { writes += entry }
    override suspend fun readIfUsable(now: Instant, expected: com.lofuyu.borderledger.auth.SessionBinding?): OwnerReadCacheEntry? = writes.lastOrNull()
    override suspend fun clear() { cleared = true; writes.clear() }
}

private class SingleUploadStore(private var item: QueuedAlert) : CaptureUploadStore {
    override suspend fun nextBatch(limit: Int): List<QueuedAlert> = listOf(item).filterNot { it.acknowledged }.take(limit)
    override suspend fun applyAcknowledgements(acknowledgements: List<AlertAcknowledgement>) {
        item = item.copy(acknowledged = true)
    }
    override suspend fun purgeAcknowledged() { item = item.copy(acknowledged = true) }
    override suspend fun pendingCount(): Int = if (item.acknowledged) 0 else 1
}
