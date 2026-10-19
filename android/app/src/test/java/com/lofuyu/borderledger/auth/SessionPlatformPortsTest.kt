package com.lofuyu.borderledger.auth

import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class SessionPlatformPortsTest {
    @Test fun androidCryptoRetainsUnpaddedPkceAndCallbackDigestEncoding() {
        val crypto = AndroidSessionCrypto()
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", crypto.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", crypto.sha256Hex("abc"))
        assertTrue(Regex("[A-Za-z0-9_-]{43}").matches(crypto.randomToken(32)))
        assertTrue(Regex("[A-Za-z0-9_-]{64}").matches(crypto.randomToken(48)))
    }

    @Test fun androidClockRetainsStrictInstantComparisonIncludingOffsets() {
        val clock = AndroidSessionClock { Instant.parse("2026-10-16T12:00:00Z") }
        assertEquals("2026-10-16T12:00:00Z", clock.nowIso())
        assertFalse(clock.isAfterNow("2026-10-16T08:00:00-04:00"))
        assertTrue(clock.isAfterNow("2026-10-16T08:00:00.000000001-04:00"))
    }
}
