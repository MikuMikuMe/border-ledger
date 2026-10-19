package com.lofuyu.borderledger.auth

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthCallbackCompletionTest {
    @Test fun callbackFailureFinishesWithoutEscapingOrExposingTheInput() = runTest {
        var finishes = 0

        finishAfterAuthCallback(
            handleCallback = { throw IllegalArgumentException("sensitive callback input") },
            finish = { finishes++ },
        )

        assertEquals(1, finishes)
    }

    @Test fun successfulCallbackFinishesAfterHandling() = runTest {
        val events = mutableListOf<String>()

        finishAfterAuthCallback(
            handleCallback = { events += "handled" },
            finish = { events += "finished" },
        )

        assertEquals(listOf("handled", "finished"), events)
    }

    @Test fun cancellationStillFinishesAndRetainsCoroutineCancellation() = runTest {
        var finished = false
        var canceled = false

        try {
            finishAfterAuthCallback(
                handleCallback = { throw CancellationException("callback canceled") },
                finish = { finished = true },
            )
        } catch (_: CancellationException) {
            canceled = true
        }

        assertTrue(finished)
        assertTrue(canceled)
    }
}
