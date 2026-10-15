package com.lofuyu.borderledger.ui.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerDestinationTask12Test {
    @Test
    fun importAndExportAreSignedInShellDestinations() {
        assertEquals("Import", LedgerDestination.Import.label)
        assertEquals("Export", LedgerDestination.Export.label)
        assertTrue(primaryLedgerDestinations.none { it == LedgerDestination.Import || it == LedgerDestination.Export })
        assertTrue(LedgerDestination.entries.any { it == LedgerDestination.RecurringDetail })
        assertTrue(LedgerDestination.entries.any { it == LedgerDestination.BankConnections })
        assertTrue(LedgerDestination.entries.any { it == LedgerDestination.Devices })
        assertTrue(LedgerDestination.entries.any { it == LedgerDestination.Settings })
        assertTrue(LedgerDestination.entries.any { it == LedgerDestination.About })
    }
}
