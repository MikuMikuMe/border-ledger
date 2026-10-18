package com.lofuyu.borderledger.ui.ledger

import java.text.NumberFormat
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.util.Currency
import java.util.Locale

enum class LedgerDestination(val label: String, val shortLabel: String, val showInPrimaryNavigation: Boolean = true) {
    Overview("Overview", "Overview"),
    Recurring("Recurring", "Recurring"),
    Activity("Activity", "Activity"),
    Review("Review", "Review"),
    Accounts("Accounts", "Accounts"),
    Import("Import", "Import", false),
    Export("Export", "Export", false),
    RecurringDetail("Recurring detail", "Recurring", false),
    BankConnections("Bank connections", "Bank", false),
    Devices("Devices", "Devices", false),
    Settings("Settings", "Settings", false),
    About("About", "About", false),
}


enum class ReportWindow(val label: String) {
    Today("Today"),
    Week("Week"),
    Month("Month"),
}

data class ReportDateWindow(val startDate: LocalDate, val endDate: LocalDate)

fun reportDateWindow(window: ReportWindow, today: LocalDate, weekStart: DayOfWeek = DayOfWeek.MONDAY): ReportDateWindow = when (window) {
    ReportWindow.Today -> ReportDateWindow(today, today)
    ReportWindow.Week -> ReportDateWindow(today.with(TemporalAdjusters.previousOrSame(weekStart)), today)
    ReportWindow.Month -> ReportDateWindow(today.withDayOfMonth(1), today)
}

val primaryLedgerDestinations: List<LedgerDestination> = LedgerDestination.entries.filter { it.showInPrimaryNavigation }


fun formatMinorUnits(minorUnits: Long, currencyCode: String): String {
    val currency = runCatching { Currency.getInstance(currencyCode) }.getOrNull()
    if (currency == null) return "$currencyCode $minorUnits"
    val digits = currency.defaultFractionDigits.coerceIn(0, 3)
    val scale = 10.0.powInt(digits)
    val formatterLocale = if (currencyCode.uppercase(Locale.ROOT) == "CAD" || currencyCode.uppercase(Locale.ROOT) == "CNY") Locale.getDefault() else Locale.SIMPLIFIED_CHINESE
    val formatter = NumberFormat.getCurrencyInstance(formatterLocale).apply {
        this.currency = currency
        minimumFractionDigits = digits
        maximumFractionDigits = digits
    }
    return formatter.format(minorUnits.toDouble() / scale)
}

private fun Double.powInt(exponent: Int): Double {
    var value = 1.0
    repeat(exponent) { value *= 10.0 }
    return value
}

