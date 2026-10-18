package com.lofuyu.borderledger.auth

import android.net.Uri
import android.util.Base64
import com.lofuyu.borderledger.api.OwnerLoginClient
import com.lofuyu.borderledger.core.CoreClock
import com.lofuyu.borderledger.core.CoreCrypto
import com.lofuyu.borderledger.local.LocalDataPolicy
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant

data class CallbackConfiguration(
    val scheme: String,
    val host: String,
    val path: String,
    val port: Int = -1,
) {
    init {
        require(scheme == "https")
        require(host.isNotBlank() && path.startsWith("/"))
    }

    val url: String get() = buildString {
        append("https://")
        append(host)
        if (port >= 0) append(":").append(port)
        append(path)
    }

    fun verify(uri: Uri): VerifiedCallback {
        if (uri.scheme != scheme || uri.host != host || uri.port != port || uri.path != path || uri.fragment != null) {
            throw CallbackValidationException
        }
        val names = uri.queryParameterNames
        if (names.any { it !in ALLOWED_PARAMETERS }) throw CallbackValidationException
        if (uri.getQueryParameters("state").size > 1 || uri.getQueryParameters("code").size > 1 || uri.getQueryParameters("error").size > 1) {
            throw CallbackValidationException
        }
        return VerifiedCallback(
            state = uri.getQueryParameter("state"),
            code = uri.getQueryParameter("code"),
            error = uri.getQueryParameter("error"),
        )
    }

    private companion object {
        val ALLOWED_PARAMETERS = setOf("state", "code", "error", "error_description")
    }
}


/** Android URI/crypto/time adapter; the common core owns session orchestration and state. */
class OwnerSessionManager(
    store: OwnerSessionStore,
    client: OwnerLoginClient,
    captureCredentials: CaptureCredentialProvider,
    localData: LocalDataPolicy,
    private val callbackConfiguration: CallbackConfiguration,
    environment: String = "sandbox",
    deviceId: String? = null,
    clock: () -> Instant = { Instant.now() },
    random: SecureRandom = SecureRandom(),
) : OwnerSessionCore(
    store, client, captureCredentials, localData, callbackConfiguration.url, environment, deviceId,
    AndroidSessionClock(clock), AndroidSessionCrypto(random),
) {
    suspend fun handleCallback(uri: Uri): CallbackResult = handleVerifiedCallback { callbackConfiguration.verify(uri) }
}

class AndroidSessionClock(private val clock: () -> Instant = { Instant.now() }) : CoreClock {
    override fun nowIso(): String = clock().toString()
    override fun isAfterNow(iso: String): Boolean = Instant.parse(iso).isAfter(clock())
}

class AndroidSessionCrypto(private val random: SecureRandom = SecureRandom()) : CoreCrypto {
    override fun randomToken(byteCount: Int): String = base64Url(ByteArray(byteCount).also(random::nextBytes))
    override fun sha256Hex(value: String): String = digest(value).joinToString("") { "%02x".format(it) }
    override fun pkceChallenge(verifier: String): String = base64Url(digest(verifier))
    private fun digest(value: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
    private fun base64Url(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
}
