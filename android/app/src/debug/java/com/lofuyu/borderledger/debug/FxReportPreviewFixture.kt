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
        val scenario = case.intentValue
        val hasBand = scenario == "boc-cny" || scenario == "boc+cny"
        val partial = scenario == "partial" || scenario == "unavailable"
        val target = "CAD"
        val sources = if (hasBand) {
            listOf(
                LedgerReportCurrencyTotal("CNY", 200, 0, 1, 0),
                LedgerReportCurrencyTotal("JPY", 2100, 0, 1, 0),
            )
        } else {
            listOf(
                LedgerReportCurrencyTotal("USD", 15000, if (scenario == "provisional") 2500 else 0, 2, if (scenario == "provisional") 1 else 0),
                LedgerReportCurrencyTotal("CAD", 7200, 0, 1, 0),
            )
        }
        val confirmed = if (scenario == "refund") -200L else if (hasBand) 900L else 34800L
        val provisional = if (scenario == "provisional") 50L else 0L
        return LedgerReport(
            timeBasis = "accounting_date",
            currencyTotals = sources,
            dailyTotals = emptyList(),
            reviewCount = if (partial) 1 else 0,
            excludedCount = 0,
            from = "2026-10-01",
            to = "2026-10-14",
            includeProvisional = scenario == "provisional",
            timeZone = "America/Toronto",
            asOf = "2026-10-14T12:00:00Z",
            sourceCoverage = mapOf("statement" to sources.size),
            reportingCurrency = target,
            convertedTotals = if (scenario == "unavailable") null else LedgerReportConvertedTotals(confirmed, provisional, sources.size, if (provisional == 0L) 0 else 1),
            convertedDailyTotals = listOf(
                LedgerReportConvertedDailyTotal("2026-10-13", confirmed, provisional),
                LedgerReportConvertedDailyTotal("2026-10-14", if (scenario == "refund") -120 else 9800, 0),
            ),
            fx = LedgerReportFx(
                provider = "frankfurter",
                complete = !partial,
                unavailableSourceCurrencies = if (partial) listOf("EUR") else emptyList(),
                lockedDateCount = 2,
                observedDateRange = LedgerFxDateRange("2026-10-01", "2026-10-14"),
                chineseBankBand = if (hasBand) ChineseBankBand(true, target, 100, 99, 101, 150) else null,
            ),
        )
    }
}
