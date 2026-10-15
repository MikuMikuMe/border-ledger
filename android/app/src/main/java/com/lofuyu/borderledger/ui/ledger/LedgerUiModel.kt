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

data class ActivityFilters(
    val query: String = "",
    val currency: String? = null,
    val category: String? = null,
    val status: String? = null,
    val source: String? = null,
)

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

private val confirmedStatuses = setOf("confirmed", "posted", "reconciled")
private val excludedStatuses = setOf("failed", "void", "declined", "rejected")

fun LedgerTransaction.isIncludedInConfirmedTotals(): Boolean {
    val normalized = status.trim().lowercase(Locale.ROOT)
    return normalized in confirmedStatuses && normalized !in excludedStatuses
}

fun LedgerSnapshot.confirmedTotals(): Map<String, Long> = transactions
    .asSequence()
    .filter(LedgerTransaction::isIncludedInConfirmedTotals)
    .groupingBy { it.currency }
    .fold(0L) { total, transaction -> total + transaction.signedMinorUnits }

fun LedgerSnapshot.reviewTransactions(): List<LedgerTransaction> = transactions.filter {
    it.status.trim().lowercase(Locale.ROOT) in setOf("needs_review", "review", "possible_duplicate")
}

fun LedgerSnapshot.searchTransactions(query: String): List<LedgerTransaction> {
    val needle = query.trim().lowercase(Locale.ROOT)
    if (needle.isEmpty()) return transactions
    return transactions.filter { transaction ->
        listOfNotNull(
            transaction.merchant,
            transaction.accountLabel,
            transaction.currency,
            transaction.status,
            transaction.sourceLabel,
            transaction.category,
            transaction.note,
        ).any { it.lowercase(Locale.ROOT).contains(needle) }
    }
}

fun LedgerSnapshot.filterTransactions(filters: ActivityFilters): List<LedgerTransaction> =
    searchTransactions(filters.query).filter { transaction ->
        (filters.currency == null || transaction.currency == filters.currency) &&
            (filters.category == null || transaction.category == filters.category) &&
            (filters.status == null || transaction.status == filters.status) &&
            (filters.source == null || transaction.sourceLabel == filters.source)
    }

fun List<LedgerTransaction>.filterTransactions(filters: ActivityFilters): List<LedgerTransaction> {
    val needle = filters.query.trim().lowercase(Locale.ROOT)
    return filter { transaction ->
        val matchesQuery = needle.isEmpty() || listOfNotNull(
            transaction.id,
            transaction.merchant,
            transaction.accountLabel,
            transaction.currency,
            transaction.status,
            transaction.sourceLabel,
            transaction.category,
            transaction.note,
        ).any { it.lowercase(Locale.ROOT).contains(needle) }
        matchesQuery &&
            (filters.currency == null || transaction.currency == filters.currency) &&
            (filters.category == null || transaction.category == filters.category) &&
            (filters.status == null || transaction.status == filters.status) &&
            (filters.source == null || transaction.sourceLabel == filters.source)
    }
}

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

