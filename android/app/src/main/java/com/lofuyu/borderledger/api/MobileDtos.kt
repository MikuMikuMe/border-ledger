package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.parser.InstrumentHintKind

/**
 * Kotlin-side shapes for the accepted Worker mobile contracts. Secrets are
 * carried only in memory at the provider boundary and are persisted only by
 * the encrypted stores in the auth/local packages.
 */

data class CaptureScopeConsent(
    val sourceProfileId: String,
    val accountId: String,
    val currency: String,
    val instrumentHint: CaptureInstrumentHint? = null,
)

/** Bounded, non-secret identity evidence for one source instrument. */
data class CaptureInstrumentHint(
    val kind: String,
    val value: String,
) {
    init {
        require(InstrumentHintKind.entries.any { it.wireValue == kind }) { "Instrument hint kind is unsupported." }
        require(value.isNotBlank() && value == value.trim() && value.length <= 64 && value.none(Char::isISOControl)) {
            "Instrument hint value is invalid."
        }
    }
}

data class CapturePairingRequest(
    val deviceName: String,
    val sourceScopes: List<CaptureScopeConsent>,
    val explicitConsent: Boolean,
    val expectedRevision: Int = 0,
)

data class CaptureCredentialGrant(
    val credential: String,
    val deviceId: String,
    val generation: Int,
    val expiresAt: String,
    val revocationCapability: String,
)
