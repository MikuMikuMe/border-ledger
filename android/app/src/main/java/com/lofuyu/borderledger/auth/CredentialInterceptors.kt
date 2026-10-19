package com.lofuyu.borderledger.auth

import android.net.Uri

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
    fun withBearer(token: String): MobileRequest = copy(headers = headers + ("Authorization" to "Bearer $token"))
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
        val token = provider.accessToken() ?: throw CredentialBoundaryException("An active owner session is required.")
        return request.withBearer(token)
    }

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
        val path = Uri.parse(request.url).path ?: "/"
        val allowed = (path == "/api/mobile/v1/status" && request.method == "GET") ||
            (path == "/api/mobile/v1/alerts" && request.method == "POST")
        if (!allowed) throw CredentialBoundaryException("The capture credential cannot access this route.")
        val token = provider.current()?.credential ?: throw CredentialBoundaryException("Capture access is not paired.")
        return request.withBearer(token)
    }
}
