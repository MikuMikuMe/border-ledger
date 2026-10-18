package com.lofuyu.borderledger.react

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaidHandoffAvailabilityTest {
    @Test fun cancellationIsAvailableDuringPreparationButNotWhileProviderOrCallbackOwnsFlow() {
        assertTrue(PlaidHandoffAvailability.canCancel("linking", "awaiting_result", providerMayBeOpen = false, providerReturned = false, callbackInProgress = false))
        assertFalse(PlaidHandoffAvailability.canCancel("linking", "awaiting_result", providerMayBeOpen = true, providerReturned = false, callbackInProgress = false))
        assertFalse(PlaidHandoffAvailability.canCancel("linking", "awaiting_result", providerMayBeOpen = true, providerReturned = true, callbackInProgress = true))
        assertTrue(PlaidHandoffAvailability.canCancel("linking", "awaiting_result", providerMayBeOpen = true, providerReturned = true, callbackInProgress = false))
        assertFalse(PlaidHandoffAvailability.canCancel("reconciliation_required", "awaiting_result", providerMayBeOpen = false, providerReturned = false, callbackInProgress = false))
        assertFalse(PlaidHandoffAvailability.canCancel("linking", "running", providerMayBeOpen = false, providerReturned = false, callbackInProgress = false))
    }
}
