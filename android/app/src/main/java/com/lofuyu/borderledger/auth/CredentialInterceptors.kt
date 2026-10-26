package com.lofuyu.borderledger.auth

import android.net.Uri
import kotlin.coroutines.coroutineContext

data class ApiEnvironment(val canonicalOrigin: String, val environment: String) {
    init {
        val origin = Uri.parse(canonicalOrigin)
        require(origin.scheme == "https" && origin.host != null && origin.path.isNullOrEmpty())
    }

    fun accepts(url: String): Boolean {
        val actual = Uri.parse(url)
        val expected = Uri.parse(canonicalOrigin)
        return actual.scheme == "https" && actual.host == expected.host && actual.port == expected.port
    }
}

data class MobileRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: ByteArray? = null,
) {
    fun withBearer(token: String): MobileRequest = copy(headers = headers + mapOf("Authorization" to "Bearer $token", "X-Ledger-Protocol" to "2"))
}

class CredentialBoundaryException(message: String) : Exception(message)


class OwnerAuthInterceptor(
    private val provider: OwnerCredentialProvider,
    private val environment: ApiEnvironment,
) {
    suspend fun intercept(request: MobileRequest): MobileRequest {
        if (!environment.accepts(request.url)) throw CredentialBoundaryException("Owner requests must use the configured HTTPS origin.")
        val path = Uri.parse(request.url).path ?: "/"
        if (!isOwnerPath(path, request.method)) throw CredentialBoundaryException("The owner credential cannot access this route.")
        val expected = expectedBinding()
        val token = provider.accessTokenFor(expected) ?: throw CredentialBoundaryException("An active owner session is required.")
        return request.withBearer(token)
    }

    private suspend fun expectedBinding(): SessionBinding = coroutineContext[OwnerWork]?.binding ?: provider.currentBinding()
        ?: throw CredentialBoundaryException("Sign in again to bind this request.")

    private fun isOwnerPath(path: String, method: String): Boolean {
        if (!path.startsWith("/api/mobile/v1/")) return false
        if (path.startsWith("/api/mobile/v1/auth/") || path.startsWith("/api/mobile/v1/pairings")) return false
        if (path == "/api/mobile/v1/status" || path == "/api/mobile/v1/auth/revocations") return false
        if (path == "/api/mobile/v1/alerts" && method != "GET") return false
        return true
    }
}

class CaptureAuthInterceptor(
    private val provider: CaptureCredentialProvider,
    private val environment: ApiEnvironment,
) {
    suspend fun intercept(request: MobileRequest): MobileRequest {
        if (!environment.accepts(request.url)) throw CredentialBoundaryException("Capture requests must use the configured HTTPS origin.")
        if (!allowsCapture(request)) throw CredentialBoundaryException("The capture credential cannot access this route.")
        val expected = expectedCredential()
        val current = provider.current()
        if (!matchesCredential(current, expected)) throw CredentialBoundaryException("Capture session changed.")
        return request.withBearer(expected.credential)
    }
    private suspend fun expectedCredential(): CaptureCredentialRecord = coroutineContext[CaptureWork]?.credential
        ?: throw CredentialBoundaryException("Capture identity is required.")

    private fun allowsCapture(request: MobileRequest): Boolean = when (Uri.parse(request.url).path) {
        "/api/mobile/v1/status" -> request.method == "GET"
        "/api/mobile/v1/alerts" -> request.method == "POST"
        else -> false
    }
    private fun matchesCredential(current: CaptureCredentialRecord?, expected: CaptureCredentialRecord): Boolean =
        current == expected && expected.identity != null && expected.sessionEpoch != null

}
