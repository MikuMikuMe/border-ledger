package com.lofuyu.borderledger.debug

import com.lofuyu.borderledger.ui.ledger.LedgerReport
import com.lofuyu.borderledger.ui.ledger.ChineseBankBand
import com.lofuyu.borderledger.ui.ledger.LedgerFxDateRange
import com.lofuyu.borderledger.ui.ledger.LedgerReportConvertedDailyTotal
import com.lofuyu.borderledger.ui.ledger.LedgerReportConvertedTotals
import com.lofuyu.borderledger.ui.ledger.LedgerReportCurrencyTotal
import com.lofuyu.borderledger.ui.ledger.LedgerReportFx

/** Debug-only scenario names shared by adb intent launch and unit coverage. */
enum class FxReportPreviewCase(val intentValue: String) {
    AVAILABLE("available"),
    PARTIAL("partial"),
    UNAVAILABLE("unavailable"),
    PROVISIONAL("provisional"),
    REFUND("refund"),
    BOC_CNY("boc+cny");

    companion object {
        fun fromIntentValue(value: String?): FxReportPreviewCase = entries.firstOrNull { it.intentValue == value?.trim()?.lowercase() } ?: AVAILABLE
    }
}

object FxReportPreviewFixture {
    fun report(case: FxReportPreviewCase): LedgerReport {
        val scenario = scenarioFor(case)
        return LedgerReport(
            timeBasis = "accounting_date",
            currencyTotals = scenario.currencyTotals,
            dailyTotals = emptyList(),
            reviewCount = scenario.reviewCount,
            excludedCount = 0,
            from = "2026-10-01",
            to = "2026-10-14",
            includeProvisional = scenario.includeProvisional,
            timeZone = "America/Toronto",
            asOf = "2026-10-14T12:00:00Z",
            sourceCoverage = mapOf("statement" to scenario.currencyTotals.size),
            reportingCurrency = REPORTING_CURRENCY,
            convertedTotals = convertedTotals(scenario),
            convertedDailyTotals = convertedDailyTotals(scenario),
            fx = fxDetails(scenario),
        )
    }

    private fun scenarioFor(case: FxReportPreviewCase): ReportScenario = when (case) {
        FxReportPreviewCase.AVAILABLE -> availableScenario()
        FxReportPreviewCase.PARTIAL -> availableScenario().copy(
            reviewCount = 1,
            conversionComplete = false,
            unavailableCurrencies = listOf("EUR"),
        )
        FxReportPreviewCase.UNAVAILABLE -> availableScenario().copy(
            reviewCount = 1,
            convertedTotalAvailable = false,
            conversionComplete = false,
            unavailableCurrencies = listOf("EUR"),
        )
        FxReportPreviewCase.PROVISIONAL -> ReportScenario(
            currencyTotals = standardCurrencyTotals(includeProvisional = true),
            confirmedMinorUnits = 34800L,
            provisionalMinorUnits = 50L,
            includeProvisional = true,
        )
        FxReportPreviewCase.REFUND -> availableScenario().copy(
            confirmedMinorUnits = -200L,
            secondDailyConfirmedMinorUnits = -120L,
        )
        FxReportPreviewCase.BOC_CNY -> ReportScenario(
            currencyTotals = chineseBankCurrencyTotals(),
            confirmedMinorUnits = 900L,
            chineseBankBand = ChineseBankBand(true, REPORTING_CURRENCY, 100, 99, 101, 150),
        )
    }

    private fun availableScenario() = ReportScenario(
        currencyTotals = standardCurrencyTotals(),
        confirmedMinorUnits = 34800L,
    )

    private fun standardCurrencyTotals(includeProvisional: Boolean = false) = listOf(
        LedgerReportCurrencyTotal(
            "USD",
            15000,
            if (includeProvisional) 2500 else 0,
            2,
            if (includeProvisional) 1 else 0,
        ),
        LedgerReportCurrencyTotal("CAD", 7200, 0, 1, 0),
    )

    private fun chineseBankCurrencyTotals() = listOf(
        LedgerReportCurrencyTotal("CNY", 200, 0, 1, 0),
        LedgerReportCurrencyTotal("JPY", 2100, 0, 1, 0),
    )

    private fun convertedTotals(scenario: ReportScenario): LedgerReportConvertedTotals? {
        if (!scenario.convertedTotalAvailable) return null
        return LedgerReportConvertedTotals(
            scenario.confirmedMinorUnits,
            scenario.provisionalMinorUnits,
            scenario.currencyTotals.size,
            if (scenario.provisionalMinorUnits == 0L) 0 else 1,
        )
    }

    private fun convertedDailyTotals(scenario: ReportScenario) = listOf(
        LedgerReportConvertedDailyTotal(
            "2026-10-13",
            scenario.confirmedMinorUnits,
            scenario.provisionalMinorUnits,
        ),
        LedgerReportConvertedDailyTotal("2026-10-14", scenario.secondDailyConfirmedMinorUnits, 0),
    )

    private fun fxDetails(scenario: ReportScenario) = LedgerReportFx(
        provider = "frankfurter",
        complete = scenario.conversionComplete,
        unavailableSourceCurrencies = scenario.unavailableCurrencies,
        lockedDateCount = 2,
        observedDateRange = LedgerFxDateRange("2026-10-01", "2026-10-14"),
        chineseBankBand = scenario.chineseBankBand,
    )

    private data class ReportScenario(
        val currencyTotals: List<LedgerReportCurrencyTotal>,
        val confirmedMinorUnits: Long,
        val provisionalMinorUnits: Long = 0L,
        val includeProvisional: Boolean = false,
        val reviewCount: Int = 0,
        val convertedTotalAvailable: Boolean = true,
        val conversionComplete: Boolean = true,
        val unavailableCurrencies: List<String> = emptyList(),
        val chineseBankBand: ChineseBankBand? = null,
        val secondDailyConfirmedMinorUnits: Long = 9800L,
    )

    private const val REPORTING_CURRENCY = "CAD"
}
