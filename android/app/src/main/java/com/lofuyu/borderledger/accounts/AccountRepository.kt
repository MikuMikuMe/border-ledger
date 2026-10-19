package com.lofuyu.borderledger.accounts

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class BankAccount(
    val providerAccountId: String,
    val name: String,
    val mask: String?,
    val subtype: String?,
    val currency: String,
    val kind: String,
)

data class ConnectionOperation(
    val operationId: String,
    val state: String,
    val linkToken: String? = null,
    val pendingConnectionId: String? = null,
    val connectionId: String? = null,
    val institution: String? = null,
    val expiresAt: String? = null,
    val accounts: List<BankAccount> = emptyList(),
    val queued: Boolean = false,
    val cleanupState: String? = null,
)

data class AccountPage(
    val accounts: List<BankAccount>,
    val nextCursor: String?,
    val limit: Int,
)

data class ConnectionStatus(
    val connectionId: String,
    val institution: String?,
    val state: String,
    val expiresAt: String?,
    val cleanupState: String?,
    val lastSyncedAt: String?,
    val lastError: String?,
)

@JvmInline
value class ConnectionId(val value: String)

@JvmInline
value class ProviderAccountId(val value: String)

@JvmInline
value class ProviderPublicToken(val value: String)

@JvmInline
value class IdempotencyKey(val value: String)

@JvmInline
value class AccountCursor(val value: String)

data class LinkTokenRequest(val reconnectConnectionId: ConnectionId? = null)

data class ExchangeRequest(
    val publicToken: ProviderPublicToken,
    val idempotencyKey: IdempotencyKey,
    val reconnectConnectionId: ConnectionId? = null,
)

data class AccountSelectionRequest(
    val pendingConnectionId: ConnectionId,
    val accountIds: List<ProviderAccountId>,
    val idempotencyKey: IdempotencyKey,
)

data class PendingCancellationRequest(
    val pendingConnectionId: ConnectionId,
    val idempotencyKey: IdempotencyKey,
)

data class SyncRequest(val idempotencyKey: IdempotencyKey)

data class DisconnectRequest(
    val connectionId: ConnectionId,
    val idempotencyKey: IdempotencyKey,
)

data class AccountPageRequest(
    val cursor: AccountCursor? = null,
    val limit: Int = 50,
)

interface AccountConnectionGateway {
    suspend fun createLinkToken(request: LinkTokenRequest): ConnectionOperation
    suspend fun exchange(request: ExchangeRequest): ConnectionOperation
    suspend fun selectAccounts(request: AccountSelectionRequest): ConnectionOperation
    suspend fun cancelPending(request: PendingCancellationRequest)
    suspend fun sync(request: SyncRequest): ConnectionOperation
    suspend fun disconnect(request: DisconnectRequest)
    suspend fun listAccounts(request: AccountPageRequest): AccountPage
    suspend fun listConnections(): List<ConnectionStatus>
}

class AccountRepository(private val gateway: AccountConnectionGateway) {
    suspend fun createLinkToken(request: LinkTokenRequest = LinkTokenRequest()) = gateway.createLinkToken(request)
    suspend fun exchange(request: ExchangeRequest) = gateway.exchange(request)
    suspend fun selectAccounts(request: AccountSelectionRequest) = gateway.selectAccounts(request)
    suspend fun cancelPending(request: PendingCancellationRequest) = gateway.cancelPending(request)
    suspend fun sync(request: SyncRequest) = gateway.sync(request)
    suspend fun disconnect(request: DisconnectRequest) = gateway.disconnect(request)
    suspend fun listAccounts(request: AccountPageRequest = AccountPageRequest()) = gateway.listAccounts(request)
    suspend fun listConnections() = gateway.listConnections()
}

class HttpWorkerAccountConnectionGateway(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
    private val transport: AccountHttpTransport = UrlConnectionAccountHttpTransport(),
) : AccountConnectionGateway {
    private val interceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))
    private val decoder = AccountJsonDecoder()

    override suspend fun createLinkToken(request: LinkTokenRequest): ConnectionOperation {
        val suffix = request.reconnectConnectionId?.value?.let { connectionId ->
            "?mode=update&connectionId=${java.net.URLEncoder.encode(connectionId, "UTF-8")}"
        }.orEmpty()
        return decoder.connectionOperation(json(MobileRequest("POST", "$origin/api/mobile/v1/connections/link-tokens$suffix")))
    }

    override suspend fun exchange(request: ExchangeRequest): ConnectionOperation {
        val headers = mutableMapOf("Content-Type" to "application/json; charset=utf-8", "Idempotency-Key" to request.idempotencyKey.value)
        request.reconnectConnectionId?.value?.let { connectionId ->
            headers["X-Connection-Mode"] = "update"
            headers["X-Connection-Id"] = connectionId
        }
        return json(MobileRequest(
            "POST", "$origin/api/mobile/v1/connections/exchanges", headers,
            JSONObject().put("publicToken", request.publicToken.value).toString().toByteArray(StandardCharsets.UTF_8),
        )).let(decoder::connectionOperation)
    }

    override suspend fun selectAccounts(request: AccountSelectionRequest): ConnectionOperation =
        json(MobileRequest(
            "POST", "$origin/api/mobile/v1/connections/pending/${java.net.URLEncoder.encode(request.pendingConnectionId.value, "UTF-8")}/account-selection",
            mapOf("Content-Type" to "application/json; charset=utf-8", "Idempotency-Key" to request.idempotencyKey.value),
            JSONObject().put("accountIds", JSONArray(request.accountIds.map(ProviderAccountId::value))).toString().toByteArray(StandardCharsets.UTF_8),
        )).let(decoder::connectionOperation)

    override suspend fun cancelPending(request: PendingCancellationRequest) {
        request(MobileRequest("DELETE", "$origin/api/mobile/v1/connections/pending/${java.net.URLEncoder.encode(request.pendingConnectionId.value, "UTF-8")}", mapOf("Idempotency-Key" to request.idempotencyKey.value)))
    }

    override suspend fun sync(request: SyncRequest): ConnectionOperation =
        decoder.connectionOperation(json(MobileRequest("POST", "$origin/api/mobile/v1/connections/sync", mapOf("Idempotency-Key" to request.idempotencyKey.value))))

    override suspend fun disconnect(request: DisconnectRequest) {
        request(MobileRequest("DELETE", "$origin/api/mobile/v1/connections/${java.net.URLEncoder.encode(request.connectionId.value, "UTF-8")}", mapOf("Idempotency-Key" to request.idempotencyKey.value, "X-Confirm-Disconnect" to "true")))
    }

    override suspend fun listAccounts(request: AccountPageRequest): AccountPage {
        require(request.limit in 1..100)
        val query = buildString {
            append("?limit=").append(request.limit)
            request.cursor?.value?.let { cursor -> append("&cursor=").append(java.net.URLEncoder.encode(cursor, "UTF-8")) }
        }
        return decoder.accountPage(json(MobileRequest("GET", "$origin/api/mobile/v1/accounts$query")))
    }

    override suspend fun listConnections(): List<ConnectionStatus> = decoder.connectionStatuses(
        json(MobileRequest("GET", "$origin/api/mobile/v1/connections")).optJSONArray("connections"),
    )

    private suspend fun json(request: MobileRequest): JSONObject = JSONObject(request(request).toString(StandardCharsets.UTF_8))

    private suspend fun request(request: MobileRequest): ByteArray {
        val authenticated = interceptor.intercept(request)
        return transport.execute(authenticated)
    }
}

interface AccountHttpTransport {
    suspend fun execute(request: MobileRequest): ByteArray
}

/** A Worker-confirmed, non-retryable client rejection; carries no response text or secrets. */
internal class AccountRequestRejected(val statusCode: Int) : Exception()

internal class UrlConnectionAccountHttpTransport : AccountHttpTransport {
    override suspend fun execute(request: MobileRequest): ByteArray = withContext(Dispatchers.IO) {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                request.body?.let { body -> doOutput = true; setFixedLengthStreamingMode(body.size); outputStream.use { it.write(body) } }
            }
        } catch (_: IOException) { throw TransportFailure.Offline }
        try {
            val status = connection.responseCode
            if (status !in 200..299) throw classifyFailure(status, readSmallErrorBody(connection))
            if (status == 204) return@withContext ByteArray(0)
            connection.inputStream.use(::readResponseBody)
        } catch (error: TransportFailure) { throw error } catch (_: IOException) { throw TransportFailure.Offline } finally { connection.disconnect() }
    }

    private fun readSmallErrorBody(connection: HttpURLConnection): String? {
        val stream = connection.errorStream ?: return null
        return try {
            stream.use { input -> readAtMost(input, MAX_ERROR_BODY_BYTES)?.let { String(it, StandardCharsets.UTF_8) } }
        } catch (_: Exception) { null }
    }

    private fun readResponseBody(input: InputStream): ByteArray =
        readAtMost(input, MAX_RESPONSE_BODY_BYTES) ?: throw TransportFailure.Unavailable

    private fun readAtMost(input: InputStream, maxBytes: Int): ByteArray? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) return output.toByteArray()
            total += count
            if (total > maxBytes) return null
            output.write(buffer, 0, count)
        }
    }

    internal fun classifyFailure(status: Int, errorBody: String?): Exception =
        knownFailure(status) ?: definitiveClientFailure(status, errorBody) ?: TransportFailure.Retryable

    private fun knownFailure(status: Int): Exception? = terminalFailures[status]

    private fun definitiveClientFailure(status: Int, errorBody: String?): Exception? =
        AccountRequestRejected(status).takeIf { status in 400..499 && retryableFlag(errorBody) == false }

    private fun retryableFlag(errorBody: String?): Boolean? = errorBody?.let { body ->
        runCatching { JSONObject(body).opt("retryable") as? Boolean }.getOrNull()
    }

    private companion object {

        val terminalFailures = mapOf(
            HttpURLConnection.HTTP_UNAUTHORIZED to TransportFailure.Unauthorized,
            HttpURLConnection.HTTP_FORBIDDEN to TransportFailure.Unauthorized,
            HttpURLConnection.HTTP_NOT_FOUND to TransportFailure.Unavailable,
            HttpURLConnection.HTTP_NOT_IMPLEMENTED to TransportFailure.Unavailable,
        )

        const val MAX_ERROR_BODY_BYTES = 16 * 1024
        const val MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024
    }
}

private class AccountJsonDecoder {
    fun connectionOperation(value: JSONObject): ConnectionOperation = ConnectionOperation(
        operationId = value.getString("operationId"),
        state = value.getString("state"),
        linkToken = value.optString("linkToken").takeIf { it.isNotBlank() },
        pendingConnectionId = value.optString("pendingConnectionId").takeIf { it.isNotBlank() },
        connectionId = value.optString("connectionId").takeIf { it.isNotBlank() },
        institution = value.optString("institution").takeIf { it.isNotBlank() },
        expiresAt = value.optString("expiresAt").takeIf { it.isNotBlank() },
        accounts = bankAccounts(value.optJSONArray("accounts")),
        queued = value.optBoolean("queued", false),
        cleanupState = value.optString("cleanupState").takeIf { it.isNotBlank() },
    )

    fun accountPage(value: JSONObject): AccountPage = AccountPage(
        accounts = bankAccounts(value.optJSONArray("accounts")),
        nextCursor = value.optString("nextCursor").takeIf { it.isNotBlank() },
        limit = value.optInt("limit", 50),
    )

    fun bankAccounts(values: JSONArray?): List<BankAccount> = values?.let { array ->
        buildList(array.length()) {
            for (index in 0 until array.length()) {
                array.optJSONObject(index)?.let { addBankAccount(it) }
            }
        }
    } ?: emptyList()

    fun connectionStatuses(values: JSONArray?): List<ConnectionStatus> = values?.let { array ->
        buildList(array.length()) {
            for (index in 0 until array.length()) {
                array.optJSONObject(index)?.let { addConnectionStatus(it) }
            }
        }
    } ?: emptyList()

    private fun MutableList<BankAccount>.addBankAccount(value: JSONObject) {
        add(BankAccount(
            providerAccountId = value.optString("providerAccountId", value.optString("id")),
            name = value.optString("name"),
            mask = value.optString("mask").takeIf { it.isNotBlank() },
            subtype = value.optString("subtype").takeIf { it.isNotBlank() },
            currency = value.optString("currency", value.optString("defaultCurrency")),
            kind = value.optString("kind"),
        ))
    }

    private fun MutableList<ConnectionStatus>.addConnectionStatus(value: JSONObject) {
        add(ConnectionStatus(
            connectionId = value.optString("connectionId"),
            institution = value.optString("institution").takeIf { it.isNotBlank() },
            state = value.optString("state"),
            expiresAt = value.optString("expiresAt").takeIf { it.isNotBlank() },
            cleanupState = value.optString("cleanupState").takeIf { it.isNotBlank() },
            lastSyncedAt = value.optString("lastSyncedAt").takeIf { it.isNotBlank() },
            lastError = value.optString("lastError").takeIf { it.isNotBlank() },
        ))
    }
}
