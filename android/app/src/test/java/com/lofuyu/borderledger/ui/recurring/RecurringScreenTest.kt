package com.lofuyu.borderledger.ui.recurring

import com.lofuyu.borderledger.parser.CurrencyRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecurringScreenTest {
    @Test
    fun currencyFilterOptionsIncludeAllRegisteredCurrencies() {
        val options = recurringCurrencyFilterOptions()

        assertEquals(null, options.first())
        assertEquals(CurrencyRegistry.DEFAULT_ENTRIES.keys, options.drop(1).toSet())
        assertTrue(options.contains("JPY"))
        assertFalse(options.contains("ZZZ"))
    }
}
