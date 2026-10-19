package com.lofuyu.borderledger.core

import kotlinx.coroutines.CancellationException
import com.lofuyu.borderledger.api.TransportFailure
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class OwnerReadOrchestratorTest {
    @Test fun signedOutReadDoesNotCallRemote() = runTest {
        var calls = 0
        val result = ownerRead(OwnerReadRequest(false, true, {}, { calls++; "private" }) { it })
        assertEquals(OwnerReadResult.NotSignedIn, result)
        assertEquals(0, calls)
    }

    @Test fun unauthorizedInvalidatesBeforeReturningAndOfflineRemainsDistinct() = runTest {
        var invalidated = false
        val denied = ownerRead(OwnerReadRequest<String, String>(true, true, { invalidated = true }, { throw TransportFailure.Unauthorized }) { it })
        assertTrue(invalidated)
        assertEquals(OwnerReadResult.Unauthorized, denied)
        val offline = ownerRead(OwnerReadRequest<String, String>(true, true, {}, { throw TransportFailure.Offline }) { it })
        assertEquals(OwnerReadResult.Offline, offline)
    }

    @Test fun missingApiAndInvalidPayloadAreUnavailable() = runTest {
        assertEquals(OwnerReadResult.NotSignedIn, ownerRead(OwnerReadRequest(false, false, {}, { "unused" }) { it }))
        assertEquals(OwnerReadResult.Unavailable, ownerRead(OwnerReadRequest(true, false, {}, { "unused" }) { it }))
        assertEquals(OwnerReadResult.Unavailable, ownerRead(OwnerReadRequest<String, String>(true, true, {}, { "bad" }) { null }))
    }

    @Test fun successRetainsValueAndCancellationPropagatesWithoutRetry() = runTest {
        assertEquals(OwnerReadResult.Ready(7), ownerRead(OwnerReadRequest(true, true, {}, { "7" }) { it.toInt() }))
        var attempts = 0
        assertFailsWith<CancellationException> {
            ownerRead(OwnerReadRequest<String, String>(true, true, {}, { attempts++; throw CancellationException() }) { it })
        }
        assertEquals(1, attempts)
    }
}
