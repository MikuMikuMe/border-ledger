package com.lofuyu.borderledger.recurring

import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecurringViewModelTest {
    @Test
    fun staleClassificationCallbackDoesNotWriteAndSurfacesRevisionError() = runTest {
        val api = FakeRecurringApi(detail = detail(revision = 4, classification = "unclassified"))
        val viewModel = RecurringDetailViewModel(RecurringRepository(api), this)

        viewModel.load("stream-1")
        runCurrent()

        viewModel.saveClassification("stream-1", expectedRevision = 3, classification = "bill")
        runCurrent()

        val state = viewModel.state.value as RecurringDetailState.Ready
        assertTrue(api.classifyCalls.isEmpty())
        assertEquals("The recurring stream changed; refresh before saving.", state.saveError)
        assertEquals(false, state.saving)
    }

    @Test
    fun acknowledgedClassificationReloadsAuthoritativeDetail() = runTest {
        val api = FakeRecurringApi(
            detail = detail(revision = 4, classification = "unclassified"),
            refreshedDetail = detail(revision = 5, classification = "bill"),
        )
        val viewModel = RecurringDetailViewModel(RecurringRepository(api), this)

        viewModel.load("stream-1")
        runCurrent()
        viewModel.saveClassification("stream-1", expectedRevision = 4, classification = "bill")
        runCurrent()

        val state = viewModel.state.value as RecurringDetailState.Ready
        assertEquals(listOf(Triple("stream-1", 4, "bill")), api.classifyCalls)
        assertEquals("bill", state.detail.classification)
        assertEquals(5, state.detail.stream.revision)
        assertFalse(state.saving)
        assertNull(state.saveError)
    }
}

private class FakeRecurringApi(
    private val detail: RecurringDetailDto,
    private val refreshedDetail: RecurringDetailDto = detail,
) : OwnerRecurringApi {
    private var readCount = 0
    val classifyCalls = mutableListOf<Triple<String, Int, String>>()

    override suspend fun readPage(query: RecurringQuery): RecurringPageDto = error("not used")

    override suspend fun readSummary(query: RecurringSummaryQuery): RecurringSummaryDto = error("not used")

    override suspend fun readDetail(id: String, cursor: String?, limit: Int): RecurringDetailDto =
        if (readCount++ == 0) detail else refreshedDetail

    override suspend fun classify(id: String, expectedRevision: Int, classification: String): RecurringClassificationAck {
        classifyCalls += Triple(id, expectedRevision, classification)
        return RecurringClassificationAck(id, expectedRevision + 1, "2026-10-14T00:00:00Z")
    }
}

private fun detail(revision: Int, classification: String): RecurringDetailDto {
    val stream = RecurringStreamDto(
        id = "stream-1",
        accountId = "account-1",
        currency = "CAD",
        merchantName = "Transit",
        merchantEntityId = null,
        frequency = "MONTHLY",
        sourceFrequency = null,
        classification = classification,
        sourceStatus = "MATURE",
        isOutflow = true,
        firstDate = "2026-01-01",
        lastDate = "2026-10-01",
        averageAmountMinor = -1234,
        lastAmountMinor = -1234,
        predictedAmountMinor = -1234,
        predictedNextDate = "2026-11-01",
        sourceUpdatedAt = "2026-10-14T00:00:00Z",
        revision = revision,
    )
    return RecurringDetailDto(
        stream = stream,
        history = emptyList(),
        page = RecurringPageInfo(nextCursor = null, limit = 50),
        classification = classification,
    )
}
