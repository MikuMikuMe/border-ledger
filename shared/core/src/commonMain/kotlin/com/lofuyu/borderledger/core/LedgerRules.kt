package com.lofuyu.borderledger.ui.ledger

private val confirmedStatuses = setOf("confirmed", "posted", "reconciled")
private val excludedStatuses = setOf("failed", "void", "declined", "rejected")

fun LedgerTransaction.isIncludedInConfirmedTotals(): Boolean {
    val normalized = status.trim().lowercase()
    return normalized in confirmedStatuses && normalized !in excludedStatuses
}

fun LedgerSnapshot.confirmedTotals(): Map<String, Long> = transactions
    .asSequence()
    .filter(LedgerTransaction::isIncludedInConfirmedTotals)
    .groupingBy { it.currency }
    .fold(0L) { total, transaction -> total + transaction.signedMinorUnits }

fun LedgerSnapshot.reviewTransactions(): List<LedgerTransaction> = transactions.filter {
    it.status.trim().lowercase() in setOf("needs_review", "review", "possible_duplicate")
}

fun LedgerSnapshot.searchTransactions(query: String): List<LedgerTransaction> {
    val needle = query.trim().lowercase()
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
        ).any { it.lowercase().contains(needle) }
    }
}

fun LedgerSnapshot.filterTransactions(filters: ActivityFilters): List<LedgerTransaction> =
    searchTransactions(filters.query).filter { it.matchesFacets(filters) }

fun List<LedgerTransaction>.filterTransactions(filters: ActivityFilters): List<LedgerTransaction> {
    val needle = filters.query.trim().lowercase()
    return filter { transaction ->
        transaction.matchesQuery(needle, includeId = true) && transaction.matchesFacets(filters)
    }
}

private fun LedgerTransaction.matchesQuery(needle: String, includeId: Boolean): Boolean {
    if (needle.isEmpty()) return true
    val searchableFields = listOfNotNull(
        id.takeIf { includeId },
        merchant,
        accountLabel,
        currency,
        status,
        sourceLabel,
        category,
        note,
    )
    return searchableFields.any { it.lowercase().contains(needle) }
}

private fun LedgerTransaction.matchesFacets(filters: ActivityFilters): Boolean =
    filters.currency.matchesValue(currency) &&
        filters.category.matchesValue(category) &&
        filters.status.matchesValue(status) &&
        filters.source.matchesValue(sourceLabel)

private fun String?.matchesValue(actual: String?): Boolean = this == null || this == actual
