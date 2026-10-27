package com.lofuyu.borderledger.api

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
    val userId: String? = null,
    val ledgerId: String? = null,
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
