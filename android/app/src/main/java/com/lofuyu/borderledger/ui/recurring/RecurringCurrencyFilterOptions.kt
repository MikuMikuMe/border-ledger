package com.lofuyu.borderledger.ui.recurring

import com.lofuyu.borderledger.recurring.RecurringCurrencyPolicy

/** Stable filter choices shared by native tests and the existing recurring API vocabulary. */
internal fun recurringCurrencyFilterOptions(): List<String?> = listOf(null) + RecurringCurrencyPolicy.supportedCodes
