package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.auth.*
import com.lofuyu.borderledger.accounts.*
import com.lofuyu.borderledger.bank.*
import com.lofuyu.borderledger.ui.ledger.*
import com.lofuyu.borderledger.ui.settings.*
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import com.lofuyu.borderledger.imports.ImportState
import com.lofuyu.borderledger.exports.ExportState
import com.lofuyu.borderledger.recurring.*
import com.lofuyu.borderledger.review.*
import org.junit.Assert.*
import org.junit.Test

class BridgePayloadsTest {
    @Test fun importPreviewIncludesLocalParserDiagnosticsWithoutFileContents() {
        val preview=com.lofuyu.borderledger.imports.ImportPreview("preview",3,"2026-10-18T00:00:00Z","ready","account","hash",1)
        val draft=com.lofuyu.borderledger.imports.ImportDraft(preview,emptyList(),emptySet(),listOf("Row 3 has an invalid currency."))
        val payload=BridgePayloads.files(ImportState.Ready(draft),ExportState.Idle)
        assertEquals(listOf("Row 3 has an invalid currency."),payload["errors"])
        assertFalse(payload.containsKey("bytes"))
        assertFalse(payload.containsKey("uri"))
        val many=draft.copy(parseErrors=List(150) { "Row ${it+2} has an invalid date." })
        val errors=BridgePayloads.files(ImportState.Ready(many),ExportState.Idle)["errors"] as List<*>
        assertEquals(101,errors.size)
        assertEquals("50 more parser errors. Correct the statement before importing again.",errors.last())
    }
    @Test fun captureRuntimeTimestampsCrossAsIsoStrings() {
        val payload=BridgePayloads.captureRuntime(com.lofuyu.borderledger.capture.CaptureHealthState(uploadRetryAtMillis=0L,lastSuccessfulUploadAtMillis=1000L))
        assertEquals("1970-01-01T00:00:00Z",payload["uploadRetryAt"])
        assertEquals("1970-01-01T00:00:01Z",payload["lastSuccessfulUploadAt"])
        assertFalse(payload.containsKey("uploadRetryAtMillis"))
    }
    @Test fun sessionProjectionDoesNotExposeNativeRefreshOrBrowserSecrets() {
        val payload = BridgePayloads.session(OwnerSessionState.SignedIn("2026-10-17T00:00:00Z", listOf("owner"), "activity", "2027-01-01T00:00:00Z"), "sandbox")
        assertEquals(setOf("state", "expiresAt", "pendingDestination", "reason", "pendingRevocations", "environment"), payload.keys)
        assertEquals("signed_in", payload["state"])
        assertEquals("sandbox", payload["environment"])
    }
    @Test fun ledgerKeepsMoneyBeyondJsSafeIntegerRangeExact() {
        val value = LedgerTransaction("t", "2026-10-16T00:00:00Z", "CAD", Long.MIN_VALUE, null, null, "confirmed", null, null, null)
        assertEquals("-9223372036854775808", BridgePayloads.transaction(value)["signedMinorUnits"])
    }
    @Test fun recurringNullMoneyIsNotZero() {
        val stream = RecurringStreamDto("s", "a", "CAD", null, null, "monthly", null, "bill", "active", true, null, null, null, 9007199254740993L, null, null, null, 2)
        assertNull(BridgePayloads.stream(stream)["averageAmountMinor"])
        assertEquals("9007199254740993", BridgePayloads.stream(stream)["lastAmountMinor"])
    }
    @Test fun reviewMoneyUsesDecimalString() {
        assertEquals(mapOf("currency" to "CAD", "amountMinor" to "125"), BridgePayloads.money(ReviewMoney("CAD", 125)))
    }
    @Test fun accountProjectionNeverReturnsLinkTokenOrProviderErrors() {
        val op = ConnectionOperation("o", "pending", linkToken="secret", pendingConnectionId="p", accounts=emptyList())
        val payload = BridgePayloads.link(ConnectionCoordinatorState.Pending(op, emptyList()))
        assertEquals(setOf("state", "outcomeCode", "operationId", "canCancel", "pendingConnectionId", "connectionId", "accounts"), payload.keys)
        assertEquals("success", payload["outcomeCode"])
        assertNull(payload["operationId"])
        assertEquals(false, payload["canCancel"])
        assertFalse(payload.toString().contains("secret"))
        val failed=BridgePayloads.link(ConnectionCoordinatorState.Failed("secret"))
        assertEquals("failed", failed["state"])
        assertEquals("failed", failed["outcomeCode"])
        assertFalse(failed.toString().contains("secret"))
    }
    @Test fun captureProjectionDoesNotAcceptSyntheticEvidenceOrIncludeCredential() {
        val payload = BridgePayloads.capture(CaptureOnboardingState(sourceTest=SourceTestResult.SyntheticOnly))
        assertEquals("SyntheticOnly", payload["sourceTest"])
        assertFalse(payload.containsKey("credential"))
    }
    @Test fun fileSnapshotDoesNotTransferFileContents() {
        val payload = BridgePayloads.files(ImportState.Idle, ExportState.Idle)
        assertEquals(0, payload["rowCount"])
        assertNull(payload["importReceiptId"])
        assertFalse(payload.containsKey("bytes"))
    }
    @Test fun preferencesPreserveDeviceAndReportingSeparation() {
        assertEquals(mapOf("appearanceMode" to "Dark", "filter" to "All", "reducedMotion" to true), BridgePayloads.display(DeviceDisplayPreferences(AppearanceMode.Dark, reducedMotion=true)))
        assertEquals("UTC", BridgePayloads.reporting(ReportingPreferences("UTC", 1, null, 4))["reportingTimezone"])
    }
}
