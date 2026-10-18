package com.lofuyu.borderledger.accounts

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import java.io.ByteArrayOutputStream
import java.io.IOException
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

interface AccountConnectionGateway {
    suspend fun createLinkToken(reconnectConnectionId: String?): ConnectionOperation
    suspend fun exchange(publicToken: String, idempotencyKey: String, reconnectConnectionId: String?): ConnectionOperation
    suspend fun selectAccounts(pendingConnectionId: String, accountIds: List<String>, idempotencyKey: String): ConnectionOperation
    suspend fun cancelPending(pendingConnectionId: String, idempotencyKey: String)
    suspend fun sync(idempotencyKey: String): ConnectionOperation
    suspend fun disconnect(connectionId: String, idempotencyKey: String)
    suspend fun listAccounts(cursor: String? = null, limit: Int = 50): AccountPage
    suspend fun listConnections(): List<ConnectionStatus>
}

class AccountRepository(private val gateway: AccountConnectionGateway) {
    suspend fun createLinkToken(reconnectConnectionId: String? = null) = gateway.createLinkToken(reconnectConnectionId)
    suspend fun exchange(publicToken: String, idempotencyKey: String = UUID.randomUUID().toString(), reconnectConnectionId: String? = null) = gateway.exchange(publicToken, idempotencyKey, reconnectConnectionId)
    suspend fun selectAccounts(pendingConnectionId: String, accountIds: List<String>, idempotencyKey: String = UUID.randomUUID().toString()) = gateway.selectAccounts(pendingConnectionId, accountIds, idempotencyKey)
    suspend fun cancelPending(pendingConnectionId: String, idempotencyKey: String = "cancel:$pendingConnectionId") = gateway.cancelPending(pendingConnectionId, idempotencyKey)
    suspend fun sync(idempotencyKey: String = UUID.randomUUID().toString()) = gateway.sync(idempotencyKey)
    suspend fun disconnect(connectionId: String, idempotencyKey: String = "disconnect:$connectionId") = gateway.disconnect(connectionId, idempotencyKey)
    suspend fun listAccounts(cursor: String? = null, limit: Int = 50) = gateway.listAccounts(cursor, limit)
    suspend fun listConnections() = gateway.listConnections()
}

class HttpWorkerAccountConnectionGateway(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
    private val transport: AccountHttpTransport = UrlConnectionAccountHttpTransport(),
) : AccountConnectionGateway {
    private val interceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    override suspend fun createLinkToken(reconnectConnectionId: String?): ConnectionOperation {
        val suffix = reconnectConnectionId?.let { "?mode=update&connectionId=${java.net.URLEncoder.encode(it, "UTF-8")}" }.orEmpty()
        return json(MobileRequest("POST", "$origin/api/mobile/v1/connections/link-tokens$suffix")).toConnectionOperation()
    }

    override suspend fun exchange(publicToken: String, idempotencyKey: String, reconnectConnectionId: String?): ConnectionOperation {
        val headers = mutableMapOf("Content-Type" to "application/json; charset=utf-8", "Idempotency-Key" to idempotencyKey)
        reconnectConnectionId?.let { headers["X-Connection-Mode"] = "update"; headers["X-Connection-Id"] = it }
        return json(MobileRequest(
            "POST", "$origin/api/mobile/v1/connections/exchanges", headers,
            JSONObject().put("publicToken", publicToken).toString().toByteArray(StandardCharsets.UTF_8),
        )).toConnectionOperation()
    }

    override suspend fun selectAccounts(pendingConnectionId: String, accountIds: List<String>, idempotencyKey: String): ConnectionOperation =
        json(MobileRequest(
            "POST", "$origin/api/mobile/v1/connections/pending/${java.net.URLEncoder.encode(pendingConnectionId, "UTF-8")}/account-selection",
            mapOf("Content-Type" to "application/json; charset=utf-8", "Idempotency-Key" to idempotencyKey),
            JSONObject().put("accountIds", JSONArray(accountIds)).toString().toByteArray(StandardCharsets.UTF_8),
        )).toConnectionOperation()

    override suspend fun cancelPending(pendingConnectionId: String, idempotencyKey: String) {
        request(MobileRequest("DELETE", "$origin/api/mobile/v1/connections/pending/${java.net.URLEncoder.encode(pendingConnectionId, "UTF-8")}", mapOf("Idempotency-Key" to idempotencyKey)))
    }

    override suspend fun sync(idempotencyKey: String): ConnectionOperation =
        json(MobileRequest("POST", "$origin/api/mobile/v1/connections/sync", mapOf("Idempotency-Key" to idempotencyKey))).toConnectionOperation()

    override suspend fun disconnect(connectionId: String, idempotencyKey: String) {
        request(MobileRequest("DELETE", "$origin/api/mobile/v1/connections/${java.net.URLEncoder.encode(connectionId, "UTF-8")}", mapOf("Idempotency-Key" to idempotencyKey, "X-Confirm-Disconnect" to "true")))
    }

    override suspend fun listAccounts(cursor: String?, limit: Int): AccountPage {
        require(limit in 1..100)
        val query = buildString {
            append("?limit=").append(limit)
            cursor?.let { append("&cursor=").append(java.net.URLEncoder.encode(it, "UTF-8")) }
        }
        return json(MobileRequest("GET", "$origin/api/mobile/v1/accounts$query")).toAccountPage()
    }

    override suspend fun listConnections(): List<ConnectionStatus> = json(MobileRequest("GET", "$origin/api/mobile/v1/connections"))
        .optJSONArray("connections").toConnectionStatuses()

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

internal fun accountHttpFailure(status: Int, errorBody: String?): Exception {
    if(status==401 || status==403) return TransportFailure.Unauthorized
    val retryable=errorBody?.let { body ->
        runCatching { JSONObject(body).opt("retryable") as? Boolean }.getOrNull()
    }
    if(status in 400..499 && retryable==false) return AccountRequestRejected(status)
    return when(status) {
        404, 501 -> TransportFailure.Unavailable
        else -> TransportFailure.Retryable
    }
}

private class UrlConnectionAccountHttpTransport : AccountHttpTransport {
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
            if (status !in 200..299) throw accountHttpFailure(status, readSmallErrorBody(connection))
            if (status == 204) return@withContext ByteArray(0)
            val stream = connection.inputStream
            val output = ByteArrayOutputStream()
            stream.use { input ->
                val buffer = ByteArray(8 * 1024)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > 2 * 1024 * 1024) throw TransportFailure.Unavailable
                    output.write(buffer, 0, count)
                }
            }
            output.toByteArray()
        } catch (error: TransportFailure) { throw error } catch (_: IOException) { throw TransportFailure.Offline } finally { connection.disconnect() }
    }

    private fun readSmallErrorBody(connection: HttpURLConnection): String? {
        val stream=connection.errorStream ?: return null
        return try {
            stream.use { input ->
                val output=ByteArrayOutputStream()
                val buffer=ByteArray(2048)
                var total=0
                while(true) {
                    val count=input.read(buffer)
                    if(count<0) break
                    total+=count
                    if(total>MAX_ERROR_BODY_BYTES) return null
                    output.write(buffer,0,count)
                }
                output.toString(StandardCharsets.UTF_8.name())
            }
        } catch(_: Exception) { null }
    }

    private companion object { const val MAX_ERROR_BODY_BYTES=16*1024 }
}

private fun JSONObject.toConnectionOperation(): ConnectionOperation = ConnectionOperation(
    operationId = getString("operationId"),
    state = getString("state"),
    linkToken = optString("linkToken").takeIf { it.isNotBlank() },
    pendingConnectionId = optString("pendingConnectionId").takeIf { it.isNotBlank() },
    connectionId = optString("connectionId").takeIf { it.isNotBlank() },
    institution = optString("institution").takeIf { it.isNotBlank() },
    expiresAt = optString("expiresAt").takeIf { it.isNotBlank() },
    accounts = optJSONArray("accounts").toBankAccounts(),
    queued = optBoolean("queued", false),
    cleanupState = optString("cleanupState").takeIf { it.isNotBlank() },
)

private fun JSONObject.toAccountPage(): AccountPage = AccountPage(
    accounts = optJSONArray("accounts").toBankAccounts(),
    nextCursor = optString("nextCursor").takeIf { it.isNotBlank() },
    limit = optInt("limit", 50),
)

private fun JSONArray?.toBankAccounts(): List<BankAccount> = if (this == null) emptyList() else buildList(length()) {
    for (index in 0 until length()) {
        val value = optJSONObject(index) ?: continue
        add(BankAccount(
            providerAccountId = value.optString("providerAccountId", value.optString("id")),
            name = value.optString("name"),
            mask = value.optString("mask").takeIf { it.isNotBlank() },
            subtype = value.optString("subtype").takeIf { it.isNotBlank() },
            currency = value.optString("currency", value.optString("defaultCurrency")),
            kind = value.optString("kind"),
        ))
    }
}

private fun JSONArray?.toConnectionStatuses(): List<ConnectionStatus> = if (this == null) emptyList() else buildList(length()) {
    for (index in 0 until length()) {
        val value = optJSONObject(index) ?: continue
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
