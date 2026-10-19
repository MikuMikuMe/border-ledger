package com.lofuyu.borderledger.core

import kotlin.test.*

class SessionRulesTest {
    @Test fun callbackWithoutPendingStateOnlyAcceptsCompletedDigest() {
        assertEquals(CallbackDecision.Duplicate, decideCallback(CallbackInput(null, "done", "done", "code", null)))
        assertEquals(CallbackDecision.Rejected(false), decideCallback(CallbackInput(null, "other", "done", "code", null)))
    }

    @Test fun mismatchRemainsRecoverableAndDoesNotCancelPendingLogin() {
        assertEquals(CallbackDecision.Rejected(true), decideCallback(CallbackInput("pending", "wrong", null, "code", "access_denied")))
    }

    @Test fun verifiedStateControlsErrorAndCodeOutcomes() {
        assertEquals(CallbackDecision.Canceled, decideCallback(CallbackInput("s", "s", null, null, "access_denied")))
        assertEquals(CallbackDecision.FailedReturn, decideCallback(CallbackInput("s", "s", null, "code", "other")))
        assertEquals(CallbackDecision.Rejected(true), decideCallback(CallbackInput("s", "s", null, " ", null)))
        assertEquals(CallbackDecision.Exchange, decideCallback(CallbackInput("s", "s", null, "code", null)))
    }

    @Test fun expiryIsStrictAndInvalidTimestampsAreExpired() {
        val clock = object : CoreClock {
            override fun nowIso() = "now"
            override fun isAfterNow(iso: String) = when (iso) { "future" -> true; "now", "past" -> false; else -> error("bad timestamp") }
        }
        assertTrue(accessIsValid("future", clock))
        assertFalse(accessIsValid("now", clock))
        assertFalse(accessIsValid("past", clock))
        assertFalse(accessIsValid("invalid", clock))
    }
}
