package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.auth.OwnerSessionState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class OwnerSessionGenerationTest {
    @Test fun anOwnerReadWaitsForTheInProgressSessionRefresh() = runTest {
        val state = MutableStateFlow<OwnerSessionState>(OwnerSessionState.Refreshing)
        val checkedRefreshing = CompletableDeferred<Unit>()
        val read = async {
            awaitOwnerGeneration(state) {
                if (state.value is OwnerSessionState.Refreshing) {
                    checkedRefreshing.complete(Unit)
                    null
                } else {
                    "owner-generation"
                }
            }
        }

        checkedRefreshing.await()
        assertFalse(read.isCompleted)

        state.value = OwnerSessionState.SignedIn("2099-01-01T00:00:00Z", emptyList(), null, binding = com.lofuyu.borderledger.auth.SessionBinding(com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), "test-session"))
        assertEquals("owner-generation", read.await())
    }
}
