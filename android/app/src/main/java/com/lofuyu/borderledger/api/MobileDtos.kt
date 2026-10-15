package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.parser.InstrumentHintKind

/**
 * Kotlin-side shapes for the accepted Worker mobile contracts. Secrets are
 * carried only in memory at the provider boundary and are persisted only by
 * the encrypted stores in the auth/local packages.
 */
data class OwnerLoginStartRequest(
    val codeChallenge: String,
    val state: String,
    val deviceId: String?,
    val environment: String,
)

data class OwnerLoginStartResponse(
    val requestId: String,
    val authorizationUrl: String,
    val expiresAt: String,
)

data class OwnerCodeExchangeRequest(
    val requestId: String,
    val code: String,
    val verifier: String,
    val state: String,
    val deviceId: String?,
    val environment: String,
    val idempotencyKey: String,
    val staySignedIn: Boolean,
)

data class OwnerRefreshRequest(
    val refreshToken: String,
    val environment: String,
    val idempotencyKey: String,
)

data class OwnerTokenResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: String,
    val scopes: List<String>,
    val revision: Int,
    val revocationCapability: String,
)

enum class RevocationGrantType {
    OwnerFamily,
    CaptureCredential,
}

data class RevocationIntent(
    val grantType: RevocationGrantType,
    val generation: Int,
    val capability: String,
    val createdAt: String,
)

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
