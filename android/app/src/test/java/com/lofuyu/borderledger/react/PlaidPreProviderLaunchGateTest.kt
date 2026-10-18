package com.lofuyu.borderledger.react

import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaidPreProviderLaunchGateTest {
    @Test fun cancellationBeforeProviderLaunchCancelsPreparationBeforeMarker() = runTest {
        val gate = PlaidPreProviderLaunchGate()
        val job = launch(start = CoroutineStart.LAZY) { kotlinx.coroutines.awaitCancellation() }
        var markerWritten = false
        gate.register("plaid-op-1", job)
        job.start()

        val canceledJob = gate.cancelBeforeProviderLaunch("plaid-op-1")
        canceledJob?.cancelAndJoin()
        val mayOpenProvider = gate.beginProviderLaunch("plaid-op-1", job) { markerWritten = true }

        assertTrue(job.isCancelled)
        assertFalse(markerWritten)
        assertFalse(mayOpenProvider)
    }

    @Test fun providerMarkerAndCancellationAreSerialized() = runTest {
        val gate = PlaidPreProviderLaunchGate()
        val job = launch(start = CoroutineStart.LAZY) { kotlinx.coroutines.awaitCancellation() }
        var markerWritten = false
        gate.register("plaid-op-2", job)
        job.start()

        assertTrue(gate.beginProviderLaunch("plaid-op-2", job) { markerWritten = true })
        assertTrue(markerWritten)
        assertNull(gate.cancelBeforeProviderLaunch("plaid-op-2"))
        job.cancelAndJoin()
    }
}
