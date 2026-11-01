package com.lofuyu.borderledger.budget

private val MONTH_PATTERN = Regex("[0-9]{4}-(0[1-9]|1[0-2])")

/** Validated routing inputs; none can introduce a path or query fragment. */
data class BudgetMonth(val value: String) {
    init { require(value.matches(MONTH_PATTERN)) }
}

data class BudgetModeViewRequest(val month: BudgetMonth, val mode: String) {
    init { require(mode in setOf("envelope", "tracking")) }
}

data class BudgetRolloverRequest(val category: String, val effectiveMonth: BudgetMonth, val policy: String) {
    init {
        require(category.isNotBlank() && category.length <= 120)
        require(policy in setOf("carry_all", "carry_positive", "reset"))
    }
}

data class BudgetWriteCommand(val action: String, val body: String)
