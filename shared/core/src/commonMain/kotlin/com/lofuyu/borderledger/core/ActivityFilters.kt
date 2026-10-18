package com.lofuyu.borderledger.ui.ledger

data class ActivityFilters(
    val query: String = "",
    val currency: String? = null,
    val category: String? = null,
    val status: String? = null,
    val source: String? = null,
)
