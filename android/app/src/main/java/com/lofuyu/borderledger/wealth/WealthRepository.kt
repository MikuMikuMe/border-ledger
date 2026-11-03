package com.lofuyu.borderledger.wealth

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import org.json.JSONObject
import java.net.URLEncoder

internal const val WEALTH_ROOT = "/api/mobile/owner/wealth"

/** The only owner scopes a Wealth request may require. */
object WealthScopeRegistry {
    const val READ = "wealth:read"
    const val WRITE = "wealth:write"
    val all = setOf(READ, WRITE)
    fun forMethod(method: String): String = if (method.equals("GET", ignoreCase = true)) READ else WRITE
}

data class WealthReadQuery(
    val view: String? = null,
    val accountId: String? = null,
    val exchange: String? = null,
    val ticker: String? = null,
    val asOf: String? = null,
    val periodStart: String? = null,
    val periodEnd: String? = null,
) {
    init {
        require(view == null || view in setOf("overview", "investments", "cash-flow", "csv-template"))
        listOf(accountId, exchange, ticker).filterNotNull().forEach { require(it.matches(IDENTIFIER)) }
        listOf(asOf, periodStart, periodEnd).filterNotNull().forEach { require(it.matches(DATE_OR_INSTANT)) }
    }

    fun queryString(): String = listOf(
        "view" to view, "accountId" to accountId, "exchange" to exchange, "ticker" to ticker,
        "asOf" to asOf, "from" to periodStart, "to" to periodEnd,
    ).filter { it.second != null }.joinToString("&") { (key, value) -> "$key=${URLEncoder.encode(value, "UTF-8")}" }

    private companion object {
        val IDENTIFIER = Regex("[A-Za-z0-9_.:-]{1,128}")
        val DATE_OR_INSTANT = Regex("[0-9T:Z+\\-.]{4,40}")
    }
}

data class WealthWriteCommand(val operationId: String, val action: String, val payload: String) {
    init {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(action in ALLOWED_ACTIONS)
        require(payload.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES)
        JSONObject(payload)
    }

    fun body(): String = JSONObject().put("operationId", operationId).put("action", action).put("payload", JSONObject(payload)).toString()

    private companion object {
        const val MAX_PAYLOAD_BYTES = 256 * 1024
        val ALLOWED_ACTIONS = setOf("account", "instrument", "valuation", "event", "correction", "reversal", "quote-save", "quote-remove", "quote-refresh", "csv-preview", "csv-commit", "csv-export")
    }
}

class WealthRevisionConflict(val reason: String? = null) : Exception(reason)
class WealthRequestRejected(val reason: String? = null) : Exception(reason)
/** A restored owner token may predate the Wealth scopes; re-auth is required. */
class WealthAuthorizationRequired : Exception()

class HttpWorkerWealthApi(
    private val origin: String,
    environment: String,
    credentials: OwnerCredentialProvider,
    private val transport: WealthHttpTransport = UrlWealthHttpTransport(),
) {
    private val auth = OwnerAuthInterceptor(credentials, ApiEnvironment(origin, environment))

    suspend fun readSnapshot(query: WealthReadQuery = WealthReadQuery()): String {
        val suffix = query.queryString().takeIf { it.isNotEmpty() }?.let { "?$it" } ?: ""
        // The report response carries the same snapshot plus dated history and
        // Modified Dietz inputs. Every mobile view therefore stays on the
        // server-authoritative report route instead of inventing returns from
        // a snapshot-only payload.
        val path = "$WEALTH_ROOT/report"
        return execute("GET", path + suffix, null)
    }

    suspend fun readEvents(accountId: String? = null): String {
        val suffix = WealthReadQuery(accountId = accountId).queryString().takeIf { it.isNotEmpty() }?.let { "?$it" } ?: ""
        return execute("GET", "$WEALTH_ROOT/events$suffix", null)
    }

    suspend fun readValuations(accountId: String? = null): String {
        val suffix = WealthReadQuery(accountId = accountId).queryString().takeIf { it.isNotEmpty() }?.let { "?$it" } ?: ""
        return execute("GET", "$WEALTH_ROOT/valuations$suffix", null)
    }

    suspend fun readQuoteSettings(): String = execute("GET", "$WEALTH_ROOT/quotes/settings", null)

    suspend fun readTemplate(): String = execute("GET", "$WEALTH_ROOT/template", null)

    suspend fun exportCsv(): String = execute("GET", "$WEALTH_ROOT/export", null)

    suspend fun write(command: WealthWriteCommand): String {
        val payload = JSONObject(command.payload)
        val route = routeFor(command.action, payload)
        val body = bodyFor(command, payload)
        val method = methodFor(command.action)
        val routeWithQuery = quoteRemoveRoute(command.action, route, payload)
        return execute(method, routeWithQuery, if (method == "DELETE") null else body)
    }

    private fun routeFor(action: String, payload: JSONObject): String = when (action) {
        "account" -> "$WEALTH_ROOT/accounts"
        "instrument" -> "$WEALTH_ROOT/instruments"
        "valuation" -> "$WEALTH_ROOT/valuations"
        "event", "correction", "reversal" -> "$WEALTH_ROOT/events"
        "csv-preview" -> "$WEALTH_ROOT/imports/preview"
        "csv-commit" -> "$WEALTH_ROOT/imports/${requireNotNull(payload.optString("previewId").takeIf { it.isNotBlank() })}/commit"
        "quote-save", "quote-remove" -> "$WEALTH_ROOT/quotes/settings"
        "quote-refresh" -> "$WEALTH_ROOT/quotes/refresh"
        else -> throw WealthRequestRejected()
    }

    private fun bodyFor(command: WealthWriteCommand, payload: JSONObject): String = when (command.action) {
        "event", "correction", "reversal" -> eventBody(command, payload)
        else -> payload.put("operationId", command.operationId).toString()
    }

    private fun eventBody(command: WealthWriteCommand, payload: JSONObject): String {
        // Event routes read expectedRevision from the envelope, while the
        // typed mobile editor keeps it beside the event draft. Lift it without
        // allowing a user-entered source identity to cross the native boundary.
        val expectedRevision = payload.opt("expectedRevision")
        payload.remove("expectedRevision")
        return JSONObject().put("operationId", command.operationId).apply {
            if (expectedRevision != null && expectedRevision != JSONObject.NULL) put("expectedRevision", expectedRevision)
            put("event", payload)
        }.toString()
    }

    private fun methodFor(action: String): String = when (action) {
        "account", "instrument", "valuation", "quote-save" -> "PUT"
        "quote-remove" -> "DELETE"
        else -> "POST"
    }

    private fun quoteRemoveRoute(action: String, route: String, payload: JSONObject): String {
        if (action != "quote-remove") return route
        val provider = URLEncoder.encode(payload.optString("provider", "alpha_vantage"), "UTF-8")
        return "$route?provider=$provider"
    }

    private suspend fun execute(method: String, path: String, body: String?): String {
        val request = MobileRequest(method, "$origin$path", headers = mapOf("Accept" to "application/json", "Content-Type" to "application/json; charset=utf-8"), body = body?.toByteArray(Charsets.UTF_8))
        val response = transport.execute(auth.intercept(request))
        if (response.statusCode in 200..299) return response.body
        val serverReason = responseReason(response.body)
        throw when (response.statusCode) {
            401, 403 -> WealthAuthorizationRequired()
            409 -> WealthRevisionConflict(serverReason ?: CONFLICT_REASON)
            400, 404 -> WealthRequestRejected(serverReason ?: REJECTED_REASON)
            else -> TransportFailure.Retryable
        }
    }

    private fun responseReason(body: String): String? {
        val value = runCatching { JSONObject(body) }.getOrNull() ?: return null
        val message = value.optString("message").trim().takeIf { it.isNotEmpty() }
        val reason = value.optString("reason").trim().takeIf { it.isNotEmpty() }
        val code = value.optString("code").trim().takeIf { it.isNotEmpty() }
        return (message ?: reason ?: code?.replace('_', ' '))?.take(MAX_REASON_LENGTH)
    }

    private companion object {
        const val MAX_REASON_LENGTH = 512
        const val CONFLICT_REASON = "Wealth data changed on the server. Refresh before saving."
        const val REJECTED_REASON = "The server rejected this Wealth request. Review the fields and try again."
    }
}
