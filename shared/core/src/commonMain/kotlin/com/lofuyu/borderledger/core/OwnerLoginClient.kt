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
