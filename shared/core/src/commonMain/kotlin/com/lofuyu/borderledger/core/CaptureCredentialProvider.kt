package com.lofuyu.borderledger.auth

data class CaptureCredentialRecord(
    val credential: String,
    val deviceId: String,
    val generation: Int,
    val expiresAt: String,
    val revocationCapability: String,
)

interface CaptureCredentialProvider {
    suspend fun current(): CaptureCredentialRecord?
    suspend fun save(value: CaptureCredentialRecord)
    suspend fun clear()
}
