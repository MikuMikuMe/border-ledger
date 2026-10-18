package com.lofuyu.borderledger.core

import com.lofuyu.borderledger.ui.ledger.*
import kotlin.test.*

class LedgerRulesTest {
    private fun transaction(id: String, amount: Long, currency: String, status: String) = LedgerTransaction(
        id, "2026-10-16T12:00:00Z", currency, amount, "Cafe", "Checking", status, "Bank", "Food", "note",
    )
    private fun snapshot(items: List<LedgerTransaction>) = LedgerSnapshot(1, "2026-10-16T12:00:00Z", "America/Toronto", emptyList(), items, emptyList(), emptyList())

    @Test fun confirmedTotalsRetainSignedRefundsAndCurrencySeparation() {
        val items = listOf(transaction("a", 100, "CAD", " Posted "), transaction("b", -25, "CAD", "confirmed"),
            transaction("c", 500, "USD", "reconciled"), transaction("d", 999, "CAD", "needs_review"),
            transaction("e", 999, "CAD", "declined"))
        assertEquals(mapOf("CAD" to 75L, "USD" to 500L), snapshot(items).confirmedTotals())
        assertEquals(listOf("d"), snapshot(items).reviewTransactions().map { it.id })
    }

    @Test fun listSearchIncludesIdButSnapshotSearchPreservesOriginalFieldSet() {
        val item = transaction("unique-id", 100, "CAD", "posted")
        assertEquals(listOf(item), listOf(item).filterTransactions(ActivityFilters(query = " Unique-ID ")))
        assertEquals(emptyList(), snapshot(listOf(item)).searchTransactions("unique-id"))
        assertEquals(listOf(item), snapshot(listOf(item)).filterTransactions(ActivityFilters(query = "cAfE", currency = "CAD")))
        assertEquals(emptyList(), listOf(item).filterTransactions(ActivityFilters(currency = "USD")))
    }

    @Test fun minorUnitTransportIsExactAboveJavascriptSafeInteger() {
        assertEquals("9007199254740993", minorUnitsToDecimalString(9007199254740993L))
        assertEquals("-9223372036854775808", minorUnitsToDecimalString(Long.MIN_VALUE))
    }
}
