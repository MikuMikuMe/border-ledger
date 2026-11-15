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
