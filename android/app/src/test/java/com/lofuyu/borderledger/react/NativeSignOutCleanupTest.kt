package com.lofuyu.borderledger.react

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeSignOutCleanupTest {
    @Test fun pendingPlaidResultIsNotClearedWhenSignOutReturnsStorageFailure() = runTest {
        var cleared = false

        val result = signOutBeforeClearingHandoff(
            signOut = { mapOf("state" to "storage_failure") },
            clearHandoff = { cleared = true },
        )

        assertFalse(cleared)
        assertTrue(result["state"] == "storage_failure")
    }

    @Test fun pendingPlaidResultIsNotClearedWhenDurableSignOutFails() = runTest {
        var cleared = false

        try {
            signOutBeforeClearingHandoff(
                signOut = { error("secure session store unavailable") },
                clearHandoff = { cleared = true },
            )
        } catch (_: IllegalStateException) {
            // The sign-out failure is intentionally surfaced to the caller.
        }

        assertFalse(cleared)
    }

    @Test fun pendingPlaidResultIsClearedAfterDurableSignOutSucceeds() = runTest {
        var signedOut = false
        var clearedAfterSignOut = false

        val result = signOutBeforeClearingHandoff(
            signOut = { signedOut = true; mapOf("state" to "signed_out") },
            clearHandoff = { clearedAfterSignOut = signedOut },
        )

        assertTrue(clearedAfterSignOut)
        assertTrue(result["state"] == "signed_out")
    }
}
