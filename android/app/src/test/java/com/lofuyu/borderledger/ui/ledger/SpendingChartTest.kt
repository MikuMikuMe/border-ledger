package com.lofuyu.borderledger.ui.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpendingChartTest {
    @Test
    fun sourceCurrenciesUseIndependentLanesWithoutFabricatedZeros() {
        val report = LedgerReport(
            timeBasis = "accounting_date",
            currencyTotals = listOf(
                LedgerReportCurrencyTotal("USD", 100, 0, 1, 0),
                LedgerReportCurrencyTotal("CNY", 200, 0, 1, 0),
                LedgerReportCurrencyTotal("CAD", 300, 0, 1, 0),
            ),
            dailyTotals = listOf(
                LedgerReportDailyTotal("2026-10-01", "USD", 100, 0),
                LedgerReportDailyTotal("2026-10-01", "CNY", 200, 0),
            ),
            reviewCount = 0,
            excludedCount = 0,
        )

        assertEquals(listOf("CAD", "CNY", "USD"), chartCurrencies(report, false))
        assertEquals(listOf(100L), chartLanes(report, false).first { it.currency == "USD" }.points.map { it.amountMinorUnits })
        assertEquals(2, chartLanes(report, false).size)
    }

    @Test
    fun emptyIncompleteTargetIsExplicitlyUnavailable() {
        val report = LedgerReport(
            timeBasis = "accounting_date",
            currencyTotals = listOf(LedgerReportCurrencyTotal("JPY", 100, 0, 1, 0)),
            dailyTotals = emptyList(),
            reviewCount = 0,
            excludedCount = 0,
            reportingCurrency = "CAD",
            fx = LedgerReportFx(
                provider = "frankfurter",
                complete = false,
                unavailableSourceCurrencies = listOf("JPY"),
                lockedDateCount = 0,
                observedDateRange = LedgerFxDateRange(null, null),
                chineseBankBand = null,
            ),
        )

        assertEquals("CAD", chartTargetUnavailable(report))
        assertEquals(emptyList<String>(), chartCurrencies(report, false))
    }

    @Test
    fun emptyCompleteTargetIsHonestEmptyNotUnavailable() {
        val report = LedgerReport(
            timeBasis = "accounting_date",
            currencyTotals = emptyList(),
            dailyTotals = emptyList(),
            reviewCount = 0,
            excludedCount = 0,
            reportingCurrency = "CAD",
            fx = LedgerReportFx.EMPTY,
        )

        assertNull(chartTargetUnavailable(report))
        assertEquals(emptyList<String>(), chartCurrencies(report, false))
    }
}
