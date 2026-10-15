package com.lofuyu.borderledger.debug

import com.lofuyu.borderledger.ui.ledger.LedgerReport
import com.lofuyu.borderledger.ui.ledger.fxPreviewReport

/** Debug-only scenario names shared by adb intent launch and unit coverage. */
enum class FxReportPreviewCase(val intentValue: String) {
    AVAILABLE("available"),
    PARTIAL("partial"),
    UNAVAILABLE("unavailable"),
    PROVISIONAL("provisional"),
    REFUND("refund"),
    BOC_CNY("boc+cny");

    companion object {
        fun fromIntentValue(value: String?): FxReportPreviewCase = entries.firstOrNull { it.intentValue == value?.trim()?.lowercase() } ?: AVAILABLE
    }
}

object FxReportPreviewFixture {
    fun report(case: FxReportPreviewCase): LedgerReport = fxPreviewReport(case.intentValue)
}
