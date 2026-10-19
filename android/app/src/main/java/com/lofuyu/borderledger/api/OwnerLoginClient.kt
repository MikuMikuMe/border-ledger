package com.lofuyu.borderledger.api


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
