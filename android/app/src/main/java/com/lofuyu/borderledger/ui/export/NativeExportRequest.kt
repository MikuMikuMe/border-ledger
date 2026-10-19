package com.lofuyu.borderledger.ui.export

import com.lofuyu.borderledger.exports.ExportSelection
import com.lofuyu.borderledger.exports.LedgerExportFilters
import com.lofuyu.borderledger.exports.LedgerExportRequest

/** Activity filters are not part of the export contract; exports always cover all records. */
@Suppress("UNUSED_PARAMETER")
internal fun nativeLedgerExportRequest(currentFilters: LedgerExportFilters): LedgerExportRequest = LedgerExportRequest(
    selection = ExportSelection.All,
    filters = LedgerExportFilters(),
)
