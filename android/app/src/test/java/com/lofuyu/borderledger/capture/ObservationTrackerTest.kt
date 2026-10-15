package com.lofuyu.borderledger.capture

import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures.observed
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ObservationTrackerTest {
    private val activatedAt = Instant.parse("2026-10-01T00:00:00Z").toEpochMilli()
    private val now = Instant.parse("2026-10-13T12:00:00Z").toEpochMilli()

    @Test
    fun reusedNotificationKeyWithNewMessageIdentityProducesDistinctObservation() {
        val tracker = ObservationTracker(activatedAtMillis = activatedAt) { now }
        val first = observed(messageIdentity = "message-1", key = "reused-key", postTime = now - 1_000L)
        val second = observed(messageIdentity = "message-2", key = "reused-key", postTime = now - 500L)

        val firstDiff = tracker.diff(listOf(first))
        val secondDiff = tracker.diff(listOf(second, first))

        assertEquals(1, firstDiff.newObservations.size)
        assertEquals(1, secondDiff.newObservations.size)
        assertEquals("message-2", secondDiff.newObservations.single().messageIdentity)
        assertEquals(1, secondDiff.replayedObservations.size)
        assertNotEquals(first.observationId, secondDiff.newObservations.single().observationId)
    }

    @Test
    fun sameObservationReplayIsIgnoredAndKeyUpdateKeepsOriginalEventTime() {
        val tracker = ObservationTracker(activatedAtMillis = activatedAt) { now }
        val originalTime = now - 4_000L
        val first = observed(messageIdentity = "stable-message", key = "key-a", generation = 1L, postTime = originalTime)
        val updated = observed(messageIdentity = "stable-message", key = "key-b", generation = 2L, postTime = now - 1_000L)

        tracker.diff(listOf(first))
        val replay = tracker.diff(listOf(updated))

        assertEquals(0, replay.newObservations.size)
        assertEquals(1, replay.replayedObservations.size)
        assertEquals(originalTime, replay.replayedObservations.single().notificationPostedAtMillis)
    }

    @Test
    fun removedAndRecreatedUnknownMessageIsReviewableInsteadOfConfidentDuplicate() {
        val tracker = ObservationTracker(activatedAtMillis = activatedAt) { now }
        val first = observed(messageIdentity = null, key = "key", generation = 1L, postTime = now - 2_000L)
        val recreated = observed(messageIdentity = null, key = "key", generation = 2L, postTime = now - 2_000L)

        tracker.diff(listOf(first))
        val diff = tracker.diff(listOf(recreated))

        assertEquals(0, diff.newObservations.size)
        assertEquals(1, diff.reviewObservations.size)
        assertTrue(diff.reviewObservations.single().observationDisposition == ObservationDisposition.POSSIBLE_DUPLICATE_REVIEW)
    }

    @Test
    fun preActivationAndOldUnidentifiedRecoveryRequireHistoricalReview() {
        val tracker = ObservationTracker(activatedAtMillis = activatedAt) { now }
        val old = observed(
            messageIdentity = null,
            key = "old-key",
            postTime = Instant.parse("2026-09-30T23:59:59Z").toEpochMilli(),
            capturedAt = now,
        )

        val diff = tracker.diff(listOf(old))

        assertEquals(0, diff.newObservations.size)
        assertEquals(1, diff.reviewObservations.size)
        assertEquals(ObservationDisposition.HISTORICAL_REVIEW, diff.reviewObservations.single().observationDisposition)
    }

    @Test
    fun outputOrderIsDeterministicRegardlessOfSnapshotOrder() {
        val first = observed(messageIdentity = "message-a", key = "key-a", postTime = now - 2_000L)
        val second = observed(messageIdentity = "message-b", key = "key-b", postTime = now - 1_000L)

        val forward = ObservationTracker(activatedAtMillis = activatedAt) { now }.diff(listOf(first, second))
        val reverse = ObservationTracker(activatedAtMillis = activatedAt) { now }.diff(listOf(second, first))

        assertEquals(
            forward.newObservations.map { it.observationId },
            reverse.newObservations.map { it.observationId },
        )
    }

    @Test
    fun separateStableEqualMessagesRemainDistinct() {
        val tracker = ObservationTracker(activatedAtMillis = activatedAt) { now }
        val first = observed(messageIdentity = "equal-a", key = "key-a", postTime = now - 2_000L)
        val second = observed(messageIdentity = "equal-b", key = "key-b", postTime = now - 2_000L)

        val diff = tracker.diff(listOf(first, second))

        assertEquals(2, diff.newObservations.size)
        assertNotEquals(diff.newObservations[0].observationId, diff.newObservations[1].observationId)
    }

    @Test
    fun unidentifiedRepeatedObservationIsReviewEvidenceInsteadOfSilentReplay() {
        val tracker = ObservationTracker(activatedAtMillis = activatedAt) { now }
        val first = observed(messageIdentity = null, key = "same-key", generation = 1L, postTime = now - 2_000L)
        val repeated = observed(messageIdentity = null, key = "same-key", generation = 1L, postTime = now - 2_000L)

        tracker.diff(listOf(first))
        val diff = tracker.diff(listOf(repeated))

        assertEquals(1, diff.reviewObservations.size)
        assertEquals(ObservationDisposition.POSSIBLE_DUPLICATE_REVIEW, diff.reviewObservations.single().observationDisposition)
        assertEquals(1, diff.duplicateReviewEvidence.size)
        assertEquals(repeated.observationId, diff.duplicateReviewEvidence.single().observationId)
    }

    @Test
    fun childObservationIdStaysStableWhenSummaryGainsAndReordersASibling() {
        val profile = SyntheticNotificationFixtures.bocProfile()
        val extractor = NotificationExtractor()
        val child = NotificationMessageSnapshot("stable-child", now - 2_000L, "Bank of China", "交易提醒 消费 交易金额: CAD 2.00")
        val sibling = NotificationMessageSnapshot("new-sibling", now - 1_000L, "Bank of China", "交易提醒 消费 交易金额: CAD 3.00")

        val first = extractor.extract(
            SyntheticNotificationFixtures.snapshot(isSummary = true, groupKey = "group-1", children = listOf(child)),
            profile,
        ) as ExtractionResult.Accepted
        val updated = extractor.extract(
            SyntheticNotificationFixtures.snapshot(isSummary = true, groupKey = "group-1", children = listOf(sibling, child)),
            profile,
        ) as ExtractionResult.Accepted

        val firstChild = first.messages.single { it.messageIdentity == "stable-child" }
        val updatedChild = updated.messages.single { it.messageIdentity == "stable-child" }

        assertNotEquals(firstChild.snapshotMultiplicity, updatedChild.snapshotMultiplicity)
        assertNotEquals(firstChild.snapshotOrdinal, updatedChild.snapshotOrdinal)
        assertEquals(firstChild.observationId, updatedChild.observationId)
        assertEquals(firstChild.observationId, ObservationTracker(activatedAtMillis = activatedAt) { now }
            .diff(listOf(updatedChild)).newObservations.single().observationId)
    }
}
