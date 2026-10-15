package com.lofuyu.borderledger.debug

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FxReportPreviewTest {
    @Test
    fun previewFixtureProvidesEveryDeterministicReportCaseWithoutNetworkInputs() {
        FxReportPreviewCase.entries.forEach { previewCase ->
            val report = FxReportPreviewFixture.report(previewCase)
            assertEquals("CAD", report.reportingCurrency)
            if (previewCase == FxReportPreviewCase.UNAVAILABLE) assertNull(report.convertedTotals) else assertNotNull(report.convertedTotals)
        }

        assertTrue(FxReportPreviewFixture.report(FxReportPreviewCase.PARTIAL).fx.unavailableSourceCurrencies.contains("EUR"))
        assertFalse(FxReportPreviewFixture.report(FxReportPreviewCase.UNAVAILABLE).fx.complete)
        assertEquals(50L, FxReportPreviewFixture.report(FxReportPreviewCase.PROVISIONAL).convertedTotals?.provisionalMinorUnits)
        assertTrue((FxReportPreviewFixture.report(FxReportPreviewCase.REFUND).convertedTotals?.confirmedMinorUnits ?: 0L) < 0L)
    }

    @Test
    fun bocCnyFixtureUsesServerProvidedBandAndKeepsCnyOutOfItsBase() {
        val report = FxReportPreviewFixture.report(FxReportPreviewCase.BOC_CNY)
        val band = requireNotNull(report.fx.chineseBankBand)

        assertEquals("CAD", band.currency)
        assertEquals(100L, band.baseMinorUnits)
        assertEquals(150, band.percentageBasisPoints)
        assertEquals(200L, report.currencyTotals.first { it.currency == "CNY" }.confirmedMinorUnits)
    }

    @Test
    fun intentCaseParsingDefaultsSafelyAndAcceptsAllSupportedValues() {
        assertEquals(FxReportPreviewCase.AVAILABLE, FxReportPreviewCase.fromIntentValue(null))
        assertEquals(FxReportPreviewCase.BOC_CNY, FxReportPreviewCase.fromIntentValue("boc+cny"))
        assertEquals(FxReportPreviewCase.REFUND, FxReportPreviewCase.fromIntentValue("refund"))
        assertEquals(FxReportPreviewCase.AVAILABLE, FxReportPreviewCase.fromIntentValue("not-a-case"))
    }
}
