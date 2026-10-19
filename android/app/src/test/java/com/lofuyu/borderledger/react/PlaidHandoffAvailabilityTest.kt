package com.lofuyu.borderledger.react

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaidHandoffAvailabilityTest {
    @Test fun cancellationIsAvailableDuringPreparationButNotWhileProviderOrCallbackOwnsFlow() {
        fun state(open: Boolean, returned: Boolean, callback: Boolean, phase: String = "linking", status: String? = "awaiting_result") =
            PlaidHandoffState(phase, status, open, returned, callback)
        assertTrue(PlaidHandoffAvailability.canCancel(state(open = false, returned = false, callback = false)))
        assertFalse(PlaidHandoffAvailability.canCancel(state(open = true, returned = false, callback = false)))
        assertFalse(PlaidHandoffAvailability.canCancel(state(open = true, returned = true, callback = true)))
        assertTrue(PlaidHandoffAvailability.canCancel(state(open = true, returned = true, callback = false)))
        assertFalse(PlaidHandoffAvailability.canCancel(state(open = false, returned = false, callback = false, phase = "reconciliation_required")))
        assertFalse(PlaidHandoffAvailability.canCancel(state(open = false, returned = false, callback = false, status = "running")))
    }
}
