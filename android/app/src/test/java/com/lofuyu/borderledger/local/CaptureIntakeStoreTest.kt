package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.capture.ObservationOrigin
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures
import com.lofuyu.borderledger.parser.BocCreditCardParser
import com.lofuyu.borderledger.parser.EventIdProvider
import com.lofuyu.borderledger.parser.ParseResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.util.UUID

class CaptureIntakeStoreTest {
    private val eventIds = EventIdProvider { message ->
        UUID.nameUUIDFromBytes(message.observationId.toByteArray(StandardCharsets.UTF_8)).toString()
    }

    @Test
    fun failedAtomicCommitDoesNotExposeQueuedOrObservationState() = runTest {
        val records = FailingRecordStore()
        val store = EncryptedCaptureIntakeStore(records)
        val message = SyntheticNotificationFixtures.observed(messageIdentity = "atomic-failure")

        records.failNextWrite = true
        val result = store.commit(
            CaptureCommitRequest(
                message = message,
                event = eventFor(message),
                disposition = CaptureCandidateDisposition.QUEUED,
            ownerLedgerId = "personal"),
        )

        assertTrue(result is CaptureCommitResult.PersistenceFailed)
        assertEquals(0, store.pendingCount())
        assertTrue(store.snapshot().observations.isEmpty())
        assertTrue(store.snapshot().candidates.isEmpty())
    }

    @Test
    fun concurrentHundredEventBurstPreservesEveryCommittedIdentity() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore())
        val messages = (0 until 100).map { index ->
            SyntheticNotificationFixtures.observed(messageIdentity = "burst-$index", key = "key-$index")
        }

        messages.map { message ->
            async(Dispatchers.Default) {
                store.commit(
                    CaptureCommitRequest(message, eventFor(message), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal"),
                )
            }
        }.awaitAll()

        assertEquals(100, store.pendingCount())
        val firstBatch = store.nextBatch(50)
        assertEquals(50, firstBatch.size)
        assertEquals(100, store.pendingCount())

        store.applyAcknowledgements(firstBatch.map { AlertAcknowledgement(it.eventId, "test") })
        val secondBatch = store.nextBatch(50)
        assertEquals(50, secondBatch.size)
        assertEquals(100, (firstBatch + secondBatch).map { it.eventId }.toSet().size)
        assertEquals(50, store.pendingCount())
    }

    @Test
    fun storedIntakeCapPausesIntakeWithoutDeletingUnsentEvents() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore(), pendingLimit = 3)
        val first = SyntheticNotificationFixtures.observed(messageIdentity = "cap-1", key = "cap-key-1")
        val second = SyntheticNotificationFixtures.observed(messageIdentity = "cap-2", key = "cap-key-2")
        val third = SyntheticNotificationFixtures.observed(messageIdentity = "cap-3", key = "cap-key-3")
        val fourth = SyntheticNotificationFixtures.observed(messageIdentity = "cap-4", key = "cap-key-4")

        assertTrue(store.commit(CaptureCommitRequest(first, eventFor(first), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)
        assertTrue(store.commit(CaptureCommitRequest(second, eventFor(second), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)
        assertTrue(store.commit(CaptureCommitRequest(third, eventFor(third), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)
        val paused = store.commit(CaptureCommitRequest(fourth, eventFor(fourth), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal"))

        assertEquals(CaptureCommitResult.IntakePaused, paused)
        assertEquals(3, store.storedIntakeCount())
        assertEquals(setOf(first.observationId, second.observationId, third.observationId), store.nextBatch(50).map { it.localId }.toSet())
    }

    @Test
    fun acknowledgedAndConfirmedIdentitiesReleaseCapacityForNewCapture() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore(), pendingLimit = 2)
        val queued = SyntheticNotificationFixtures.observed(messageIdentity = "capacity-queued", key = "capacity-queued-key")
        val review = SyntheticNotificationFixtures.observed(messageIdentity = "capacity-review", key = "capacity-review-key")
        val replacement = SyntheticNotificationFixtures.observed(messageIdentity = "capacity-replacement", key = "capacity-replacement-key")
        val queuedEvent = eventFor(queued)
        val reviewEvent = eventFor(review)

        assertTrue(store.commit(CaptureCommitRequest(queued, queuedEvent, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)
        assertTrue(store.commit(CaptureCommitRequest(review, reviewEvent, CaptureCandidateDisposition.REVIEW, ownerLedgerId = "personal")) is CaptureCommitResult.ReviewStored)
        assertEquals(2, store.storedIntakeCount())

        store.applyAcknowledgements(listOf(AlertAcknowledgement(queuedEvent.eventId, "accepted")))
        store.markConfirmed(reviewEvent.eventId)

        assertEquals(0, store.storedIntakeCount())
        assertTrue(
            store.commit(CaptureCommitRequest(replacement, eventFor(replacement), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is
                CaptureCommitResult.Queued,
        )
    }

    @Test
    fun sameEventIdAcrossDistinctObservationsIsIdempotentButChangedPayloadConflicts() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore())
        val first = SyntheticNotificationFixtures.observed(messageIdentity = "same-event-first", key = "same-event-first-key")
        val replay = SyntheticNotificationFixtures.observed(messageIdentity = "same-event-replay", key = "same-event-replay-key")
        val changed = SyntheticNotificationFixtures.observed(
            body = "交易提醒\n消费\n交易金额: CAD 99.99\n商户名称: Different Synthetic Market",
            messageIdentity = "same-event-changed",
            key = "same-event-changed-key",
        )
        val firstEvent = eventFor(first)
        val replayEvent = eventFor(replay).copy(
            eventId = firstEvent.eventId,
            capturedAt = "2026-10-13T12:34:56Z",
        )
        val changedEvent = eventFor(changed).copy(eventId = firstEvent.eventId)

        assertTrue(store.commit(CaptureCommitRequest(first, firstEvent, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)
        assertEquals(
            CaptureCommitResult.AlreadyProcessed(firstEvent.eventId),
            store.commit(CaptureCommitRequest(replay, replayEvent, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")),
        )
        assertEquals(
            CaptureCommitResult.Conflict(firstEvent.eventId),
            store.commit(CaptureCommitRequest(changed, changedEvent, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")),
        )
        assertEquals(1, store.snapshot().candidates.size)
        assertEquals(1, store.snapshot().outbox.size)
    }

    @Test
    fun mixedQueuedReviewAndDuplicateEvidenceUseOneSlotPerEventIdentity() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore(), pendingLimit = 4)
        val queued = SyntheticNotificationFixtures.observed(messageIdentity = "queued", key = "queued-key")
        val review = SyntheticNotificationFixtures.observed(messageIdentity = "review", key = "review-key")
        val duplicate = SyntheticNotificationFixtures.observed(messageIdentity = null, key = "duplicate-key", generation = 1L)
        val duplicateEvidence = SyntheticNotificationFixtures.observed(messageIdentity = null, key = "duplicate-key", generation = 2L)

        assertTrue(store.commit(CaptureCommitRequest(queued, eventFor(queued), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)
        assertTrue(store.commit(CaptureCommitRequest(review, eventFor(review), CaptureCandidateDisposition.REVIEW, ownerLedgerId = "personal")) is CaptureCommitResult.ReviewStored)
        assertTrue(store.commit(CaptureCommitRequest(duplicate, null, CaptureCandidateDisposition.REVIEW, ownerLedgerId = "personal")) is CaptureCommitResult.ReviewStored)
        assertTrue(store.commit(CaptureCommitRequest(duplicateEvidence, null, CaptureCandidateDisposition.REVIEW, ownerLedgerId = "personal")) is CaptureCommitResult.ReviewStored)
        assertEquals(4, store.storedIntakeCount())
        assertTrue(store.commit(CaptureCommitRequest(review, eventFor(review), CaptureCandidateDisposition.REVIEW, ownerLedgerId = "personal")) is CaptureCommitResult.AlreadyProcessed)
        assertEquals(4, store.storedIntakeCount())

        val pausedReview = store.commit(
            CaptureCommitRequest(
                SyntheticNotificationFixtures.observed(messageIdentity = null, key = "new-review-key", generation = 1L),
                null,
                CaptureCandidateDisposition.REVIEW,
            ownerLedgerId = "personal"),
        )
        val pausedQueuedMessage = SyntheticNotificationFixtures.observed(messageIdentity = "new-queued", key = "new-queued-key")
        val pausedQueued = store.commit(
            CaptureCommitRequest(pausedQueuedMessage, eventFor(pausedQueuedMessage), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal"),
        )

        assertEquals(CaptureCommitResult.IntakePaused, pausedReview)
        assertEquals(CaptureCommitResult.IntakePaused, pausedQueued)
        val snapshot = store.snapshot()
        assertEquals(
            setOf(queued.observationId, review.observationId, duplicate.observationId, duplicateEvidence.observationId),
            snapshot.observations.map { it.observationId }.toSet(),
        )
        assertEquals(2, snapshot.candidates.size)
        assertEquals(setOf(eventFor(queued).eventId), store.nextBatch(50).map { it.eventId }.toSet())
    }

    @Test
    fun fiveThousandQueuedEventsAreAllowedAndTheFiveThousandAndFirstPauses() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore())

        val requests = (0 until 5_000).map { index ->
            val message = SyntheticNotificationFixtures.observed(
                messageIdentity = "bounded-$index",
                key = "bounded-key-$index",
            )
            CaptureCommitRequest(message, eventFor(message), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")
        }
        val results = store.commitBatch(requests)
        assertEquals(5_000, results.count { it is CaptureCommitResult.Queued })
        assertEquals(5_000, store.storedIntakeCount())

        val overLimit = SyntheticNotificationFixtures.observed(
            messageIdentity = "bounded-over-limit",
            key = "bounded-over-limit-key",
        )
        assertEquals(
            CaptureCommitResult.IntakePaused,
            store.commit(CaptureCommitRequest(overLimit, eventFor(overLimit), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")),
        )
        assertEquals(5_000, store.storedIntakeCount())
        assertEquals(5_000, store.pendingCount())
    }

    @Test
    fun queuedPayloadAndOriginalPostTimeSurviveStoreRestartAndCredentialRenewal() = runTest {
        val records = InMemoryRecordStore()
        val firstStore = EncryptedCaptureIntakeStore(records)
        val message = SyntheticNotificationFixtures.observed(
            messageIdentity = "recovered-message",
            key = "reconnected-key",
            postTime = Instant.parse("2026-10-13T04:00:00Z").toEpochMilli(),
            capturedAt = Instant.parse("2026-10-13T12:00:00Z").toEpochMilli(),
        ).copy(origin = ObservationOrigin.ACTIVE_RECOVERY)
        val event = eventFor(message)

        assertTrue(firstStore.commit(CaptureCommitRequest(message, event, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")) is CaptureCommitResult.Queued)

        val restarted = EncryptedCaptureIntakeStore(records)
        val queued = restarted.nextBatch(50).single()
        assertEquals(event.eventId, queued.eventId)
        assertEquals(event.notificationPostedAt, BankAlertEventCodec.decode(queued.payload).notificationPostedAt)
        assertEquals(0, restarted.commit(CaptureCommitRequest(message, event, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal")).let { if (it is CaptureCommitResult.AlreadyProcessed) 0 else 1 })
    }

    @Test
    fun retentionRemovesAcknowledgedEvidenceButKeepsUnsentAndConfirmedHistory() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore())
        val acknowledged = SyntheticNotificationFixtures.observed(messageIdentity = "ack", key = "ack-key")
        val unsent = SyntheticNotificationFixtures.observed(messageIdentity = "unsent", key = "unsent-key")
        val confirmed = SyntheticNotificationFixtures.observed(messageIdentity = "confirmed", key = "confirmed-key")
        store.commit(CaptureCommitRequest(acknowledged, eventFor(acknowledged), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal"))
        store.commit(CaptureCommitRequest(unsent, eventFor(unsent), CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal"))
        store.commit(CaptureCommitRequest(confirmed, eventFor(confirmed), CaptureCandidateDisposition.REVIEW, ownerLedgerId = "personal"))
        store.applyAcknowledgements(listOf(AlertAcknowledgement(eventFor(acknowledged).eventId, "accepted")))
        store.markConfirmed(eventFor(confirmed).eventId)

        store.retain(
            nowMillis = Instant.parse("2026-10-15T05:00:00Z").toEpochMilli(),
        )

        assertEquals(setOf(eventFor(unsent).eventId), store.nextBatch(50).map { it.eventId }.toSet())
        assertTrue(store.snapshot().candidates.any { it.eventId == eventFor(confirmed).eventId && it.status == CaptureCandidateStatus.CONFIRMED })
    }

    @Test
    fun reviewQuarantinePersistsReceiptRevisionAndErrorBeforeRetention() = runTest {
        val store = EncryptedCaptureIntakeStore(InMemoryRecordStore(), clock = { 1_800_000_000_000L })
        val message = SyntheticNotificationFixtures.observed(messageIdentity = "conflict", key = "conflict-key")
        val event = eventFor(message)
        store.commit(CaptureCommitRequest(message, event, CaptureCandidateDisposition.QUEUED, ownerLedgerId = "personal"))

        store.applyAcknowledgements(listOf(
            AlertAcknowledgement(
                eventId = event.eventId,
                code = "idempotency_conflict",
                disposition = CaptureAcknowledgementDisposition.REVIEW,
                receiptId = null,
                revision = null,
                errorCode = "idempotency_conflict",
            ),
        ))

        val candidate = store.snapshot().candidates.single()
        assertEquals(CaptureCandidateStatus.REVIEW, candidate.status)
        assertEquals("idempotency_conflict", candidate.acknowledgementCode)
        assertEquals("idempotency_conflict", candidate.acknowledgementErrorCode)
        assertTrue(store.nextBatch(50).isEmpty())
    }

    private fun eventFor(message: com.lofuyu.borderledger.capture.ObservedBankMessage) = when (
        val result = BocCreditCardParser(eventIdProvider = eventIds).parse(
            message,
            SyntheticNotificationFixtures.bocProfile(),
        )
    ) {
        is ParseResult.Complete -> result.event
        is ParseResult.NeedsReview -> requireNotNull(result.event)
        is ParseResult.Ignored -> error("synthetic event was unexpectedly ignored")
    }
}

private open class InMemoryRecordStore : EncryptedRecordStore {
    private val values = mutableMapOf<String, ByteArray>()

    override suspend fun read(record: String): ByteArray? = values[record]?.copyOf()
    override suspend fun write(record: String, value: ByteArray) { values[record] = value.copyOf() }
    override suspend fun delete(record: String) { values.remove(record) }
}

private class FailingRecordStore : InMemoryRecordStore() {
    var failNextWrite: Boolean = false

    override suspend fun write(record: String, value: ByteArray) {
        if (failNextWrite) {
            failNextWrite = false
            error("synthetic encrypted storage failure")
        }
        super.write(record, value)
    }
}
