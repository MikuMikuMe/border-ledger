package com.lofuyu.borderledger.ui.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class LedgerUiModelTest {
    @Test
    fun confirmedTotalsExcludeReviewAndVoidedRecordsWithoutChangingActivityRows() {
        val snapshot = LedgerSnapshot(
            schemaVersion = 1,
            snapshotAt = "2026-10-13T12:00:00Z",
            timeZone = "America/Toronto",
            accounts = emptyList(),
            transactions = listOf(
                transaction("purchase", 1250, "confirmed"),
                transaction("refund", -200, "posted"),
                transaction("review", 5000, "needs_review"),
                transaction("void", 900, "void"),
            ),
            recurring = emptyList(),
            reviews = emptyList(),
        )

        assertEquals(1050L, snapshot.confirmedTotals()["CAD"])
        assertEquals(4, snapshot.transactions.size)
        assertEquals(1, snapshot.reviewTransactions().size)
    }

    @Test
    fun activitySearchKeepsSameAmountTransactionsDistinct() {
        val first = transaction("purchase-1", 1000, "confirmed").copy(merchant = "Coffee North")
        val second = transaction("purchase-2", 1000, "confirmed").copy(merchant = "Coffee South")
        val snapshot = emptySnapshot().copy(transactions = listOf(first, second))

        val matches = snapshot.searchTransactions("South")

        assertEquals(listOf("purchase-2"), matches.map { it.id })
        assertTrue(snapshot.searchTransactions("1000").isEmpty())
    }

    @Test
    fun activityFiltersComposeWithoutConvertingCurrencies() {
        val cad = transaction("cad", 1000, "confirmed").copy(category = "food", sourceLabel = "statement")
        val jpy = transaction("jpy", 100000, "confirmed").copy(currency = "JPY", category = "travel", sourceLabel = "alert")
        val snapshot = emptySnapshot().copy(transactions = listOf(cad, jpy))

        assertEquals(listOf("cad"), snapshot.filterTransactions(ActivityFilters(currency = "CAD", category = "food")).map { it.id })
        assertEquals(listOf("jpy"), snapshot.filterTransactions(ActivityFilters(source = "alert")).map { it.id })
    }

    @Test
    fun reportWindowsUseReportingDateWithoutFxConversion() {
        val today = LocalDate.parse("2026-10-14")

        assertEquals(ReportDateWindow(today, today), reportDateWindow(ReportWindow.Today, today))
        assertEquals(ReportDateWindow(LocalDate.parse("2026-10-12"), today), reportDateWindow(ReportWindow.Week, today))
        assertEquals(ReportDateWindow(LocalDate.parse("2026-10-01"), today), reportDateWindow(ReportWindow.Month, today))

        val remote = listOf(
            transaction("cad", 1000, "confirmed"),
            transaction("jpy", 100000, "confirmed").copy(currency = "JPY"),
        )
        assertEquals(listOf("jpy"), remote.filterTransactions(ActivityFilters(currency = "JPY")).map { it.id })
    }

    private fun emptySnapshot() = LedgerSnapshot(1, "2026-10-13T12:00:00Z", "America/Toronto", emptyList(), emptyList(), emptyList(), emptyList())

    private fun transaction(id: String, amount: Long, status: String) = LedgerTransaction(
        id = id,
        occurredAt = "2026-10-13T10:00:00Z",
        currency = "CAD",
        signedMinorUnits = amount,
        merchant = id,
        accountLabel = "Everyday",
        status = status,
        sourceLabel = "Bank",
        category = null,
        note = null,
    )
}
