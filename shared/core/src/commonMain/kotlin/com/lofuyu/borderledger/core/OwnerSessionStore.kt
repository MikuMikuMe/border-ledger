package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.local.RevocationQueue

data class OwnerSessionRecord(
    val accessToken: String,
    val refreshToken: String,
    val expiresAt: String,
    val scopes: List<String>,
    val revision: Int,
    val revocationCapability: String,
    val deviceId: String?,
    val pendingDestination: String? = null,
)

data class PendingOwnerLogin(
    val requestId: String,
    val state: String,
    val verifier: String,
    val idempotencyKey: String,
    val deviceId: String?,
    val callbackUrl: String,
    val environment: String,
    val staySignedIn: Boolean,
    val expiresAt: String,
    val pendingDestination: String?,
)

data class PendingOwnerRotation(
    val idempotencyKey: String,
    val startedAt: String,
)

data class CompletedCallbackMarker(
    val stateDigest: String,
    val completedAt: String,
)

interface OwnerSessionStore : RevocationQueue {
    suspend fun readSession(): OwnerSessionRecord?
    suspend fun writeSession(value: OwnerSessionRecord)
    suspend fun clearSession()
    suspend fun readPendingLogin(): PendingOwnerLogin?
    suspend fun writePendingLogin(value: PendingOwnerLogin)
    suspend fun clearPendingLogin()
    suspend fun readPendingRotation(): PendingOwnerRotation?
    suspend fun writePendingRotation(value: PendingOwnerRotation)
    suspend fun clearPendingRotation()
    suspend fun readCompletedCallback(): CompletedCallbackMarker?
    suspend fun writeCompletedCallback(value: CompletedCallbackMarker)
}
