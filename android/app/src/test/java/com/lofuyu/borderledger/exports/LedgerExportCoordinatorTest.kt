package com.lofuyu.borderledger.exports

import android.net.Uri
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LedgerExportCoordinatorTest {
    @Test
    fun canonicalCsvPreservesMinorUnitsAndEscapesFormulaLikeChineseText() {
        assertEquals("\"北京,\'=SUM(A1)\"", canonicalCsvCell("北京,=SUM(A1)"))
        assertEquals("-1234", canonicalCsvCell("-1234", numeric = true))
        assertTrue(CANONICAL_LEDGER_HEADER.contains("AmountMinor"))
    }

    @Test
    fun streamingExportRequiresWorkerReceiptBeforeReportingCompletion() = runTest {
        val destination = RecordingExportDestination()
        val coordinator = LedgerExportCoordinator(
            gateway = RecordingExportGateway(receipt = null),
        )

        coordinator.export(
            request = LedgerExportRequest(ExportSelection.CurrentFilter, LedgerExportFilters(currency = "CAD")),
            destination = destination,
            handoff = ExportHandoff.Save,
        )

        val state = coordinator.state.value as ExportState.AwaitingWorkerReceipt
        assertEquals(ExportSelection.CurrentFilter, state.request.selection)
        assertEquals(destination.bytes.size().toLong(), state.bytesWritten)
        assertTrue(destination.bytes.toString(Charsets.UTF_8).startsWith(CANONICAL_LEDGER_HEADER))
    }

    @Test
    fun streamingExportWithReceiptIsCompletedAndCanProduceShareHandoff() = runTest {
        val coordinator = LedgerExportCoordinator(
            gateway = RecordingExportGateway(receipt = WorkerExportReceipt("export-receipt-1", 1)),
        )
        val destination = RecordingExportDestination()

        coordinator.export(
            request = LedgerExportRequest(ExportSelection.All, LedgerExportFilters()),
            destination = destination,
            handoff = ExportHandoff.Share,
        )

        val state = coordinator.state.value as ExportState.Completed
        assertEquals("export-receipt-1", state.receipt.receiptId)
        assertEquals(ExportHandoff.Share, state.handoff)
        assertTrue(destination.bytes.toString(Charsets.UTF_8).startsWith(CANONICAL_LEDGER_HEADER))
    }

    @Test
    fun canonicalCsvHelperStreamsHeaderAndRowsToTheProvidedOutputStream() {
        val output = ByteArrayOutputStream()
        val row = LedgerExportRow(
            id = "row-1",
            accountId = "account-1",
            date = "2026-10-13",
            merchant = "北京,咖啡",
            category = "Food",
            kind = "expense",
            status = "confirmed",
            source = "statement",
            amountMinor = -1234,
            currency = "CAD",
            note = "=formula",
            fingerprint = "fingerprint-1",
        )

        writeCanonicalLedgerCsv(output, sequenceOf(row))

        assertEquals(
            CANONICAL_LEDGER_HEADER + canonicalLedgerCsvRow(row),
            output.toString(Charsets.UTF_8.name()),
        )
    }

    @Test
    fun allAndCurrentFilterAreDistinctExplicitSelections() {
        assertTrue(isFullLedgerSelection(ExportSelection.All, LedgerExportFilters()))
        assertTrue(!isFullLedgerSelection(ExportSelection.CurrentFilter, LedgerExportFilters()))
        assertTrue(!isFullLedgerSelection(ExportSelection.CurrentFilter, LedgerExportFilters(currency = "CAD")))
    }

    @Test
    fun unknownCurrencyFilterIsRejectedBeforeStreaming() = runTest {
        val coordinator = LedgerExportCoordinator(RecordingExportGateway(receipt = WorkerExportReceipt("receipt", 0)))
        val state = coordinator.export(
            request = LedgerExportRequest(ExportSelection.CurrentFilter, LedgerExportFilters(currency = "XYZ")),
            destination = RecordingExportDestination(),
            handoff = ExportHandoff.Save,
        )

        assertEquals("invalid_currency", (state as ExportState.Error).failure.code)
    }

    private class RecordingExportGateway(
        private val receipt: WorkerExportReceipt?,
    ) : OwnerLedgerExportGateway {
        override suspend fun streamLedgerCsv(
            request: LedgerExportRequest,
            sink: suspend (ByteArray) -> Unit,
        ): WorkerExportReceipt? {
            sink(CANONICAL_LEDGER_HEADER.toByteArray())
            sink("row-1,account-1,2026-10-13,Cafe,Food,expense,confirmed,statement,-100,CAD,,fingerprint,\n".toByteArray())
            return receipt
        }
    }

    private class RecordingExportDestination : ExportDestination {
        override val uri: Uri = Uri.parse("content://test/export.csv")
        val bytes = ByteArrayOutputStream()

        override fun openOutputStream() = bytes
        override fun delete(): Boolean = false
    }
}
