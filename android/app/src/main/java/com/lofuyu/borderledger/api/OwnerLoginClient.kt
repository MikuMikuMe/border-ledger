package com.lofuyu.borderledger.api

/**
 * Transport boundary for the Worker auth broker. HTTP/JSON wiring remains
 * behind this interface so session and UI security policy stay testable.
 */
interface OwnerLoginClient {
    suspend fun startLogin(input: OwnerLoginStartRequest): OwnerLoginStartResponse
    suspend fun exchangeCode(input: OwnerCodeExchangeRequest): OwnerTokenResponse
    suspend fun refresh(input: OwnerRefreshRequest): OwnerTokenResponse
    suspend fun logout(accessToken: String)
    suspend fun revoke(intent: RevocationIntent)
}

interface CapturePairingClient {
    /** Maps to startPairing + explicit owner approval + claimPairing. */
    suspend fun issueCaptureCredential(input: CapturePairingRequest): CaptureCredentialGrant
}

enum class CaptureApiHealth {
    OwnerSessionRequired,
    Checking,
    NotPaired,
    Ready,
    Offline,
    Unavailable,
    Revoked,
}

interface CaptureApi : CapturePairingClient {
    suspend fun health(): CaptureApiHealth
}

sealed class TransportFailure(message: String? = null) : Exception(message) {
    data object Offline : TransportFailure()
    data object Unauthorized : TransportFailure()
    data object Retryable : TransportFailure()
    data object StaleRevocation : TransportFailure()
    data object Unavailable : TransportFailure()
}

/** Fail-closed test double; production wiring uses the configured HTTP clients. */
class UnavailableMobileApi : OwnerLoginClient, CaptureApi {
    override suspend fun startLogin(input: OwnerLoginStartRequest): OwnerLoginStartResponse = throw TransportFailure.Retryable

    override suspend fun exchangeCode(input: OwnerCodeExchangeRequest): OwnerTokenResponse = throw TransportFailure.Retryable

    override suspend fun refresh(input: OwnerRefreshRequest): OwnerTokenResponse = throw TransportFailure.Retryable

    override suspend fun logout(accessToken: String) = throw TransportFailure.Offline

    override suspend fun revoke(intent: RevocationIntent) = throw TransportFailure.Offline

    override suspend fun issueCaptureCredential(input: CapturePairingRequest): CaptureCredentialGrant = throw TransportFailure.Retryable

    override suspend fun health() = CaptureApiHealth.Unavailable
}
