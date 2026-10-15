package com.lofuyu.borderledger

import com.lofuyu.borderledger.exports.WorkerExportReceipt
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class Task12NativeGatewayTest {
    @Test
    fun importPreviewParserPreservesWorkerStateAndErrors() {
        val preview = Task12GatewayJson.parseImportPreview(
            JSONObject(
                """
                {
                  "id":"preview-1",
                  "revision":3,
                  "expiresAt":"2026-10-15T12:00:00Z",
                  "state":"ready",
                  "accountId":"account-1",
                  "fileSha256":"${"a".repeat(64)}",
                  "fileSizeBytes":128,
                  "rowCount":2,
                  "receivedRowCount":2,
                  "validRowCount":1,
                  "errors":[{"code":"invalid_row","message":"Row 2 is invalid.","rowId":"row-2"}],
                  "duplicateCandidates":[{
                    "id":"candidate-1",
                    "statementTransactionId":"statement-1",
                    "candidateTransactionId":"alert-1",
                    "score":100,
                    "reasonCodes":["same_account","same_currency","same_amount"],
                    "status":"open"
                  }]
                }
                """.trimIndent(),
            ),
        )

        assertEquals("preview-1", preview.id)
        assertEquals("ready", preview.status)
        assertEquals(1, preview.validRowCount)
        assertEquals("invalid_row", preview.errors.single().code)
        assertEquals("row-2", preview.errors.single().rowId)
        assertEquals("alert-1", preview.duplicateCandidates.single().candidateTransactionId)
        assertEquals(listOf("same_account", "same_currency", "same_amount"), preview.duplicateCandidates.single().reasonCodes)
    }

    @Test
    fun cancelBodyCarriesExpectedRevision() {
        assertEquals(
            7,
            Task12GatewayJson.cancelBody(com.lofuyu.borderledger.imports.CancelImportRequest("preview-1", 7))
                .getInt("expectedRevision"),
        )
    }

    @Test
    fun duplicateDecisionBodyCarriesRevisionAndExplicitDecision() {
        val body = Task12GatewayJson.duplicateDecisionBody(
            com.lofuyu.borderledger.imports.DecideImportDuplicateRequest("preview-1", "candidate-1", 7, "keep_separate", "decision-1"),
        )
        assertEquals(7, body.getInt("expectedRevision"))
        assertEquals("keep_separate", body.getString("decision"))
    }

    @Test
    fun exportReceiptParserDoesNotInventReceiptWhenWorkerHeaderIsAbsent() = runTest {
        assertNull(Task12GatewayJson.parseExportReceipt(null))
        assertNull(Task12GatewayJson.parseExportReceipt(""))
        assertNull(Task12GatewayJson.parseExportReceipt("receipt-1"))
        assertNull(Task12GatewayJson.parseExportReceipt("receipt-1", exportedRowsHeader = "-1"))
        assertNull(Task12GatewayJson.parseExportReceipt("receipt-1", exportedRowsHeader = "not-a-count"))
        assertEquals(
            WorkerExportReceipt("receipt-1", exportedRows = 2),
            Task12GatewayJson.parseExportReceipt("receipt-1", exportedRowsHeader = "2"),
        )
    }
}
