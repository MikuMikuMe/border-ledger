package com.lofuyu.borderledger.ui.ledger

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerRemoteDecoderTest {
    @Test
    fun decodesReportSummaryWithoutCollapsingCurrencies() {
        val payload = """
            {
              "startDate":"2026-10-01",
              "endDate":"2026-10-14",
              "confirmedByCurrency":{"CAD":1234,"JPY":500},
              "provisionalByCurrency":{"CAD":200},
              "checkedAt":"2026-10-14T12:00:00Z",
              "timeBasis":"accounting_date",
              "timeZone":"America/Toronto",
              "dailyTotals":[{"date":"2026-10-14","currency":"JPY","confirmedMinorUnits":500,"provisionalMinorUnits":0}],
              "reviewCount":1,
              "excludedCount":2,
              "sourceCoverage":{"statement":3,"alert":1}
            }
        """.trimIndent().toByteArray()

        val result = LedgerSnapshotDecoder.decodeReportSummary(payload, includeProvisional = false)
        assertTrue(result.toString(), result is LedgerReportDecodeResult.Ready)
        val report = (result as LedgerReportDecodeResult.Ready).report
        assertEquals("2026-10-01", report.from)
        assertEquals(listOf("CAD", "JPY"), report.currencyTotals.map { it.currency })
        assertEquals(1, report.reviewCount)
        assertEquals(3, report.sourceCoverage["statement"])
    }

    @Test
    fun decodesConvertedReportAndChineseBankBandFromTheMobileContract() {
        val payload = """
            {
              "startDate":"2026-10-01",
              "endDate":"2026-10-14",
              "confirmedByCurrency":{"CAD":1234,"USD":500},
              "provisionalByCurrency":{"CAD":200},
              "checkedAt":"2026-10-14T12:00:00Z",
              "timeBasis":"accounting_date",
              "timeZone":"America/Toronto",
              "dailyTotals":[{"date":"2026-10-14","currency":"USD","confirmedMinorUnits":500,"provisionalMinorUnits":0}],
              "reviewCount":1,
              "excludedCount":2,
              "sourceCoverage":{"statement":3,"alert":1},
              "reportingCurrency":"CAD",
              "convertedTotals":{"confirmedMinorUnits":1600,"provisionalMinorUnits":200,"confirmedCount":4,"provisionalCount":1},
              "convertedDailyTotals":[{"date":"2026-10-14","confirmedMinorUnits":1600,"provisionalMinorUnits":200}],
              "fx":{"provider":"frankfurter","complete":true,"unavailableSourceCurrencies":[],"lockedDateCount":2,"observedDateRange":{"earliest":"2026-10-01","latest":"2026-10-14"},"chineseBankBand":{"eligible":true,"currency":"CAD","baseMinorUnits":1000,"lowerMinorUnits":985,"upperMinorUnits":1015,"percentageBasisPoints":150}},
              "futureWrapperField":{"ignored":true},
              "report":{
                "ledgerId":"personal",
                "asOf":"2026-10-14T12:00:00Z",
                "timeBasis":"accounting_date",
                "timeZone":"America/Toronto",
                "from":"2026-10-01",
                "to":"2026-10-14",
                "includeProvisional":true,
                "currencyTotals":[{"currency":"USD","confirmedMinorUnits":500,"provisionalMinorUnits":0,"confirmedCount":1,"provisionalCount":0}],
                "dailyTotals":[{"date":"2026-10-14","currency":"USD","confirmedMinorUnits":500,"provisionalMinorUnits":0}],
                "reportingCurrency":"CAD",
                "convertedTotals":{"confirmedMinorUnits":500,"provisionalMinorUnits":0,"confirmedCount":1,"provisionalCount":0},
                "convertedDailyTotals":[{"date":"2026-10-14","confirmedMinorUnits":500,"provisionalMinorUnits":0}],
                "fx":{"provider":"frankfurter","complete":true,"unavailableSourceCurrencies":[],"lockedDateCount":1,"observedDateRange":{"earliest":"2026-10-14","latest":"2026-10-14"},"chineseBankBand":{"eligible":true,"currency":"CAD","baseMinorUnits":500,"lowerMinorUnits":493,"upperMinorUnits":508,"percentageBasisPoints":150}},
                "reviewCount":0,
                "excludedCount":0,
                "sourceCoverage":{"statement":1},
                "futureNestedField":[1,2,3]
              }
            }
        """.trimIndent().toByteArray()

        val result = LedgerSnapshotDecoder.decodeReportSummary(payload, includeProvisional = false)
        assertTrue(result.toString(), result is LedgerReportDecodeResult.Ready)
        val report = (result as LedgerReportDecodeResult.Ready).report
        assertEquals("CAD", report.reportingCurrency)
        assertEquals(500L, report.convertedTotals?.confirmedMinorUnits)
        assertEquals(1, report.fx.lockedDateCount)
        assertEquals("2026-10-14", report.fx.observedDateRange.latest)
        assertEquals(150, report.fx.chineseBankBand?.percentageBasisPoints)
        assertEquals(493L, report.fx.chineseBankBand?.lowerMinorUnits)
        assertEquals(listOf("2026-10-14"), report.convertedDailyTotals.map { it.date })
    }

    @Test
    fun rejectsUnknownCurrenciesUnsafeMoneyAndDecimalPercentageValues() {
        val unknownCurrency = """
            {"timeBasis":"accounting_date","currencyTotals":[{"currency":"XYZ","confirmedMinorUnits":1,"provisionalMinorUnits":0,"confirmedCount":1,"provisionalCount":0}]}
        """.trimIndent().toByteArray()
        val unsafeMoney = """
            {"timeBasis":"accounting_date","reportingCurrency":"CAD","convertedTotals":{"confirmedMinorUnits":9007199254740992,"provisionalMinorUnits":0,"confirmedCount":1,"provisionalCount":0},"fx":{"provider":"frankfurter","complete":true,"unavailableSourceCurrencies":[],"lockedDateCount":0,"observedDateRange":{"earliest":null,"latest":null},"chineseBankBand":null}}
        """.trimIndent().toByteArray()
        val decimalPercentage = """
            {"timeBasis":"accounting_date","reportingCurrency":"CAD","convertedTotals":{"confirmedMinorUnits":1,"provisionalMinorUnits":0,"confirmedCount":1,"provisionalCount":0},"fx":{"provider":"frankfurter","complete":true,"unavailableSourceCurrencies":[],"lockedDateCount":0,"observedDateRange":{"earliest":null,"latest":null},"chineseBankBand":{"eligible":true,"currency":"CAD","baseMinorUnits":1,"lowerMinorUnits":1,"upperMinorUnits":1,"percentageBasisPoints":150.0}}}
        """.trimIndent().toByteArray()

        assertTrue(LedgerSnapshotDecoder.decodeReportSummary(unknownCurrency, false) is LedgerReportDecodeResult.Unsupported)
        assertTrue(LedgerSnapshotDecoder.decodeReportSummary(unsafeMoney, false) is LedgerReportDecodeResult.Unsupported)
        assertTrue(LedgerSnapshotDecoder.decodeReportSummary(decimalPercentage, false) is LedgerReportDecodeResult.Unsupported)
    }

    @Test
    fun sourceOnlyReportKeepsNullableReportingTarget() {
        val payload = """
            {"startDate":"2026-10-01","endDate":"2026-10-14","timeBasis":"accounting_date","reportingCurrency":null,"convertedTotals":null,"convertedDailyTotals":[],"fx":{"provider":"frankfurter","complete":true,"unavailableSourceCurrencies":[],"lockedDateCount":0,"observedDateRange":{"earliest":null,"latest":null},"chineseBankBand":null}}
        """.trimIndent().toByteArray()

        val result = LedgerSnapshotDecoder.decodeReportSummary(payload, includeProvisional = false)
        assertTrue(result is LedgerReportDecodeResult.Ready)
        assertNull((result as LedgerReportDecodeResult.Ready).report.reportingCurrency)
        assertNull(result.report.convertedTotals)
    }

    @Test
    fun decodesActivityPageWithRevisionAndDisplaySign() {
        val payload = """
            {
              "items":[{
                "id":"tx-1","accountId":"account-1","date":"2026-10-14","merchant":"Refund shop",
                "amountMinor":2500,"currency":"CAD","category":"Refunds","kind":"refund",
                "status":"confirmed","source":"statement","note":"Returned","revision":2
              }],
              "page":{"nextCursor":"opaque","limit":1}
            }
        """.trimIndent().toByteArray()

        val result = LedgerSnapshotDecoder.decodeTransactions(payload)
        assertTrue(result.toString(), result is LedgerTransactionPageDecodeResult.Ready)
        val transaction = (result as LedgerTransactionPageDecodeResult.Ready).page.items.single()
        assertEquals(-2500L, transaction.signedMinorUnits)
        assertEquals(2, transaction.revision)
        assertEquals("opaque", result.page.nextCursor)
    }
}
