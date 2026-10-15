package com.lofuyu.borderledger.review

import com.lofuyu.borderledger.api.TransportFailure
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewViewModelTest {
    @Test
    fun staleLocalRevisionDoesNotCallWorker() = runTest {
        val api = FakeReviewRepository(initialPage())
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.resolve(initialAlert().copy(revision = 3), ReviewDecision.IGNORE)
        runCurrent()

        assertTrue(api.reviewCalls.isEmpty())
        assertEquals("This review changed locally; refresh before saving.", viewModel.state.value.actionError)
        assertNull(viewModel.state.value.actionMessage)
    }

    @Test
    fun conflictRetainsRowsAndRefreshesAuthoritativePage() = runTest {
        val refreshed = initialAlert().copy(revision = 5, state = "needs_review")
        val api = FakeReviewRepository(initialPage(), ReviewRevisionConflict(5), pageOf(refreshed))
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.resolve(initialAlert(), ReviewDecision.IGNORE)
        runCurrent()

        assertEquals(listOf(Triple(initialAlert().eventId, 4, ReviewDecision.IGNORE)), api.reviewCalls)
        assertEquals(5, viewModel.state.value.items.single().revision)
        assertTrue(viewModel.state.value.actionError?.contains("changed elsewhere") == true)
        assertFalse(viewModel.state.value.pendingActionKey != null)
    }

    @Test
    fun acknowledgedActionRefreshesAndOnlyThenReportsAccepted() = runTest {
        val accepted = initialAlert().copy(state = "non_spending", revision = 5)
        val api = FakeReviewRepository(
            initialPage(),
            ReviewRevisionAck("event-1", 5, "2026-10-14T12:00:00Z"),
            pageOf(accepted),
        )
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.resolve(initialAlert(), ReviewDecision.IGNORE)
        runCurrent()

        assertEquals("non_spending", viewModel.state.value.items.single().state)
        assertEquals("Review decision accepted at revision 5.", viewModel.state.value.actionMessage)
        assertNull(viewModel.state.value.actionError)
    }

    @Test
    fun offlineActionDoesNotClaimSuccess() = runTest {
        val api = FakeReviewRepository(initialPage(), TransportFailure.Offline)
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.resolve(initialAlert(), ReviewDecision.IGNORE)
        runCurrent()

        assertNull(viewModel.state.value.actionMessage)
        assertEquals("Review actions are unavailable offline; no change was applied.", viewModel.state.value.actionError)
        assertEquals("needs_review", viewModel.state.value.items.single().state)
    }

    @Test
    fun linkActionIsDisabledWhenCandidateTargetOrRelationIsMissing() = runTest {
        val api = FakeReviewRepository(pageOf(initialAlert()))
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.resolve(initialAlert(), ReviewDecision.LINK)
        runCurrent()

        assertTrue(api.reviewCalls.isEmpty())
        assertEquals(
            "Link disabled: no valid candidate, target transaction, and supported relation are available.",
            viewModel.state.value.actionError,
        )
    }

    @Test
    fun linkActionSendsCandidateTargetRelationAndExpectedRevision() = runTest {
        val linked = initialAlert().copy(state = "superseded", revision = 5)
        val api = FakeReviewRepository(
            initialPage(initialAlert().copy(linkAction = linkAction())),
            ReviewRevisionAck("event-1", 5, "2026-10-14T12:00:00Z"),
            pageOf(linked),
        )
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.resolve(initialAlert().copy(linkAction = linkAction()), ReviewDecision.LINK)
        runCurrent()

        assertEquals(listOf(Triple("11111111-1111-4111-8111-111111111111", 4, ReviewDecision.LINK)), api.reviewCalls)
        assertEquals("statement-1", api.reviewTargetCalls.single().targetId)
        assertEquals("event-1", api.reviewTargetCalls.single().candidateTransactionId)
        assertEquals(ReviewRelation.CONFIRMS, api.reviewTargetCalls.single().relation)
    }

    @Test
    fun unsupportedReviewDecisionsRemainExplicitlyDisabled() {
        val unsupportedLink = initialAlert().copy(
            linkAction = ReviewLinkActionDto(
                targetId = "alert-target",
                candidateTransactionId = "event-1",
                relation = ReviewRelation.CANCELS,
                allocatedMoney = ReviewMoney("CAD", 1234),
            ),
        )

        assertEquals(CLASSIFICATION_UNSUPPORTED_REASON, initialAlert().actionDisabledReason(ReviewDecision.CLASSIFY))
        assertEquals(LINK_RELATION_UNSUPPORTED_REASON, unsupportedLink.actionDisabledReason(ReviewDecision.LINK))
    }

    @Test
    fun annotationSaveUsesBoundRowRevisionAndRefreshesAuthoritativeData() = runTest {
        val edited = annotatedAlert().copy(annotation = ReviewAnnotationDto("event-1", 3, "Food", "Updated"))
        val api = FakeReviewRepository(
            initialPage(annotatedAlert()),
            refreshed = pageOf(edited),
        )
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.saveAnnotation(annotatedAlert(), "Food", "Updated")
        runCurrent()

        assertEquals(listOf(Triple("event-1", 2, "Food")), api.annotationCalls)
        assertEquals("Updated", viewModel.state.value.items.single().annotation?.note)
        assertEquals("Category and note accepted at revision 3.", viewModel.state.value.actionMessage)
    }

    @Test
    fun staleAnnotationRevisionRefreshesWithoutClaimingSuccess() = runTest {
        val api = FakeReviewRepository(
            initialPage(annotatedAlert()),
            annotationResult = ReviewRevisionConflict(3),
            refreshed = pageOf(annotatedAlert().copy(annotation = ReviewAnnotationDto("event-1", 3, "Food", "Server edit"))),
        )
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.saveAnnotation(annotatedAlert(), "Food", "Client edit")
        runCurrent()

        assertNull(viewModel.state.value.actionMessage)
        assertTrue(viewModel.state.value.actionError?.contains("changed elsewhere at revision 3") == true)
        assertEquals("Server edit", viewModel.state.value.items.single().annotation?.note)
    }

    @Test
    fun annotationIsDisabledWhenReviewRowHasNoPersonalTransactionTarget() = runTest {
        val api = FakeReviewRepository(initialPage())
        val viewModel = ReviewViewModel(api, this)
        viewModel.refresh()
        runCurrent()

        viewModel.saveAnnotation(initialAlert(), "Food", "Should not write")
        runCurrent()

        assertTrue(api.annotationCalls.isEmpty())
        assertEquals(ANNOTATION_UNSUPPORTED_REASON, viewModel.state.value.actionError)
    }

    @Test
    fun snapshotActionGateReasonNamesMissingEventAndTransactionRevisions() {
        assertTrue(SNAPSHOT_REVIEW_ACTION_DISABLED_REASON.contains("event ID and revision"))
        assertTrue(SNAPSHOT_ANNOTATION_DISABLED_REASON.contains("transaction revision"))
        assertTrue(LIVE_ANNOTATION_DISABLED_REASON.contains("transaction ID or transaction revision"))
    }

    private companion object {
        fun initialAlert() = ReviewAlertDto(
            eventId = "11111111-1111-4111-8111-111111111111",
            eventType = "purchase_notice",
            state = "needs_review",
            countedMoney = ReviewMoney("CAD", 1234),
            reportingDate = "2026-10-14",
            revision = 4,
        )

        fun linkAction() = ReviewLinkActionDto(
            targetId = "statement-1",
            candidateTransactionId = "event-1",
            relation = ReviewRelation.CONFIRMS,
            allocatedMoney = null,
        )

        fun initialPage(alert: ReviewAlertDto = initialAlert()) = pageOf(alert)

        fun annotatedAlert() = initialAlert().copy(
            transactionId = "event-1",
            annotation = ReviewAnnotationDto("event-1", 2, "Travel", "Existing note"),
            annotationDisabledReason = null,
        )

        fun pageOf(vararg alerts: ReviewAlertDto) = ReviewPageDto(alerts.toList(), null, alerts.size.coerceAtLeast(1))
    }
}

private class FakeReviewRepository(
    private val initial: ReviewPageDto,
    private var actionResult: Any? = ReviewRevisionAck("event-1", 5, "2026-10-14T12:00:00Z"),
    private var refreshed: ReviewPageDto = initial,
    private var annotationResult: Any? = ReviewRevisionAck("event-1", 3, "2026-10-14T12:00:00Z"),
) : ReviewRepository {
    private var reads = 0
    val reviewCalls = mutableListOf<Triple<String, Int, ReviewDecision>>()
    val reviewTargetCalls = mutableListOf<ReviewTargetCall>()
    val annotationCalls = mutableListOf<Triple<String, Int, String>>()

    override suspend fun readAlerts(query: ReviewQuery): ReviewPageDto = if (reads++ == 0) initial else refreshed

    override suspend fun reviewAlert(
        eventId: String,
        expectedRevision: Int,
        decision: ReviewDecision,
        targetId: String?,
        candidateTransactionId: String?,
        relation: ReviewRelation?,
        allocatedMoney: ReviewMoney?,
    ): ReviewRevisionAck {
        reviewCalls += Triple(eventId, expectedRevision, decision)
        reviewTargetCalls += ReviewTargetCall(targetId, candidateTransactionId, relation)
        val result = actionResult
        if (result is Throwable) throw result
        return result as ReviewRevisionAck
    }

    override suspend fun annotateTransaction(
        transactionId: String,
        expectedRevision: Int,
        category: String,
        note: String?,
    ): ReviewRevisionAck {
        annotationCalls += Triple(transactionId, expectedRevision, category)
        val result = annotationResult
        if (result is Throwable) throw result
        return result as ReviewRevisionAck
    }
}

private data class ReviewTargetCall(
    val targetId: String?,
    val candidateTransactionId: String?,
    val relation: ReviewRelation?,
)
