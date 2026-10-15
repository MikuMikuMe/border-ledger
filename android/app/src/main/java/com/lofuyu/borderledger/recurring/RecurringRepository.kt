package com.lofuyu.borderledger.recurring

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class RecurringQuery(
    val cursor: String? = null,
    val limit: Int = 50,
    val currency: String? = null,
    val classification: String? = null,
)

data class RecurringSummaryQuery(val startDate: String, val endDate: String)

class RecurringRevisionConflict(val currentRevision: Int) : IOException("The recurring stream changed; refresh before saving.")

interface OwnerRecurringApi {
    suspend fun readPage(query: RecurringQuery = RecurringQuery()): RecurringPageDto
    suspend fun readSummary(query: RecurringSummaryQuery): RecurringSummaryDto
    suspend fun readDetail(id: String, cursor: String? = null, limit: Int = 50): RecurringDetailDto
    suspend fun classify(id: String, expectedRevision: Int, classification: String): RecurringClassificationAck
}

class RecurringRepository(private val api: OwnerRecurringApi) {
    suspend fun readPage(query: RecurringQuery = RecurringQuery()): RecurringPageDto = api.readPage(query)
    suspend fun readSummary(query: RecurringSummaryQuery): RecurringSummaryDto = api.readSummary(query)
    suspend fun readDetail(id: String, cursor: String? = null, limit: Int = 50): RecurringDetailDto = api.readDetail(id, cursor, limit)
    suspend fun classify(id: String, expectedRevision: Int, classification: String): RecurringClassificationAck = api.classify(id, expectedRevision, classification)
}

data class RecurringHttpResponse(val status: Int, val body: ByteArray)

fun interface RecurringHttpTransport {
    suspend fun execute(request: MobileRequest): RecurringHttpResponse
}

class HttpWorkerRecurringApi(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
    private val transport: RecurringHttpTransport = UrlConnectionRecurringHttpTransport(),
) : OwnerRecurringApi {
    private val ownerInterceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    override suspend fun readPage(query: RecurringQuery): RecurringPageDto = executeJson(
        "GET",
        path("/api/mobile/v1/recurring", buildMap {
            query.cursor?.let { put("cursor", it) }
            put("limit", query.limit.toString())
            query.currency?.let { put("currency", it) }
            query.classification?.let { put("classification", it) }
        }),
    ).let(RecurringJson::decodePage)

    override suspend fun readSummary(query: RecurringSummaryQuery): RecurringSummaryDto = executeJson(
        "GET",
        path("/api/mobile/v1/recurring/summary", mapOf("startDate" to query.startDate, "endDate" to query.endDate)),
    ).let(RecurringJson::decodeSummary)

    override suspend fun readDetail(id: String, cursor: String?, limit: Int): RecurringDetailDto = executeJson(
        "GET",
        path("/api/mobile/v1/recurring/${encode(id)}", buildMap {
            cursor?.let { put("cursor", it) }
            put("limit", limit.toString())
        }),
    ).let(RecurringJson::decodeDetail)

    override suspend fun classify(id: String, expectedRevision: Int, classification: String): RecurringClassificationAck {
        val response = execute(
            MobileRequest(
                method = "PATCH",
                url = "$origin/api/mobile/v1/recurring/${encode(id)}/classification",
                headers = mapOf("Accept" to "application/json", "Content-Type" to "application/json; charset=utf-8"),
                body = RecurringJson.classificationBody(expectedRevision, classification).toByteArray(StandardCharsets.UTF_8),
            ),
        )
        return RecurringJson.decodeClassificationAck(response)
    }

    private suspend fun executeJson(method: String, path: String): ByteArray = execute(
        MobileRequest(method, "$origin$path", headers = mapOf("Accept" to "application/json")),
    )

    private suspend fun execute(request: MobileRequest): ByteArray {
        val response = transport.execute(ownerInterceptor.intercept(request))
        if (response.status in 200..299) return response.body
        if (response.status == 409) {
            val current = runCatching { JSONObject(String(response.body, StandardCharsets.UTF_8)).optInt("currentRevision", -1) }.getOrDefault(-1)
            throw RecurringRevisionConflict(current.coerceAtLeast(0))
        }
        throw when (response.status) {
            401, 403 -> TransportFailure.Unauthorized
            404 -> TransportFailure.Unavailable
            else -> TransportFailure.Retryable
        }
    }

    private fun path(base: String, query: Map<String, String>): String = query.entries.joinToString("&", prefix = "$base?") { "${encode(it.key)}=${encode(it.value)}" }
    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
}

private class UrlConnectionRecurringHttpTransport : RecurringHttpTransport {
    override suspend fun execute(request: MobileRequest): RecurringHttpResponse = withContext(Dispatchers.IO) {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("Cache-Control", "no-store")
                request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                if (request.body != null) doOutput = true
            }
        } catch (_: IOException) {
            throw TransportFailure.Offline
        }
        try {
            request.body?.let { body -> connection.outputStream.use { it.write(body) } }
            val status = connection.responseCode
            val input = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = input?.use { stream ->
                val bytes = stream.readBytes()
                if (bytes.size > 512 * 1024) throw TransportFailure.Unavailable
                bytes
            } ?: ByteArray(0)
            RecurringHttpResponse(status, body)
        } catch (error: TransportFailure) {
            throw error
        } catch (_: IOException) {
            throw TransportFailure.Offline
        } finally {
            connection.disconnect()
        }
    }
}
