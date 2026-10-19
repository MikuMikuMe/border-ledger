package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaidHandoffCancellationTest {
    @Test fun awaitingPlaidCallbackCanBeCanceledBeforeAnyExchangeStarts() = runTest {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        journal.awaitExternal(BridgeOperationRequest("plaid-cancel", "plaid", "{}", "owner-a"))

        val result = PlaidHandoffCancellation(journal, PlaidProviderLaunchState(records)).cancelBeforeSubmission("plaid-cancel", "owner-a")

        assertTrue(result is PlaidCancellationDecision.Canceled)
        assertEquals("canceled", result?.operation?.status)
    }

    @Test fun submittedPlaidExchangeIsRetainedForReconciliationInsteadOfCanceled() = runTest {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        journal.awaitExternal(BridgeOperationRequest("plaid-submitted", "plaid", "{}", "owner-a"))
        journal.completeExternal(BridgeOperationKey("plaid-submitted", "owner-a")) { error("exchange response was lost") }

        val result = PlaidHandoffCancellation(journal, PlaidProviderLaunchState(records)).cancelBeforeSubmission("plaid-submitted", "owner-a")

        assertTrue(result is PlaidCancellationDecision.Retained)
        assertEquals("reconciliation_required", result?.operation?.status)
    }

    @Test fun cancellationCannotTargetAnotherOwnersOrNonPlaidOperation() = runTest {
        val importJournal = BridgeOperationJournal(MemoryRecords())
        importJournal.awaitExternal(BridgeOperationRequest("import-1", "import_picker", "{}", "owner-a"))
        val plaidJournal = BridgeOperationJournal(MemoryRecords())
        plaidJournal.awaitExternal(BridgeOperationRequest("plaid-01", "plaid", "{}", "owner-a"))

        assertEquals(null, PlaidHandoffCancellation(importJournal, PlaidProviderLaunchState(MemoryRecords())).cancelBeforeSubmission("import-1", "owner-a"))
        assertEquals(null, PlaidHandoffCancellation(plaidJournal, PlaidProviderLaunchState(MemoryRecords())).cancelBeforeSubmission("plaid-01", "owner-b"))
        assertEquals("awaiting_result", importJournal.query(BridgeOperationKey("import-1", "owner-a"))?.status)
        assertEquals("awaiting_result", plaidJournal.query(BridgeOperationKey("plaid-01", "owner-a"))?.status)
    }

    @Test fun recreatedProcessCannotCancelAuthorizationThatMayStillBeOpen() = runTest {
        val result = cancelStartedHandoff("plaid-active", providerHasReturned = false)

        assertTrue(result is PlaidCancellationDecision.Retained)
        assertEquals("awaiting_result", result?.operation?.status)
    }

    @Test fun returnedToAppWithoutCallbackCanCancelStaleProviderHandoff() = runTest {
        val result = cancelStartedHandoff("plaid-returned", providerHasReturned = true)

        assertTrue(result is PlaidCancellationDecision.Canceled)
        assertEquals("canceled", result?.operation?.status)
    }

    private suspend fun cancelStartedHandoff(
        operationId: String,
        providerHasReturned: Boolean,
    ): PlaidCancellationDecision? {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        journal.awaitExternal(BridgeOperationRequest(operationId, "plaid", "{}", "owner-a"))
        val launchState = PlaidProviderLaunchState(records)
        launchState.markStarted("owner-a", operationId)
        return PlaidHandoffCancellation(journal, launchState)
            .cancelBeforeSubmission(operationId, "owner-a", providerHasReturned)
    }

    private class MemoryRecords : SecureRecordPort {
        private val records = mutableMapOf<String, ByteArray>()
        override suspend fun read(record: String) = records[record]?.copyOf()
        override suspend fun write(record: String, value: ByteArray) { records[record] = value.copyOf() }
        override suspend fun delete(record: String) { records.remove(record) }
    }
}
