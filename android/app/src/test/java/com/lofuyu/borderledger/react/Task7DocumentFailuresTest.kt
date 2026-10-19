package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import com.lofuyu.borderledger.imports.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class Task7DocumentFailuresTest {
    @Test fun oversizedSelectionIsRejectedBeforeAnyRunningRecordOrSubmissionAndSurvivesReload()=runTest {
        val disk=Records();var writes=0
        val draft=ImportDraft(preview(501),emptyList(),(1..501).map { "row-$it" }.toSet())
        val result=BridgeOperationJournal(disk).startValidated(BridgeOperationRequest("oversize-1","import_commit","501","owner"),{BridgeImportOperations.requireCommit(draft)}) { writes++;"wrong" }
        assertEquals("failed_local",result.status)
        assertEquals(0,writes)
        assertFalse(disk.writes.any { it.contains("\"status\":\"running\"") })
        assertEquals("failed_local",BridgeOperationJournal(disk).list(BridgeOperationPage("owner",0,50)).single().status)
    }

    @Test fun corruptDocumentIsTerminalAndAnotherPickerCanPrepareANewDocumentWithoutReplayingTheFailure()=runTest {
        val disk=Records();val gateway=Gateway();val repository=ImportRepository(gateway)
        val journal=BridgeOperationJournal(disk)
        journal.awaitExternal(BridgeOperationRequest("picker-bad","import_picker","same-account","owner"))
        val corrupt=readCsv("Date,Description,Amount,Currency\n2026-10-17,\"unterminated,-1.00,CAD")
        assertEquals(DocumentReadResult.Corrupt("invalid_csv"),corrupt)
        val failure=journal.completeExternal(BridgeOperationKey("picker-bad","owner")) { BridgeImportOperations.preview(repository,corrupt,"account","picker-bad") }
        assertEquals("failed_local",failure.status)
        assertEquals("corrupt_document",(repository.state.value as ImportState.Error).failure.code)
        assertEquals(0,gateway.requests)
        val restored=BridgeOperationJournal(disk)
        assertEquals("failed_local",restored.list(BridgeOperationPage("owner",0,50)).single().status)
        assertTrue(BridgeImportOperations.canReplaceUndrainedPicker("import_picker",restored.query(BridgeOperationKey("picker-bad","owner"))?.status))
        assertEquals("picker-new",restored.awaitExternal(BridgeOperationRequest("picker-new","import_picker","same-account","owner")).operationId)
        val result=restored.completeExternal(BridgeOperationKey("picker-new","owner")) { BridgeImportOperations.preview(repository,document(),"account","picker-new") }
        assertEquals("completed",result.status)
        assertEquals(1,gateway.requests)
    }

    @Test fun unknownFailureAfterPreviewSubmissionRemainsBlockedAcrossReloadAndCannotReplay()=runTest {
        val disk=Records();val gateway=Gateway(fail=true);val repository=ImportRepository(gateway)
        val journal=BridgeOperationJournal(disk)
        journal.awaitExternal(BridgeOperationRequest("picker-lost","import_picker","same-account","owner"))
        val failure=journal.completeExternal(BridgeOperationKey("picker-lost","owner")) { BridgeImportOperations.preview(repository,document(),"account","picker-lost") }
        assertEquals("reconciliation_required",failure.status)
        assertEquals(1,gateway.requests)
        val restored=BridgeOperationJournal(disk)
        assertEquals("picker-lost",restored.awaitExternal(BridgeOperationRequest("picker-retry","import_picker","same-account","owner")).operationId)
        restored.completeExternal(BridgeOperationKey("picker-lost","owner")) { fail("Ambiguous submission must never be replayed");null }
        assertEquals(1,gateway.requests)
    }

    @Test fun appPostingSettingsUsesAnAppSpecificTargetSeparateFromListenerAccess() {
        assertEquals("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS",captureSettingsRequest("com.lofuyu.borderledger.probe",false).action)
        assertTrue(captureSettingsRequest("com.lofuyu.borderledger.probe",false).extras.isEmpty())
        val app=captureSettingsRequest("com.lofuyu.borderledger.probe",true)
        assertEquals("android.settings.APP_NOTIFICATION_SETTINGS",app.action)
        assertEquals(mapOf("android.provider.extra.APP_PACKAGE" to "com.lofuyu.borderledger.probe"),app.extras)
    }

    @Test fun onlyProvenLocalImportFailuresCanReplaceAnUndrainedCallback() {
        assertTrue(BridgeImportOperations.canReplaceUndrainedPicker("import_picker","failed_local"))
        for(status in listOf("awaiting_result","running","reconciliation_required","completed","canceled",null))
            assertFalse(BridgeImportOperations.canReplaceUndrainedPicker("import_picker",status))
        assertFalse(BridgeImportOperations.canReplaceUndrainedPicker("plaid","failed_local"))
    }

    @Test fun exactCommitLimitIsAllowedAndEmptyOrMissingSelectionsAreLocalFailures()=runTest {
        val disk=Records();var writes=0
        val valid=ImportDraft(preview(500),emptyList(),(1..500).map { "row-$it" }.toSet())
        val allowed=BridgeOperationJournal(disk).startValidated(BridgeOperationRequest("allowed-500","import_commit","500","owner"),{BridgeImportOperations.requireCommit(valid)}) { writes++;"receipt" }
        assertEquals("completed",allowed.status)
        assertEquals(1,writes)
        for((id,draft) in listOf("missing-1" to null,"empty-111" to valid.copy(selectedRowIds=emptySet()))) {
            val rejected=BridgeOperationJournal(disk).startValidated(BridgeOperationRequest(id,"import_commit",id,"owner"),{BridgeImportOperations.requireCommit(draft)}) { fail("Invalid selection submitted");null }
            assertEquals("failed_local",rejected.status)
        }
    }

    private fun preview(count: Int)=ImportPreview("preview",3,"2026-10-18T00:00:00Z","ready","account","hash",count)
    private fun document()=readCsv("Date,Description,Amount,Currency\n2026-10-17,Cafe,-1.00,CAD") as DocumentReadResult.Success
    private fun readCsv(csv: String):DocumentReadResult {
        val bytes=csv.toByteArray()
        val source=object:StatementDocumentSource {
            override fun displayName(uri:android.net.Uri)="statement.csv"
            override fun mimeType(uri:android.net.Uri)="text/csv"
            override fun length(uri:android.net.Uri)=bytes.size.toLong()
            override fun persistReadPermission(uri:android.net.Uri)=Unit
            override fun open(uri:android.net.Uri)=java.io.ByteArrayInputStream(bytes)
        }
        return StatementDocumentReader(source).read(android.net.Uri.parse("content://test/import"))
    }
    private inner class Gateway(private val fail: Boolean=false):OwnerImportGateway {
        var requests=0
        override suspend fun createImportPreview(request:CreateImportPreviewRequest):ImportPreview { requests++;if(fail)error("unknown response after submission");return preview(1) }
        override suspend fun stageImportChunk(request:StageImportChunkRequest)=preview(1)
        override suspend fun commitImport(request:CommitImportRequest):ImportCommitResponse=error("not called")
        override suspend fun decideDuplicate(request:DecideImportDuplicateRequest):ImportPreview=error("not called")
        override suspend fun cancelImport(request:CancelImportRequest):ImportPreview=error("not called")
    }
    private class Records:SecureRecordPort {
        val values=mutableMapOf<String,ByteArray>();val writes=mutableListOf<String>()
        override suspend fun read(record:String)=values[record]?.copyOf()
        override suspend fun write(record:String,value:ByteArray){values[record]=value.copyOf();writes+=value.decodeToString()}
        override suspend fun delete(record:String){values.remove(record)}
    }
}
