package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.CaptureAuthInterceptor
import com.lofuyu.borderledger.auth.CaptureCredentialProvider
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.local.BankAlertEventCodec
import com.lofuyu.borderledger.capture.CaptureIntakeLimits
import com.lofuyu.borderledger.parser.BankAlertEventInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

data class CaptureUploadEvent(
    val eventId: String,
    val payload: ByteArray,
) {
    fun copyImmutable(): CaptureUploadEvent = copy(payload = payload.copyOf())
}

data class CaptureEventAcknowledgement(
    val eventId: String,
    val status: String,
    val projectionState: String?,
    val reasonCodes: List<String>,
    val receiptId: String? = null,
    val revision: Int? = null,
    val errorCode: String? = null,
)

sealed interface CaptureUploadResult {
    data class Success(val acknowledgements: List<CaptureEventAcknowledgement>) : CaptureUploadResult
    data class Retryable(val code: String, val retryAfterSeconds: Long?) : CaptureUploadResult
    data class PairingRequired(val code: String) : CaptureUploadResult
    data class Permanent(val eventIds: List<String>, val code: String) : CaptureUploadResult
}

interface CaptureUploadClient {
    suspend fun upload(batch: List<CaptureUploadEvent>): CaptureUploadResult
}

data class CaptureHttpResponse(
    val statusCode: Int,
    val body: ByteArray,
    val headers: Map<String, String> = emptyMap(),
)

interface CaptureHttpTransport {
    suspend fun execute(request: MobileRequest): CaptureHttpResponse
}

/** Bounded, allow-listed JSON for the Task 8 alert envelope. */
object CaptureUploadJson {
    fun encode(events: List<CaptureUploadEvent>): ByteArray {
        require(events.isNotEmpty() && events.size <= CaptureIntakeLimits.MAX_BATCH_EVENTS)
        val body = JSONObject().put("events", JSONArray().apply {
            events.forEach {
                val decoded = BankAlertEventCodec.decode(it.payload)
                require(decoded.eventId == it.eventId) { "Payload event identity does not match the outbox identity." }
                put(eventJson(decoded))
            }
        })
        return body.toString().toByteArray(StandardCharsets.UTF_8).also {
            require(it.size <= CaptureIntakeLimits.MAX_BATCH_BYTES) { "The alert envelope exceeds 128 KiB." }
        }
    }

    private fun eventJson(event: BankAlertEventInput): JSONObject = JSONObject()
        .put("schemaVersion", event.schemaVersion)
        .put("eventId", event.eventId)
        .put("observationId", event.observationId)
        .put("sourceProfileId", event.sourceProfileId)
        .put("parserVersion", event.parserVersion)
        .putNullable("notificationPostedAt", event.notificationPostedAt)
        .put("capturedAt", event.capturedAt)
        .put("eventTimeBasis", event.eventTimeBasis.wireValue)
        .put("eventType", event.eventType.wireValue)
        .put("direction", event.direction.wireValue)
        .putNullable("instrumentHint", event.instrumentHint?.let { hint ->
            JSONObject().put("kind", hint.kind.wireValue).put("value", hint.value)
        })
        .putNullable("eventMoney", event.eventMoney?.let { money ->
            JSONObject().put("currency", money.currency).put("amountMinor", money.amountMinor)
        })
        .putNullable("primaryMoneyRole", event.primaryMoneyRole?.wireValue)
        .put("amounts", JSONArray().apply {
            event.amounts.forEach { amount ->
                put(JSONObject()
                    .put("currency", amount.currency)
                    .put("amountMinor", amount.amountMinor)
                    .put("role", amount.role.wireValue))
            }
        })
        .put("feeTreatment", event.feeTreatment.wireValue)
        .putNullable("bankReference", event.bankReference)
        .putNullable("bankDisplayedTime", event.bankDisplayedTime?.let { time ->
            JSONObject()
                .putNullable("localDateTime", time.localDateTime)
                .putNullable("zone", time.zone)
                .put("precision", time.precision.wireValue)
                .put("yearProvenance", time.yearProvenance.wireValue)
        })
        .putNullable("merchant", event.merchant)
        .put("completeness", JSONObject()
            .put("individualTimestamp", event.completeness.individualTimestamp)
            .put("supportedSource", event.completeness.supportedSource)
            .put("labeledMoney", event.completeness.labeledMoney))

    private fun JSONObject.putNullable(name: String, value: Any?): JSONObject = put(name, value ?: JSONObject.NULL)
}

class HttpWorkerCaptureUploadClient(
    private val origin: String,
    private val environment: String,
    captureCredentials: CaptureCredentialProvider,
    private val transport: CaptureHttpTransport = UrlConnectionCaptureHttpTransport(),
) : CaptureUploadClient {
    private val interceptor = CaptureAuthInterceptor(
        provider = captureCredentials,
        environment = ApiEnvironment(origin, environment),
    )

    override suspend fun upload(batch: List<CaptureUploadEvent>): CaptureUploadResult {
        val ids = batch.map(CaptureUploadEvent::eventId)
        val body = try {
            CaptureUploadJson.encode(batch)
        } catch (_: Exception) {
            return CaptureUploadResult.Permanent(ids, "payload_invalid_or_too_large")
        }
        val request = try {
            interceptor.intercept(
                MobileRequest(
                    method = "POST",
                    url = "$origin/api/mobile/v1/alerts",
                    headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
                    body = body,
                ),
            )
        } catch (_: Exception) {
            return CaptureUploadResult.PairingRequired("capture_credential_required")
        }
        val response = try {
            transport.execute(request)
        } catch (_: IOException) {
            return CaptureUploadResult.Retryable("offline", null)
        } catch (_: Exception) {
            return CaptureUploadResult.Retryable("transport_failure", null)
        }
        return when (response.statusCode) {
            200 -> parseSuccess(response.body, ids)
            401, 403 -> CaptureUploadResult.PairingRequired("capture_credential_expired_or_revoked")
            409 -> CaptureUploadResult.Permanent(ids, "idempotency_conflict")
            429 -> CaptureUploadResult.Retryable("rate_limited", retryAfter(response.headers))
            in 500..599 -> CaptureUploadResult.Retryable("server_unavailable", retryAfter(response.headers))
            408 -> CaptureUploadResult.Retryable("request_timeout", retryAfter(response.headers))
            else -> CaptureUploadResult.Permanent(ids, "http_${response.statusCode}")
        }
    }

    private fun parseSuccess(body: ByteArray, batchIds: List<String>): CaptureUploadResult {
        return try {
            val root = JSONObject(body.toString(StandardCharsets.UTF_8))
            val acksJson = root.optJSONArray("acks") ?: throw IllegalArgumentException("Missing acks")
            if (acksJson.length() > batchIds.size) throw IllegalArgumentException("Too many acknowledgements")
            val seen = mutableSetOf<String>()
            val acks = buildList(acksJson.length()) {
                for (index in 0 until acksJson.length()) {
                    val ack = acksJson.optJSONObject(index) ?: throw IllegalArgumentException("Malformed acknowledgement")
                    val eventId = ack.optString("eventId", "")
                    val status = ack.optString("status", "")
                    if (eventId !in batchIds || !seen.add(eventId) || status !in setOf("accepted", "replayed", "rejected", "conflict")) {
                        throw IllegalArgumentException("Acknowledgement does not match the request")
                    }
                    val reasonCodes = ack.optJSONArray("reasonCodes")?.let { values ->
                        buildList(values.length()) { for (i in 0 until values.length()) add(values.optString(i, "")) }
                    } ?: emptyList()
                    add(CaptureEventAcknowledgement(
                        eventId = eventId,
                        status = status,
                        projectionState = ack.optString("projectionState", "").takeIf(String::isNotBlank),
                        reasonCodes = reasonCodes,
                        receiptId = ack.optString("receiptId", "").takeIf(String::isNotBlank),
                        revision = if (ack.has("revision") && !ack.isNull("revision")) ack.optInt("revision") else null,
                        errorCode = ack.optJSONObject("error")?.optString("code", "")?.takeIf(String::isNotBlank),
                    ))
                }
            }
            CaptureUploadResult.Success(acks)
        } catch (_: Exception) {
            CaptureUploadResult.Retryable("malformed_response", null)
        }
    }

    private fun retryAfter(headers: Map<String, String>): Long? = headers.entries
        .firstOrNull { it.key.equals("Retry-After", ignoreCase = true) }
        ?.value
        ?.trim()
        ?.toLongOrNull()
        ?.takeIf { it > 0L }
}

private class UrlConnectionCaptureHttpTransport : CaptureHttpTransport {
    override suspend fun execute(request: MobileRequest): CaptureHttpResponse = withContext(Dispatchers.IO) {
        val connection = (URL(request.url).openConnection() as HttpURLConnection).apply {
            requestMethod = request.method
            connectTimeout = NETWORK_TIMEOUT_MILLIS
            readTimeout = NETWORK_TIMEOUT_MILLIS
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-store")
            request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
            request.body?.let { body ->
                doOutput = true
                setFixedLengthStreamingMode(body.size)
            }
        }
        try {
            request.body?.let { body -> connection.outputStream.use { it.write(body) } }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }?.toByteArray(StandardCharsets.UTF_8) ?: ByteArray(0)
            CaptureHttpResponse(status, body, connection.headerFields.entries.filter { it.key != null }.associate { it.key!! to (it.value.firstOrNull() ?: "") })
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val NETWORK_TIMEOUT_MILLIS = 15_000
    }
}
