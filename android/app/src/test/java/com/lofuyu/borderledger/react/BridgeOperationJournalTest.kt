package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class BridgeOperationJournalTest {
    @Test fun recreatedRuntimeCanDiscoverLostOperationIdsWithoutJsStorage()=runTest {
        val disk=MemoryRecords()
        BridgeOperationJournal(disk).start("discover-1","review","p","owner") { error("lost response") }
        val list=BridgeOperationJournal(disk).list("owner",0,50)
        assertEquals(listOf("discover-1"),list.map { it.operationId })
        assertEquals("reconciliation_required",list.single().status)
        assertTrue(BridgeOperationJournal(disk).list("other-owner",0,50).isEmpty())
    }
    @Test fun lostRecurringResponseRemainsUnresolvedWithoutRepeatingTheRepositoryMutation()=runTest {
        val disk=MemoryRecords()
        var applied=0
        val repository=com.lofuyu.borderledger.recurring.RecurringRepository(object: com.lofuyu.borderledger.recurring.OwnerRecurringApi {
            override suspend fun readPage(query: com.lofuyu.borderledger.recurring.RecurringQuery)=error("Not called")
            override suspend fun readSummary(query: com.lofuyu.borderledger.recurring.RecurringSummaryQuery)=error("Not called")
            override suspend fun readDetail(id: String,cursor: String?,limit: Int)=error("Not called")
            override suspend fun classify(id: String,expectedRevision: Int,classification: String): com.lofuyu.borderledger.recurring.RecurringClassificationAck {
                assertEquals("stream-1",id); assertEquals(3,expectedRevision); assertEquals("bill",classification)
                applied++
                throw com.lofuyu.borderledger.api.TransportFailure.Retryable
            }
        })
        val submit: suspend () -> String? = { repository.classify("stream-1",3,"bill"); null }
        BridgeOperationJournal(disk).start("recurring-1","recurring_classify","stream-1:3:bill","owner",submit)
        val result=BridgeOperationJournal(disk).start("recurring-2","recurring_classify","stream-1:3:bill","owner",submit)
        assertEquals(1,applied)
        assertEquals("recurring-1",result.operationId)
        assertEquals("reconciliation_required",result.status)
    }
    @Test fun aConfirmedRevisionConflictIsNotAnAmbiguousSuccess()=runTest {
        val result=BridgeOperationJournal(MemoryRecords()).start("conflict-1","recurring_classify","p","owner") { throw com.lofuyu.borderledger.recurring.RecurringRevisionConflict(4) }
        assertEquals("revision_conflict",result.status)
        assertNull(result.resultId)
    }
    @Test fun aNewJsRequestIdCannotRetryAnUnresolvedIdenticalWrite() = runTest {
        val disk=MemoryRecords(); var writes=0
        BridgeOperationJournal(disk).start("original-1","review","payload","owner") { writes++; error("timeout") }
        val result=BridgeOperationJournal(disk).start("new-id-22","review","payload","owner") { writes++; "wrong" }
        assertEquals(1,writes)
        assertEquals("original-1",result.operationId)
        assertEquals("reconciliation_required",result.status)
    }
    @Test fun externalCallbackAfterRecreationIsClaimedOnceAndCancelDiscardsLateResult() = runTest {
        val disk=MemoryRecords()
        BridgeOperationJournal(disk).awaitExternal("external-1", "import", "a", "owner")
        val restored=BridgeOperationJournal(disk)
        var writes=0
        assertEquals("completed", restored.completeExternal("external-1", "owner") { writes++; "receipt" }.status)
        restored.completeExternal("external-1", "owner") { writes++; "wrong" }
        assertEquals(1,writes)
        restored.awaitExternal("external-2", "import", "a", "owner")
        assertEquals("canceled", restored.cancel("external-2", "owner")?.status)
        restored.completeExternal("external-2", "owner") { writes++; "wrong" }
        assertEquals(1,writes)
    }

    @Test fun claimedCallbackWithLostProcessRemainsAmbiguousAndNeverResubmits() = runTest {
        val disk=MemoryRecords()
        val first=BridgeOperationJournal(disk)
        first.awaitExternal("external-3", "plaid", "a", "owner")
        first.completeExternal("external-3", "owner") { error("lost response") }
        var writes=0
        val result=BridgeOperationJournal(disk).completeExternal("external-3", "owner") { writes++; "wrong" }
        assertEquals("reconciliation_required",result.status)
        assertEquals(0,writes)
    }
    @Test fun lostPromiseAndRecreationNeverReplayFinancialWrite() = runTest {
        val disk = MemoryRecords()
        var writes = 0
        BridgeOperationJournal(disk).start("request-1", "review", "same", "owner") { writes++; error("secret token") }
        val result = BridgeOperationJournal(disk).start("request-1", "review", "same", "owner") { writes++; "receipt" }
        assertEquals(1, writes)
        assertEquals("reconciliation_required", result.status)
        assertFalse(result.toString().contains("secret"))
    }

    @Test fun simultaneousDuplicateStartUsesOneWrite() = runTest {
        val journal = BridgeOperationJournal(MemoryRecords())
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var writes = 0
        val first = async { journal.start("request-2", "sync", "same", "owner") { writes++; entered.complete(Unit); release.await(); "receipt" } }
        entered.await()
        val second = journal.start("request-2", "sync", "same", "owner") { writes++; "wrong" }
        assertEquals("running", second.status)
        release.complete(Unit)
        assertEquals("completed", first.await().status)
        assertEquals(1, writes)
    }

    @Test fun mismatchedPayloadAndOwnerCannotReuseOrInspectOperation() = runTest {
        val journal = BridgeOperationJournal(MemoryRecords())
        journal.start("request-3", "sync", "a", "owner") { "receipt" }
        try { journal.start("request-3", "sync", "b", "owner") { "wrong" }; fail() } catch (_: IllegalArgumentException) { }
        assertNull(journal.query("request-3", "different-owner"))
    }

    @Test fun cancellationNeverClaimsToUndoSubmittedWrite() = runTest {
        val journal = BridgeOperationJournal(MemoryRecords())
        journal.start("request-4", "review", "same", "owner") { error("offline") }
        assertEquals("reconciliation_required", journal.cancel("request-4", "owner")?.status)
    }

    private class MemoryRecords : SecureRecordPort {
        val records = mutableMapOf<String, ByteArray>()
        override suspend fun read(record: String) = records[record]?.copyOf()
        override suspend fun write(record: String, value: ByteArray) { records[record] = value.copyOf() }
        override suspend fun delete(record: String) { records.remove(record) }
    }
}
