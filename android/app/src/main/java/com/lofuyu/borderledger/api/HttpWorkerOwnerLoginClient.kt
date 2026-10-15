package com.lofuyu.borderledger.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Minimal owner-auth transport; full ledger/sync transports remain outside Task 5. */
class HttpWorkerOwnerLoginClient(
    private val origin: String,
    private val environment: String,
    private val callbackUrl: String,
    private val networkTimeoutMillis: Int = DEFAULT_NETWORK_TIMEOUT_MILLIS,
) : OwnerLoginClient {
    private val requestExecutor = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "border-ledger-http").apply { isDaemon = true }
    }

    override suspend fun startLogin(input: OwnerLoginStartRequest): OwnerLoginStartResponse {
        val body = JSONObject()
            .put("codeChallenge", input.codeChallenge)
            .put("state", input.state)
            .put("deviceId", input.deviceId)
            .put("environment", environment)
        val result = request("POST", "/api/mobile/v1/auth/requests", body = body)
            ?: throw TransportFailure.Retryable
        return OwnerLoginStartResponse(
            requestId = result.requiredString("requestId"),
            authorizationUrl = result.requiredString("authorizationUrl"),
            expiresAt = result.requiredString("expiresAt"),
        )
    }

    override suspend fun exchangeCode(input: OwnerCodeExchangeRequest): OwnerTokenResponse {
        val body = JSONObject()
            .put("requestId", input.requestId)
            .put("code", input.code)
            .put("verifier", input.verifier)
            .put("state", input.state)
            .put("deviceId", input.deviceId)
            .put("environment", environment)
            .put("callbackUrl", callbackUrl)
            .put("staySignedIn", input.staySignedIn)
        return parseTokenResponse(request("POST", "/api/mobile/v1/auth/exchanges", body = body, idempotencyKey = input.idempotencyKey))
    }

    override suspend fun refresh(input: OwnerRefreshRequest): OwnerTokenResponse = parseTokenResponse(
        request(
            method = "POST",
            path = "/api/mobile/v1/auth/refresh",
            bearer = input.refreshToken,
            idempotencyKey = input.idempotencyKey,
        ),
    )

    override suspend fun logout(accessToken: String) {
        request("POST", "/api/mobile/v1/auth/logout", bearer = accessToken)
    }

    override suspend fun revoke(intent: RevocationIntent) {
        request("POST", "/api/mobile/v1/auth/revocations", bearer = intent.capability)
    }

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        bearer: String? = null,
        idempotencyKey: String? = null,
    ): JSONObject? = runInterruptible(Dispatchers.IO) {
        val request = requestExecutor.submit<JSONObject?> {
            requestBlocking(method, path, body, bearer, idempotencyKey)
        }
        try {
            request.get(networkTimeoutMillis.toLong(), TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            request.cancel(true)
            throw TransportFailure.Offline
        } catch (error: ExecutionException) {
            throw error.cause ?: error
        } finally {
            request.cancel(true)
        }
    }

    private fun requestBlocking(
        method: String,
        path: String,
        body: JSONObject?,
        bearer: String?,
        idempotencyKey: String?,
    ): JSONObject? {
        val connection = try {
            (URL(origin.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = networkTimeoutMillis
                readTimeout = networkTimeoutMillis
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                if (bearer != null) setRequestProperty("Authorization", "Bearer $bearer")
                if (idempotencyKey != null) setRequestProperty("Idempotency-Key", idempotencyKey)
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                }
            }
        } catch (_: UnknownHostException) {
            throw TransportFailure.Offline
        } catch (_: IOException) {
            throw TransportFailure.Offline
        }
        return try {
            if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            if (code == HttpURLConnection.HTTP_NO_CONTENT) return null
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw when (code) {
                HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN -> TransportFailure.Unauthorized
                409 -> TransportFailure.StaleRevocation
                else -> TransportFailure.Retryable
            }
            if (responseText.isBlank()) null else JSONObject(responseText)
        } catch (error: TransportFailure) {
            throw error
        } catch (_: JSONException) {
            throw TransportFailure.Retryable
        } catch (_: UnknownHostException) {
            throw TransportFailure.Offline
        } catch (_: IOException) {
            throw TransportFailure.Offline
        } finally {
            connection.disconnect()
        }
    }

    private fun parseTokenResponse(json: JSONObject?): OwnerTokenResponse {
        val value = requireNotNull(json)
        val scopes = value.optJSONArray("scopes").toStringList()
        return OwnerTokenResponse(
            accessToken = value.requiredString("accessToken"),
            refreshToken = value.requiredString("refreshToken"),
            expiresAt = value.requiredString("expiresAt"),
            scopes = scopes,
            revision = value.optInt("revision", 0).also { require(it > 0) },
            revocationCapability = value.requiredString("revocationCapability"),
        )
    }

    private fun JSONObject.requiredString(name: String): String = optString(name, "").takeIf { it.isNotEmpty() }
        ?: throw TransportFailure.Retryable

    private fun JSONArray?.toStringList(): List<String> {
        if (this == null) return emptyList()
        return List(length()) { index -> optString(index, "") }.filter { it.isNotEmpty() }
    }

    private companion object {
        const val DEFAULT_NETWORK_TIMEOUT_MILLIS = 10_000
    }
}
