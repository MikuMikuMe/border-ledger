package com.lofuyu.borderledger.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CapturePairingDtoTest {
    @Test
    fun instrumentHintIsPreservedInWorkerMappingJson() {
        val mapping = CaptureScopeConsent(
            sourceProfileId = "boc",
            accountId = "account-1",
            currency = "EUR",
            instrumentHint = CaptureInstrumentHint("card_suffix", "1234"),
        )

        val json = mapping.toWorkerMappingJson()

        assertEquals("card_suffix", json.getJSONObject("instrumentHint").getString("kind"))
        assertEquals("1234", json.getJSONObject("instrumentHint").getString("value"))
        assertEquals("EUR", json.getJSONArray("allowedCurrencies").getString(0))
    }

    @Test
    fun unsupportedOrUnboundedInstrumentHintIsRejectedAtApiBoundary() {
        assertThrows(IllegalArgumentException::class.java) {
            CaptureInstrumentHint("unknown_kind", "1234")
        }
        assertThrows(IllegalArgumentException::class.java) {
            CaptureInstrumentHint("card_suffix", "x".repeat(65))
        }
    }
}
