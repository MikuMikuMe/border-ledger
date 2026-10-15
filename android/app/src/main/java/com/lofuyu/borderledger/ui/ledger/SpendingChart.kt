package com.lofuyu.borderledger.ui.ledger

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.LocalDate

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
    if (report.reportingCurrency != null) {
        return if (chartTargetUnavailable(report) != null || report.convertedDailyTotals.isEmpty()) {
            emptyList()
        } else {
            listOf(report.reportingCurrency)
        }
    }
    val currencies = (report.currencyTotals.map { it.currency } + report.dailyTotals.map { it.currency })
        .distinct()
    return currencies.sortedWith(compareBy<String>({ when (it) { "CAD" -> 0; "CNY" -> 1; else -> 2 } }, { it }))
}

fun chartLanes(report: LedgerReport, includeProvisional: Boolean): List<SpendingChartLane> {
    if (report.reportingCurrency != null) {
        if (chartTargetUnavailable(report) != null) return emptyList()
        val points = report.convertedDailyTotals
            .sortedBy { it.date }
            .map { daily -> SpendingChartPoint(daily.date, if (includeProvisional) daily.confirmedMinorUnits + daily.provisionalMinorUnits else daily.confirmedMinorUnits) }
        return if (points.isEmpty()) emptyList() else listOf(SpendingChartLane(report.reportingCurrency, points, points.maxAbs()))
    }
    val byCurrency = report.dailyTotals.groupBy { it.currency }
    return chartCurrencies(report, includeProvisional).mapNotNull { currency ->
        val points = byCurrency[currency].orEmpty()
            .sortedBy { it.date }
            .map { daily -> SpendingChartPoint(daily.date, if (includeProvisional) daily.confirmedMinorUnits + daily.provisionalMinorUnits else daily.confirmedMinorUnits) }
        if (points.isEmpty()) null else SpendingChartLane(currency, points, points.maxAbs())
    }
}

@Composable
fun SpendingChart(report: LedgerReport, includeProvisional: Boolean, modifier: Modifier = Modifier) {
    val unavailable = chartTargetUnavailable(report)
    val lanes = chartLanes(report, includeProvisional)
    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Spending over time", style = MaterialTheme.typography.titleMedium)
            when {
                unavailable != null -> Text(
                    "Chart unavailable: ${unavailable} conversion rates are not available for the locked purchase dates.",
                    color = MaterialTheme.colorScheme.error,
                )
                lanes.isEmpty() -> Text(
                    "No daily totals are available for this reporting lens.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                else -> lanes.forEach { lane ->
                    ChartLane(lane, report.reportingCurrency != null)
                }
            }
        }
    }
}

@Composable
private fun ChartLane(lane: SpendingChartLane, target: Boolean) {
    val maxAbs = lane.maxAbsMinorUnits.coerceAtLeast(1L).toFloat()
    val outline = MaterialTheme.colorScheme.outline
    val positive = MaterialTheme.colorScheme.primary
    val negative = MaterialTheme.colorScheme.secondary
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(lane.currency, style = MaterialTheme.typography.labelLarge)
            Text(if (target) "Locked target" else "Source currency", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(112.dp)
                .semantics { contentDescription = "${lane.currency} spending chart" },
        ) {
            val zeroY = size.height / 2f
            val step = size.width / lane.points.size.coerceAtLeast(1)
            drawLine(outline, Offset(0f, zeroY), Offset(size.width, zeroY), 1f)
            lane.points.forEachIndexed { index, point ->
                val x = step * index + step / 2f
                val barHeight = (kotlin.math.abs(point.amountMinorUnits).toFloat() / maxAbs) * (size.height / 2f - 8f)
                val color = if (point.amountMinorUnits < 0) negative else positive
                val top = if (point.amountMinorUnits >= 0) zeroY - barHeight else zeroY
                drawRect(color, Offset(x - (step * .28f).coerceAtLeast(4f), top), androidx.compose.ui.geometry.Size((step * .56f).coerceAtLeast(8f), barHeight.coerceAtLeast(2f)))
            }
        }
        lane.points.forEach { point ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(point.date, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                Text(formatMinorUnits(point.amountMinorUnits, lane.currency), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun List<SpendingChartPoint>.maxAbs(): Long = maxOf(0L, maxOfOrNull { kotlin.math.abs(it.amountMinorUnits) } ?: 0L)

