package com.lofuyu.borderledger.ui.export

import com.lofuyu.borderledger.exports.ExportSelection
import com.lofuyu.borderledger.exports.LedgerExportFilters
import org.junit.Assert.assertEquals
import org.junit.Test

class ExportScreenTest {
    @Test
    fun nativeExportRequestIsExplicitlyAllRecordsWithNoActivityFilters() {
        val request = nativeLedgerExportRequest(
            currentFilters = LedgerExportFilters(
                currency = "CAD",
                startDate = "2026-10-01",
                endDate = "2026-10-14",
            ),
        )

        assertEquals(ExportSelection.All, request.selection)
        assertEquals(LedgerExportFilters(), request.filters)
    }
}
