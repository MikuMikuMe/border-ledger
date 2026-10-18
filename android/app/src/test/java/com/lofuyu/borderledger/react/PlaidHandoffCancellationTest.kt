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
        journal.awaitExternal("plaid-cancel", "plaid", "{}", "owner-a")

        val result = PlaidHandoffCancellation(journal, PlaidProviderLaunchState(records)).cancelBeforeSubmission("plaid-cancel", "owner-a")

        assertTrue(result is PlaidCancellationDecision.Canceled)
        assertEquals("canceled", result?.operation?.status)
    }

    @Test fun submittedPlaidExchangeIsRetainedForReconciliationInsteadOfCanceled() = runTest {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        journal.awaitExternal("plaid-submitted", "plaid", "{}", "owner-a")
        journal.completeExternal("plaid-submitted", "owner-a") { error("exchange response was lost") }

        val result = PlaidHandoffCancellation(journal, PlaidProviderLaunchState(records)).cancelBeforeSubmission("plaid-submitted", "owner-a")

        assertTrue(result is PlaidCancellationDecision.Retained)
        assertEquals("reconciliation_required", result?.operation?.status)
    }

    @Test fun cancellationCannotTargetAnotherOwnersOrNonPlaidOperation() = runTest {
        val importJournal = BridgeOperationJournal(MemoryRecords())
        importJournal.awaitExternal("import-1", "import_picker", "{}", "owner-a")
        val plaidJournal = BridgeOperationJournal(MemoryRecords())
        plaidJournal.awaitExternal("plaid-01", "plaid", "{}", "owner-a")

        assertEquals(null, PlaidHandoffCancellation(importJournal, PlaidProviderLaunchState(MemoryRecords())).cancelBeforeSubmission("import-1", "owner-a"))
        assertEquals(null, PlaidHandoffCancellation(plaidJournal, PlaidProviderLaunchState(MemoryRecords())).cancelBeforeSubmission("plaid-01", "owner-b"))
        assertEquals("awaiting_result", importJournal.query("import-1", "owner-a")?.status)
        assertEquals("awaiting_result", plaidJournal.query("plaid-01", "owner-a")?.status)
    }

    @Test fun recreatedProcessCannotCancelAuthorizationThatMayStillBeOpen() = runTest {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        journal.awaitExternal("plaid-active", "plaid", "{}", "owner-a")
        PlaidProviderLaunchState(records).markStarted("owner-a", "plaid-active")

        val result = PlaidHandoffCancellation(journal, PlaidProviderLaunchState(records))
            .cancelBeforeSubmission("plaid-active", "owner-a")

        assertTrue(result is PlaidCancellationDecision.Retained)
        assertEquals("awaiting_result", result?.operation?.status)
    }

    @Test fun returnedToAppWithoutCallbackCanCancelStaleProviderHandoff() = runTest {
        val records = MemoryRecords()
        val journal = BridgeOperationJournal(records)
        journal.awaitExternal("plaid-returned", "plaid", "{}", "owner-a")
        val launchState = PlaidProviderLaunchState(records)
        launchState.markStarted("owner-a", "plaid-returned")

        val result = PlaidHandoffCancellation(journal, launchState)
            .cancelBeforeSubmission("plaid-returned", "owner-a", providerHasReturned = true)

        assertTrue(result is PlaidCancellationDecision.Canceled)
        assertEquals("canceled", result?.operation?.status)
    }

    private class MemoryRecords : SecureRecordPort {
        private val records = mutableMapOf<String, ByteArray>()
        override suspend fun read(record: String) = records[record]?.copyOf()
        override suspend fun write(record: String, value: ByteArray) { records[record] = value.copyOf() }
        override suspend fun delete(record: String) { records.remove(record) }
    }
}
