package com.lofuyu.borderledger.sync

import com.lofuyu.borderledger.capture.CaptureHealthState
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.api.CaptureEventAcknowledgement
import com.lofuyu.borderledger.api.CaptureUploadClient
import com.lofuyu.borderledger.api.CaptureUploadEvent
import com.lofuyu.borderledger.api.CaptureUploadResult
import com.lofuyu.borderledger.local.AlertAcknowledgement
import com.lofuyu.borderledger.local.CaptureAcknowledgementDisposition
import com.lofuyu.borderledger.local.CaptureUploadStore
import com.lofuyu.borderledger.local.QueuedAlert
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadCoordinatorTest {
    @Test
    fun concurrentForegroundAndBackgroundSyncShareOneImmutableUpload() = runTest {
        val store = FakeUploadStore(
            QueuedAlert("local-1", "personal", "event-1", byteArrayOf(1, 2), 10L),
        )
        val client = RecordingUploadClient {
            delay(10L)
            CaptureUploadResult.Success(
                listOf(CaptureEventAcknowledgement("event-1", "accepted", "provisional", listOf("accepted"))),
            )
        }
        val coordinator = CaptureUploadCoordinator(store, client, CaptureHealthStore(), batchEncoder = { ByteArray(1) })

        listOf(async { coordinator.sync() }, async { coordinator.sync() }).awaitAll()

        assertEquals(1, client.batches.size)
        assertEquals("event-1", client.batches.single().single().eventId)
        assertEquals(byteArrayOf(1, 2).toList(), client.batches.single().single().payload.toList())
        assertEquals(listOf("apply", "purge"), store.operations)
    }

    @Test
    fun missingAcknowledgementStaysQueuedAndReturnedAckIsPersistedBeforePurge() = runTest {
        val store = FakeUploadStore(
            QueuedAlert("local-1", "personal", "event-1", byteArrayOf(1), 10L),
            QueuedAlert("local-2", "personal", "event-2", byteArrayOf(2), 11L),
        )
        val client = RecordingUploadClient {
            CaptureUploadResult.Success(
                listOf(CaptureEventAcknowledgement("event-1", "accepted", "non_spending", listOf("non_spending"))),
            )
        }
        val coordinator = CaptureUploadCoordinator(store, client, CaptureHealthStore(), batchEncoder = { ByteArray(1) })

        val result = coordinator.sync()

        assertTrue(result is UploadSyncResult.Partial)
        assertEquals(setOf("event-1"), store.applied.single().map(AlertAcknowledgement::eventId).toSet())
        assertEquals(listOf("event-2"), store.pending.map(QueuedAlert::eventId))
        assertEquals(listOf("apply", "purge"), store.operations)
    }

    @Test
    fun timeoutAfterCommitKeepsExactBatchForReplayAndThenAcceptsReplayReceipt() = runTest {
        val original = QueuedAlert("local-1", "personal", "event-1", byteArrayOf(9, 8, 7), 10L)
        val store = FakeUploadStore(original)
        val client = RecordingUploadClient(
            CaptureUploadResult.Retryable("timeout", retryAfterSeconds = null),
            CaptureUploadResult.Success(
                listOf(CaptureEventAcknowledgement("event-1", "replayed", "provisional", listOf("replayed"))),
            ),
        )
        val health = CaptureHealthStore()
        val coordinator = CaptureUploadCoordinator(store, client, health, batchEncoder = { ByteArray(1) })

        assertTrue(coordinator.sync() is UploadSyncResult.Retry)
        assertEquals(listOf("event-1"), store.pending.map(QueuedAlert::eventId))
        assertEquals(byteArrayOf(9, 8, 7).toList(), client.batches.single().single().payload.toList())

        assertTrue(coordinator.sync() is UploadSyncResult.Completed)
        assertEquals(2, client.batches.size)
        assertEquals(client.batches[0].single().payload.toList(), client.batches[1].single().payload.toList())
        assertEquals(CaptureHealthState.Upload.READY, health.state.value.upload)
    }

    @Test
    fun unauthorizedUploadPausesForPairingWithoutDeletingRows() = runTest {
        val store = FakeUploadStore(QueuedAlert("local-1", "personal", "event-1", byteArrayOf(1), 10L))
        val health = CaptureHealthStore()
        val coordinator = CaptureUploadCoordinator(
            store,
            RecordingUploadClient(CaptureUploadResult.PairingRequired("capture_credential_expired")),
            health,
            batchEncoder = { ByteArray(1) },
        )

        assertTrue(coordinator.sync() is UploadSyncResult.PairingRequired)
        assertEquals(1, store.pending.size)
        assertEquals(CaptureHealthState.Upload.PAUSED_CAPTURE_CREDENTIAL, health.state.value.upload)
        assertTrue(health.state.value.pairingRenewalRequired)
    }

    @Test
    fun rateLimitUsesBoundedRetryAfterAndFiveHundredUsesExponentialRetry() = runTest {
        val health = CaptureHealthStore()
        val store = FakeUploadStore(QueuedAlert("local-1", "personal", "event-1", byteArrayOf(1), 10L))
        val coordinator = CaptureUploadCoordinator(
            store,
            RecordingUploadClient(CaptureUploadResult.Retryable("rate_limited", retryAfterSeconds = 9_999L)),
            health,
            clock = { 1_000L },
            batchEncoder = { ByteArray(1) },
        )

        assertTrue(coordinator.sync() is UploadSyncResult.Retry)
        assertEquals(3_600_000L, health.state.value.uploadRetryAtMillis!! - 1_000L)
    }

    @Test
    fun permanentConflictIsQuarantinedWithStableReviewCode() = runTest {
        val store = FakeUploadStore(QueuedAlert("local-1", "personal", "event-1", byteArrayOf(1), 10L))
        val coordinator = CaptureUploadCoordinator(
            store,
            RecordingUploadClient(CaptureUploadResult.Permanent(listOf("event-1"), "idempotency_conflict")),
            CaptureHealthStore(),
            batchEncoder = { ByteArray(1) },
        )

        assertTrue(coordinator.sync() is UploadSyncResult.Quarantined)
        assertEquals(CaptureAcknowledgementDisposition.REVIEW, store.applied.single().single().disposition)
        assertEquals("idempotency_conflict", store.applied.single().single().code)
        assertTrue(store.pending.isEmpty())
    }
}

private class RecordingUploadClient private constructor(
    private val results: List<CaptureUploadResult>,
    private val producer: (suspend () -> CaptureUploadResult)?,
) : CaptureUploadClient {
    constructor(vararg results: CaptureUploadResult) : this(results.toList(), null)
    constructor(producer: suspend () -> CaptureUploadResult) : this(emptyList(), producer)

    val batches = mutableListOf<List<CaptureUploadEvent>>()
    private var index = 0

    override suspend fun upload(batch: List<CaptureUploadEvent>): CaptureUploadResult {
        batches += batch.map { it.copy(payload = it.payload.copyOf()) }
        return producer?.invoke() ?: results.getOrElse(index++) { results.last() }
    }
}

private class FakeUploadStore(vararg initial: QueuedAlert) : CaptureUploadStore {
    var pending = initial.toList()
    val applied = mutableListOf<List<AlertAcknowledgement>>()
    val operations = mutableListOf<String>()

    override suspend fun nextBatch(limit: Int): List<QueuedAlert> = pending.filterNot { it.acknowledged }.take(limit)

    override suspend fun applyAcknowledgements(acknowledgements: List<AlertAcknowledgement>) {
        operations += "apply"
        applied += acknowledgements
        val byId = acknowledgements.associateBy(AlertAcknowledgement::eventId)
        pending = pending.map { item ->
            byId[item.eventId]?.let { item.copy(acknowledged = true, acknowledgementCode = it.code) } ?: item
        }
    }

    override suspend fun purgeAcknowledged() {
        operations += "purge"
        pending = pending.filterNot(QueuedAlert::acknowledged)
    }

    override suspend fun pendingCount(): Int = pending.count { !it.acknowledged }
}
