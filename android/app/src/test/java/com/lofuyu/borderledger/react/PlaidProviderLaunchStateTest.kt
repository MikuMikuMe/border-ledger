package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaidProviderLaunchStateTest {
    @Test fun launchMarkerSurvivesRecreationAndIsScopedToOwnerAndOperation() = runTest {
        val records = MemoryRecords()
        val firstProcess = PlaidProviderLaunchState(records)
        firstProcess.markStarted("owner-a", "plaid-1")

        val recreatedProcess = PlaidProviderLaunchState(records)

        assertTrue(recreatedProcess.wasStarted("owner-a", "plaid-1"))
        assertFalse(recreatedProcess.wasStarted("owner-b", "plaid-1"))
        assertFalse(recreatedProcess.wasStarted("owner-a", "plaid-2"))
    }

    @Test fun terminalCallbackCanClearLaunchMarker() = runTest {
        val state = PlaidProviderLaunchState(MemoryRecords())
        state.markStarted("owner-a", "plaid-1")

        state.clear("owner-a", "plaid-1")

        assertFalse(state.wasStarted("owner-a", "plaid-1"))
    }

    private class MemoryRecords : SecureRecordPort {
        private val records = mutableMapOf<String, ByteArray>()
        override suspend fun read(record: String) = records[record]?.copyOf()
        override suspend fun write(record: String, value: ByteArray) { records[record] = value.copyOf() }
        override suspend fun delete(record: String) { records.remove(record) }
    }
}
