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
    searchTransactions(filters.query).filter { transaction ->
        (filters.currency == null || transaction.currency == filters.currency) &&
            (filters.category == null || transaction.category == filters.category) &&
            (filters.status == null || transaction.status == filters.status) &&
            (filters.source == null || transaction.sourceLabel == filters.source)
    }

fun List<LedgerTransaction>.filterTransactions(filters: ActivityFilters): List<LedgerTransaction> {
    val needle = filters.query.trim().lowercase()
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
        ).any { it.lowercase().contains(needle) }
        matchesQuery &&
            (filters.currency == null || transaction.currency == filters.currency) &&
            (filters.category == null || transaction.category == filters.category) &&
            (filters.status == null || transaction.status == filters.status) &&
            (filters.source == null || transaction.sourceLabel == filters.source)
    }
}
