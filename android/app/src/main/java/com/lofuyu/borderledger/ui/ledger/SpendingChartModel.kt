package com.lofuyu.borderledger.ui.ledger

data class SpendingChartPoint(
    val date: String,
    val amountMinorUnits: Long,
)

data class SpendingChartLane(
    val currency: String,
    val points: List<SpendingChartPoint>,
    val maxAbsMinorUnits: Long,
)

/** Returns the target only when an incomplete conversion has no drawable data. */
fun chartTargetUnavailable(report: LedgerReport): String? = report.reportingCurrency
    ?.takeIf { !report.fx.complete && report.convertedDailyTotals.isEmpty() }

/**
 * The currency list is a legend/data-table contract, not a promise that every
 * currency has a zero-valued bar. CAD and CNY are kept first for the common
 * China-account audit flow, then the remaining registered currencies sort
 * deterministically.
 */
fun chartCurrencies(report: LedgerReport, includeProvisional: Boolean): List<String> {
    val reportingCurrency = report.reportingCurrency
    if (reportingCurrency != null) {
        return if (chartTargetUnavailable(report) != null || report.convertedDailyTotals.isEmpty()) {
            emptyList()
        } else {
            listOf(reportingCurrency)
        }
    }
    val currencies = (report.currencyTotals.map { it.currency } + report.dailyTotals.map { it.currency })
        .distinct()
    return currencies.sortedWith(compareBy<String>({ when (it) { "CAD" -> 0; "CNY" -> 1; else -> 2 } }, { it }))
}

fun chartLanes(report: LedgerReport, includeProvisional: Boolean): List<SpendingChartLane> {
    val reportingCurrency = report.reportingCurrency
    if (reportingCurrency != null) {
        if (chartTargetUnavailable(report) != null) return emptyList()
        val points = report.convertedDailyTotals
            .sortedBy { it.date }
            .map { daily -> SpendingChartPoint(daily.date, if (includeProvisional) daily.confirmedMinorUnits + daily.provisionalMinorUnits else daily.confirmedMinorUnits) }
        return if (points.isEmpty()) emptyList() else listOf(SpendingChartLane(reportingCurrency, points, points.maxAbs()))
    }
    val byCurrency = report.dailyTotals.groupBy { it.currency }
    return chartCurrencies(report, includeProvisional).mapNotNull { currency ->
        val points = byCurrency[currency].orEmpty()
            .sortedBy { it.date }
            .map { daily -> SpendingChartPoint(daily.date, if (includeProvisional) daily.confirmedMinorUnits + daily.provisionalMinorUnits else daily.confirmedMinorUnits) }
        if (points.isEmpty()) null else SpendingChartLane(currency, points, points.maxAbs())
    }
}

private fun List<SpendingChartPoint>.maxAbs(): Long = maxOf(0L, maxOfOrNull { kotlin.math.abs(it.amountMinorUnits) } ?: 0L)
