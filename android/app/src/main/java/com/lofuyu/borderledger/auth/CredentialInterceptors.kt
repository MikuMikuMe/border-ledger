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

@JvmInline
private value class RequestPath(val value: String)

private enum class KnownMethod(val wireValue: String) { GET("GET"), POST("POST") }

@JvmInline
private value class RequestMethod(val value: String) {
    fun matches(method: KnownMethod): Boolean = value == method.wireValue
}

private data class RequestTarget(val path: RequestPath, val method: RequestMethod) {
    companion object {
        fun from(request: MobileRequest): RequestTarget = RequestTarget(
            path = RequestPath(Uri.parse(request.url).path ?: "/"),
            method = RequestMethod(request.method),
        )
    }
}


class OwnerAuthInterceptor(
    private val provider: OwnerCredentialProvider,
    private val environment: ApiEnvironment,
) {
    suspend fun intercept(request: MobileRequest): MobileRequest {
        val target = RequestTarget.from(request)
        if (!environment.accepts(request.url)) throw CredentialBoundaryException("Owner requests must use the configured HTTPS origin.")
        if (!isOwnerPath(target)) throw CredentialBoundaryException("The owner credential cannot access this route.")
        val expected = expectedBinding()
        val token = provider.accessTokenFor(expected) ?: throw CredentialBoundaryException("An active owner session is required.")
        return request.withBearer(token)
    }

    private suspend fun expectedBinding(): SessionBinding = coroutineContext[OwnerWork]?.binding ?: provider.currentBinding()
        ?: throw CredentialBoundaryException("Sign in again to bind this request.")

    private fun isOwnerPath(target: RequestTarget): Boolean {
        if (isWealthPath(target.path)) return true
        if (!target.path.value.startsWith("/api/mobile/v1/")) return false
        return isVersionedOwnerPath(target)
    }

    private fun isWealthPath(path: RequestPath): Boolean = path.value == "/api/mobile/owner/wealth" || path.value.startsWith("/api/mobile/owner/wealth/")

    private fun isVersionedOwnerPath(target: RequestTarget): Boolean {
        val path = target.path.value
        if (path.startsWith("/api/mobile/v1/auth/")) return false
        if (path.startsWith("/api/mobile/v1/pairings")) return false
        if (path == "/api/mobile/v1/status" || path == "/api/mobile/v1/auth/revocations") return false
        if (path != "/api/mobile/v1/alerts") return true
        return target.method.matches(KnownMethod.GET)
    }
}

class CaptureAuthInterceptor(
    private val provider: CaptureCredentialProvider,
    private val environment: ApiEnvironment,
) {
    suspend fun intercept(request: MobileRequest): MobileRequest {
        val target = RequestTarget.from(request)
        if (!environment.accepts(request.url)) throw CredentialBoundaryException("Capture requests must use the configured HTTPS origin.")
        if (!allowsCapture(target)) throw CredentialBoundaryException("The capture credential cannot access this route.")
        val expected = expectedCredential()
        val current = provider.current()
        if (!matchesCredential(current, expected)) throw CredentialBoundaryException("Capture session changed.")
        return request.withBearer(expected.credential)
    }
    private suspend fun expectedCredential(): CaptureCredentialRecord = coroutineContext[CaptureWork]?.credential
        ?: throw CredentialBoundaryException("Capture identity is required.")

    private fun allowsCapture(target: RequestTarget): Boolean = when (target.path.value) {
        "/api/mobile/v1/status" -> target.method.matches(KnownMethod.GET)
        "/api/mobile/v1/alerts" -> target.method.matches(KnownMethod.POST)
        else -> false
    }
    private fun matchesCredential(current: CaptureCredentialRecord?, expected: CaptureCredentialRecord): Boolean =
        current == expected && expected.identity != null && expected.sessionEpoch != null

}
