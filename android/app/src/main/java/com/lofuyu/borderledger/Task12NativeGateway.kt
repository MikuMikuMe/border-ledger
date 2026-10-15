package com.lofuyu.borderledger

import android.net.Uri
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.exports.LedgerExportRequest
import com.lofuyu.borderledger.exports.OwnerLedgerExportGateway
import com.lofuyu.borderledger.exports.WorkerExportReceipt
import com.lofuyu.borderledger.imports.CancelImportRequest
import com.lofuyu.borderledger.imports.CommitImportRequest
import com.lofuyu.borderledger.imports.CreateImportPreviewRequest
import com.lofuyu.borderledger.imports.DecideImportDuplicateRequest
import com.lofuyu.borderledger.imports.ImportCommitResponse
import com.lofuyu.borderledger.imports.ImportDuplicateCandidate
import com.lofuyu.borderledger.imports.ImportPreview
import com.lofuyu.borderledger.imports.ImportRowError
import com.lofuyu.borderledger.imports.OwnerImportGateway
import com.lofuyu.borderledger.imports.OwnerImportRow
import com.lofuyu.borderledger.imports.StageImportChunkRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/** Owner-authenticated Task 12 transport used only by the native shell. */
internal class HttpWorkerImportGateway(
    origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
) : OwnerImportGateway {
    private val transport = OwnerTask12HttpTransport(origin, environment, ownerCredentials)

    override suspend fun createImportPreview(request: CreateImportPreviewRequest): ImportPreview =
        transport.json(
            MobileRequest(
                method = "POST",
                url = transport.url("/api/mobile/v1/imports/previews"),
                headers = idempotencyHeaders(request.idempotencyKey),
                body = Task12GatewayJson.createPreviewBody(request).toString().toByteArray(StandardCharsets.UTF_8),
            ),
        ).let(Task12GatewayJson::parseImportPreview)

    override suspend fun stageImportChunk(request: StageImportChunkRequest): ImportPreview =
        transport.json(
            MobileRequest(
                method = "PUT",
                url = transport.url("/api/mobile/v1/imports/${Uri.encode(request.previewId)}/chunks/${request.chunkIndex}"),
                headers = idempotencyHeaders(request.operationId),
                body = Task12GatewayJson.stageChunkBody(request).toString().toByteArray(StandardCharsets.UTF_8),
            ),
        ).let(Task12GatewayJson::parseImportPreview)

    override suspend fun commitImport(request: CommitImportRequest): ImportCommitResponse =
        transport.json(
            MobileRequest(
                method = "POST",
                url = transport.url("/api/mobile/v1/imports/${Uri.encode(request.previewId)}/commit"),
                headers = idempotencyHeaders(request.operationId),
                body = Task12GatewayJson.commitBody(request).toString().toByteArray(StandardCharsets.UTF_8),
            ),
        ).let(Task12GatewayJson::parseImportCommitResponse)

    override suspend fun decideDuplicate(request: DecideImportDuplicateRequest): ImportPreview =
        transport.json(
            MobileRequest(
                method = "PATCH",
                url = transport.url("/api/mobile/v1/imports/${Uri.encode(request.previewId)}/duplicates/${Uri.encode(request.candidateId)}"),
                headers = idempotencyHeaders(request.idempotencyKey),
                body = Task12GatewayJson.duplicateDecisionBody(request).toString().toByteArray(StandardCharsets.UTF_8),
            ),
        ).let(Task12GatewayJson::parseImportPreview)

    override suspend fun cancelImport(request: CancelImportRequest): ImportPreview =
        transport.json(
            MobileRequest(
                method = "DELETE",
                url = transport.url("/api/mobile/v1/imports/${Uri.encode(request.previewId)}"),
                headers = mapOf(
                    "Accept" to "application/json",
                    "Content-Type" to "application/json; charset=utf-8",
                ),
                body = Task12GatewayJson.cancelBody(request).toString().toByteArray(StandardCharsets.UTF_8),
            ),
        ).let(Task12GatewayJson::parseImportPreview)

    private fun idempotencyHeaders(value: String): Map<String, String> = mapOf(
        "Accept" to "application/json",
        "Content-Type" to "application/json; charset=utf-8",
        "Idempotency-Key" to value,
    )
}

/** Streams the existing Worker CSV endpoint; absent receipt headers stay absent. */
internal class HttpWorkerExportGateway(
    origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
) : OwnerLedgerExportGateway {
    private val transport = OwnerTask12HttpTransport(origin, environment, ownerCredentials)

    override suspend fun streamLedgerCsv(
        request: LedgerExportRequest,
        sink: suspend (ByteArray) -> Unit,
    ): WorkerExportReceipt? = transport.streamCsv(
        url = transport.url(Task12GatewayJson.exportPath(request)),
        sink = sink,
    )
}

/** Small response/JSON seam so the UI wiring can be tested without a live Worker. */
internal object Task12GatewayJson {
    fun createPreviewBody(request: CreateImportPreviewRequest): JSONObject = JSONObject()
        .put("accountId", request.accountId)
        .put("fileName", request.fileName)
        .put("fileSizeBytes", request.fileSizeBytes)
        .put("fileSha256", request.fileSha256)
        .put("format", request.format)
        .put("rowCount", request.rowCount)

    fun stageChunkBody(request: StageImportChunkRequest): JSONObject = JSONObject()
        .put("rowStart", request.rowStart)
        .put("rows", JSONArray().apply { request.rows.forEach { put(ownerRow(it)) } })

    fun commitBody(request: CommitImportRequest): JSONObject = JSONObject()
        .put("expectedRevision", request.expectedRevision)
        .put("rowIds", JSONArray().apply { request.rowIds.forEach { put(it) } })

    fun duplicateDecisionBody(request: DecideImportDuplicateRequest): JSONObject = JSONObject()
        .put("expectedRevision", request.expectedRevision)
        .put("decision", request.decision)

    fun cancelBody(request: CancelImportRequest): JSONObject = JSONObject()
        .put("expectedRevision", request.expectedRevision)

    fun parseImportPreview(value: JSONObject): ImportPreview = ImportPreview(
        id = value.requiredString("id"),
        revision = value.requiredInt("revision"),
        expiresAt = value.requiredString("expiresAt"),
        status = value.optString("state").takeIf(String::isNotBlank) ?: value.requiredString("status"),
        accountId = value.requiredString("accountId"),
        fileSha256 = value.requiredString("fileSha256"),
        rowCount = value.requiredInt("rowCount"),
        receivedRowCount = value.optInt("receivedRowCount", 0),
        validRowCount = value.optInt("validRowCount", 0),
        errors = value.optJSONArray("errors")?.let(::parseErrors).orEmpty(),
        duplicateCandidates = value.optJSONArray("duplicateCandidates")?.let(::parseDuplicates).orEmpty(),
        fileSizeBytes = value.optLong("fileSizeBytes", 0L),
    )

    fun parseImportCommitResponse(value: JSONObject): ImportCommitResponse = ImportCommitResponse(
        receiptId = value.optNullableString("receiptId"),
        importId = value.requiredString("importId"),
        publishedRows = value.requiredInt("publishedRows"),
        duplicateRows = value.requiredInt("duplicateRows"),
        needsReview = value.requiredInt("needsReview"),
        revision = value.requiredInt("revision"),
        committedAt = value.optNullableString("committedAt"),
        duplicateCandidates = value.optJSONArray("duplicateCandidates")?.let(::parseDuplicates).orEmpty(),
    )

    /** A missing header deliberately maps to null so the coordinator remains pending. */
    fun parseExportReceipt(receiptHeader: String?, exportedRowsHeader: String? = null): WorkerExportReceipt? {
        val receiptId = receiptHeader?.trim()?.takeIf(String::isNotEmpty) ?: return null
        val exportedRows = exportedRowsHeader?.trim()?.toIntOrNull()?.takeIf { it >= 0 } ?: return null
        return WorkerExportReceipt(receiptId, exportedRows)
    }

    fun exportPath(request: LedgerExportRequest): String = buildString {
        append("/api/mobile/v1/exports/transactions?selection=")
        append(Uri.encode(request.selection.wireValue))
        request.filters.currency?.let { append("&currency=").append(Uri.encode(it)) }
        request.filters.startDate?.let { append("&startDate=").append(Uri.encode(it)) }
        request.filters.endDate?.let { append("&endDate=").append(Uri.encode(it)) }
    }

    private fun ownerRow(row: OwnerImportRow): JSONObject = JSONObject()
        .put("rowId", row.rowId)
        .put("rowIndex", row.rowIndex)
        .put("accountId", row.accountId)
        .put("date", row.date)
        .put("merchant", row.merchant)
        .put("amountMinor", row.amountMinor)
        .put("currency", row.currency)
        .put("category", row.category)
        .put("kind", row.kind)
        .put("status", row.status)
        .put("source", row.source)
        .put("fingerprint", row.fingerprint)
        .putNullable("note", row.note)
        .putNullable("bankReference", row.bankReference)
        .putNullable("sourceIdentity", row.sourceIdentity?.let { identity ->
            JSONObject().putNullable("bankSourceId", identity.bankSourceId).putNullable("bankRowId", identity.bankRowId)
        })

    private fun parseErrors(values: JSONArray): List<ImportRowError> = buildList {
        for (index in 0 until values.length()) {
            val item = values.getJSONObject(index)
            add(ImportRowError(item.requiredString("code"), item.requiredString("message"), item.optNullableString("rowId")))
        }
    }

    private fun parseDuplicates(values: JSONArray): List<ImportDuplicateCandidate> = buildList {
        for (index in 0 until values.length()) {
            val item = values.getJSONObject(index)
            val reasons = item.optJSONArray("reasonCodes")?.let { codes ->
                buildList<String> {
                    for (reasonIndex in 0 until codes.length()) add(codes.getString(reasonIndex))
                }
            } ?: throw IllegalArgumentException("Missing Worker field: reasonCodes")
            add(
                ImportDuplicateCandidate(
                    id = item.requiredString("id"),
                    statementTransactionId = item.requiredString("statementTransactionId"),
                    candidateTransactionId = item.requiredString("candidateTransactionId"),
                    score = item.requiredInt("score"),
                    reasonCodes = reasons,
                    status = item.requiredString("status"),
                ),
            )
        }
    }

    private fun JSONObject.requiredString(name: String): String = optString(name, "").takeIf(String::isNotBlank)
        ?: throw IllegalArgumentException("Missing Worker field: $name")

    private fun JSONObject.requiredInt(name: String): Int = if (has(name) && !isNull(name)) getInt(name) else throw IllegalArgumentException("Missing Worker field: $name")

    private fun JSONObject.optNullableString(name: String): String? = if (!has(name) || isNull(name)) null else optString(name).takeIf(String::isNotBlank)

    private fun JSONObject.putNullable(name: String, value: Any?): JSONObject = put(name, value ?: JSONObject.NULL)
}

private class OwnerTask12HttpTransport(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
) {
    private val ownerInterceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    fun url(path: String): String = "$origin$path"

    suspend fun json(request: MobileRequest): JSONObject = withContext(Dispatchers.IO) {
        val response = execute(ownerInterceptor.intercept(request))
        if (response.body.isBlank()) throw TransportFailure.Unavailable
        JSONObject(response.body)
    }

    suspend fun streamCsv(url: String, sink: suspend (ByteArray) -> Unit): WorkerExportReceipt? = withContext(Dispatchers.IO) {
        val request = ownerInterceptor.intercept(MobileRequest("GET", url, headers = mapOf("Accept" to "text/csv")))
        val connection = open(request)
        try {
            checkResponse(connection)
            connection.inputStream.use { input ->
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count > 0) sink(buffer.copyOf(count))
                }
            }
            Task12GatewayJson.parseExportReceipt(
                connection.getHeaderField("X-Worker-Receipt-Id"),
                connection.getHeaderField("X-Worker-Exported-Rows"),
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun execute(request: MobileRequest): HttpResponse {
        val connection = open(request)
        try {
            request.body?.let { body -> connection.outputStream.use { it.write(body) } }
            checkResponse(connection)
            val body = connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use { it.readText() }
            return HttpResponse(body)
        } finally {
            connection.disconnect()
        }
    }

    private fun open(request: MobileRequest): HttpURLConnection = try {
        (URL(request.url).openConnection() as HttpURLConnection).apply {
            requestMethod = request.method
            connectTimeout = NETWORK_TIMEOUT_MILLIS
            readTimeout = NETWORK_TIMEOUT_MILLIS
            setRequestProperty("Cache-Control", "no-store")
            request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
            if (request.body != null) doOutput = true
        }
    } catch (_: IOException) {
        throw TransportFailure.Offline
    }

    private fun checkResponse(connection: HttpURLConnection) {
        val code = try {
            connection.responseCode
        } catch (_: IOException) {
            throw TransportFailure.Offline
        }
        if (code !in 200..299) throw when (code) {
            HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN -> TransportFailure.Unauthorized
            HttpURLConnection.HTTP_NOT_FOUND, HttpURLConnection.HTTP_NOT_IMPLEMENTED -> TransportFailure.Unavailable
            else -> TransportFailure.Retryable
        }
    }

    private data class HttpResponse(val body: String)

    private companion object {
        const val NETWORK_TIMEOUT_MILLIS = 15_000
    }
}
