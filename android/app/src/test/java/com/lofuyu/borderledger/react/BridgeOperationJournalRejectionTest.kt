package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeOperationJournalRejectionTest {
    @Test fun definitiveServerRejectionIsTerminalAndDoesNotBlockTheNextReviewedAction() = runTest {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        val rejected = journal.start("reject-account-1", "account_select", "payload-a", "owner-a") {
            throw com.lofuyu.borderledger.accounts.AccountRequestRejected(409)
        }
        val later = journal.start("next-account-01", "account_select", "payload-a", "owner-a") { "receipt-1" }

        assertEquals("rejected", rejected.status)
        assertEquals("completed", later.status)
        assertNotEquals(rejected.operationId, later.operationId)
    }

    private class MemoryRecords : SecureRecordPort {
        private val records = mutableMapOf<String, ByteArray>()
        override suspend fun read(record: String) = records[record]?.copyOf()
        override suspend fun write(record: String, value: ByteArray) { records[record] = value.copyOf() }
        override suspend fun delete(record: String) { records.remove(record) }
    }
}
