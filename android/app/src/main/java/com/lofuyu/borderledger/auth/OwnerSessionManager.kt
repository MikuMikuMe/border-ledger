package com.lofuyu.borderledger.auth

import android.net.Uri
import android.util.Base64
import com.lofuyu.borderledger.api.OwnerLoginClient
import com.lofuyu.borderledger.core.CoreClock
import com.lofuyu.borderledger.core.CoreCrypto
import com.lofuyu.borderledger.local.LocalDataPolicy
import java.net.URLDecoder
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
        requireExpectedEndpoint(uri)
        val names = uri.queryParameterNames
        requireAllowedParameters(names)
        requireUniqueParameters(uri)
        return VerifiedCallback(
            state = uri.getQueryParameter("state"),
            code = uri.getQueryParameter("code"),
            error = uri.getQueryParameter("error"),
        )
    }

    private fun requireExpectedEndpoint(uri: Uri) {
        if (uri.scheme != scheme) rejectCallback()
        if (uri.host != host) rejectCallback()
        if (uri.port != port) rejectCallback()
        if (uri.path != path) rejectCallback()
        if (uri.fragment != null) rejectCallback()
    }

    private fun requireAllowedParameters(names: Set<String>) {
        if (!ALLOWED_PARAMETERS.containsAll(names)) rejectCallback()
    }

    private fun requireUniqueParameters(uri: Uri) {
        // Android's Uri query helpers collapse repeated names, so count names in the raw URI.
        val rawUri = uri.toString()
        val queryStart = rawUri.indexOf('?')
        if (queryStart < 0) return

        val names = rawUri.substring(queryStart + 1)
            .split('&')
            .map { parameter ->
                URLDecoder.decode(parameter.substringBefore('='), StandardCharsets.UTF_8.name())
            }
        if (names.size != names.toSet().size) rejectCallback()
    }

    private fun rejectCallback(): Nothing = throw CallbackValidationException

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
