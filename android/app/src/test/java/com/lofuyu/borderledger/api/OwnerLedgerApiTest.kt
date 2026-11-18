package com.lofuyu.borderledger.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnerLedgerApiTest {
    @Test
    fun reportQuerySeparatesSourceCurrencyFromReportingTargetInTheSerializedPath() {
        val query = OwnerReportQuery(
            startDate = "2026-10-01",
            endDate = "2026-10-14",
            currency = "USD",
            reportingCurrency = "CAD",
            category = "Food & Dining",
        )

        val path = ownerReportRequestUrl("https://pf.example", query)

        assertEquals(
            "https://pf.example/api/mobile/v1/reports/summary?startDate=2026-10-01&endDate=2026-10-14&includeProvisional=false&timeZone=America%2FToronto&currency=USD&reportingCurrency=CAD&category=Food+%26+Dining",
            path,
        )
    }

    @Test
    fun transactionQueryAcceptsMaximumTransactionIdLength() {
        assertEquals(160, OwnerTransactionQuery(query = "a".repeat(160)).query?.length)
        assertTrue(runCatching { OwnerTransactionQuery(query = "a".repeat(161)) }.isFailure)
        assertEquals(1024, OwnerTransactionQuery(cursor = "a".repeat(1024)).cursor?.length)
        assertTrue(runCatching { OwnerTransactionQuery(cursor = "a".repeat(1025)) }.isFailure)
    }

    @Test
    fun reportQueryRejectsUnregisteredReportingTargets() {
        var rejected = false
        try {
            OwnerReportQuery("2026-10-01", "2026-10-14", reportingCurrency = "XYZ")
        } catch (_: IllegalArgumentException) {
            rejected = true
        }
        assertTrue(rejected)
    }
}
