package com.lofuyu.borderledger.api

import android.util.Base64
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.CaptureAuthInterceptor
import com.lofuyu.borderledger.auth.CaptureCredentialProvider
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Production capture boundary. The owner session authorizes the explicit
 * capture-authorization request; the capture secret is generated locally and
 * only its hash crosses the owner API boundary. Capture health uses the
 * separate narrow capture interceptor after a grant exists.
 */
class HttpWorkerCaptureApi(
    private val origin: String,
    private val environment: String,
    private val ownerCredentials: OwnerCredentialProvider,
    private val captureCredentials: CaptureCredentialProvider,
    private val random: SecureRandom = SecureRandom(),
) : CaptureApi {
    private val ownerInterceptor = OwnerAuthInterceptor(
        provider = ownerCredentials,
        environment = ApiEnvironment(origin, environment),
    )
    private val captureInterceptor = CaptureAuthInterceptor(
        provider = captureCredentials,
        environment = ApiEnvironment(origin, environment),
    )

    override suspend fun issueCaptureCredential(input: CapturePairingRequest): CaptureCredentialGrant {
        require(input.explicitConsent) { "Explicit capture consent is required." }
        require(input.sourceScopes.isNotEmpty()) { "At least one capture scope is required." }
        require(input.expectedRevision >= 0) { "The capture revision cannot be negative." }

        val credential = ByteArray(CREDENTIAL_BYTES).also(random::nextBytes).let(::base64Url)
        val credentialHash = sha256Hex(credential)
        val body = JSONObject()
            .put("credentialHash", credentialHash)
            .put("consent", true)
            .put(
                "sourceConfig",
                JSONObject()
                    .put("expectedRevision", input.expectedRevision)
                    .put("mappings", JSONArray().apply {
                        input.sourceScopes.forEach { scope ->
                            put(scope.toWorkerMappingJson())
                        }
                    }),
            )
        val request = ownerInterceptor.intercept(
            MobileRequest(
                method = "POST",
                url = "$origin/api/mobile/v1/devices/self/capture-authorization",
                headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
                body = body.toString().toByteArray(StandardCharsets.UTF_8),
            ),
        )
        val response = execute(request)
            ?: throw TransportFailure.Unavailable
        val deviceId = response.firstString("deviceId", "id") ?: throw TransportFailure.Retryable
        val expiresAt = response.firstString("credentialExpiresAt") ?: throw TransportFailure.Retryable
        val revocationCapability = response.firstString("revocationCapability") ?: throw TransportFailure.Unavailable
        return CaptureCredentialGrant(
            credential = credential,
            deviceId = deviceId,
            generation = response.optInt("generation", 1).also { require(it > 0) },
            expiresAt = expiresAt,
            revocationCapability = revocationCapability,
            identity = com.lofuyu.borderledger.auth.LedgerIdentity(
                requireNotNull(response.firstString("userId")), requireNotNull(response.firstString("ledgerId"))),
        )
    }

    override suspend fun health(): CaptureApiHealth {
        val boundary = com.lofuyu.borderledger.auth.CaptureWorkBoundary(captureCredentials, ownerCredentials::currentBinding)
        return boundary.run(CaptureApiHealth.Unavailable) { healthBound() }
    }
    private suspend fun healthBound(): CaptureApiHealth {
        val hasCredential = try {
            captureCredentials.current() != null
        } catch (_: Exception) {
            return CaptureApiHealth.Unavailable
        }
        if (!hasCredential) return CaptureApiHealth.NotPaired
        return try {
            val request = captureInterceptor.intercept(
                MobileRequest("GET", "$origin/api/mobile/v1/status"),
            )
            execute(request)
            CaptureApiHealth.Ready
        } catch (_: TransportFailure.Unauthorized) {
            CaptureApiHealth.Revoked
        } catch (_: TransportFailure.Offline) {
            CaptureApiHealth.Offline
        } catch (_: TransportFailure.Unavailable) {
            CaptureApiHealth.Unavailable
        } catch (_: Exception) {
            CaptureApiHealth.Unavailable
        }
    }

    private suspend fun execute(request: MobileRequest): JSONObject? = withContext(Dispatchers.IO) {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = NETWORK_TIMEOUT_MILLIS
                readTimeout = NETWORK_TIMEOUT_MILLIS
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                if (request.body != null) doOutput = true
            }
        } catch (_: IOException) {
            throw TransportFailure.Offline
        }
        try {
            request.body?.let { body -> connection.outputStream.use { it.write(body) } }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw when (code) {
                HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN -> TransportFailure.Unauthorized
                HttpURLConnection.HTTP_NOT_FOUND, HttpURLConnection.HTTP_NOT_IMPLEMENTED -> TransportFailure.Unavailable
                409 -> TransportFailure.StaleRevocation
                else -> TransportFailure.Retryable
            }
            if (responseText.isBlank()) null else JSONObject(responseText)
        } catch (error: TransportFailure) {
            throw error
        } catch (_: IOException) {
            throw TransportFailure.Offline
        } finally {
            connection.disconnect()
        }
    }

    private fun JSONObject.firstString(vararg names: String): String? = names
        .asSequence()
        .map { optString(it, "") }
        .firstOrNull { it.isNotBlank() }

    private fun sha256Hex(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

    private fun base64Url(bytes: ByteArray): String = Base64.encodeToString(
        bytes,
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )

    private companion object {
        const val CREDENTIAL_BYTES = 32
        const val NETWORK_TIMEOUT_MILLIS = 15_000
    }
}

internal fun CaptureScopeConsent.toWorkerMappingJson(): JSONObject = JSONObject()
    .put("sourceProfileId", sourceProfileId)
    .put("accountId", accountId)
    .put("allowedCurrencies", JSONArray().put(currency))
    .also { mapping ->
        instrumentHint?.let { hint ->
            mapping.put("instrumentHint", JSONObject()
                .put("kind", hint.kind)
                .put("value", hint.value))
        }
    }
