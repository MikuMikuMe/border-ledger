package com.lofuyu.borderledger.budget

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import org.json.JSONObject
import java.net.URLEncoder

private const val ROOT = "/api/mobile/v1/budget"
private val allowedWrites = setOf("settings", "allocations", "targets", "cash", "transfers", "mode", "tracking-plans", "tracking-copy", "rollover")
class BudgetRevisionConflict : Exception()
class BudgetRequestRejected : Exception()
internal fun budgetWritePath(action: String, body: String): String {
    require(body.toByteArray(Charsets.UTF_8).size <= 16384)
    if (action in allowedWrites) return "$ROOT/$action"
    require(action == "cash-delete")
    val id = JSONObject(body).getString("id")
    require(id.matches(Regex("[A-Za-z0-9_-]{1,128}")))
    return "$ROOT/cash/$id"
}
class HttpWorkerBudgetApi(
    private val origin: String,
    environment: String,
    credentials: OwnerCredentialProvider,
    private val transport: RecurringHttpTransport = BudgetHttpTransport(),
) {
    private val auth = OwnerAuthInterceptor(credentials, ApiEnvironment(origin, environment))
    suspend fun readSettings(): String = execute("GET", ROOT, null)
    suspend fun readView(month: String): String {
        BudgetMonth(month)
        return execute("GET", "$ROOT/view?month=$month", null)
    }
    suspend fun readModeView(request: BudgetModeViewRequest): String {
        return execute("GET", "$ROOT/view?month=${request.month.value}&mode=${request.mode}", null)
    }
    suspend fun readCopyPreview(month: BudgetMonth): String {
        return execute("GET", "$ROOT/tracking-copy?month=${month.value}", null)
    }
    suspend fun readRolloverPreview(request: BudgetRolloverRequest): String {
        val encoded = URLEncoder.encode(request.category, "UTF-8")
        return execute("GET", "$ROOT/rollover-preview?category=$encoded&effectiveMonth=${request.effectiveMonth.value}&policy=${request.policy}", null)
    }
    suspend fun write(command: BudgetWriteCommand): String {
        val (action, body) = command
        val path = budgetWritePath(action, body)
        JSONObject(body)
        val method = if (action == "cash-delete") "DELETE" else "PUT"
        return execute(method, path, if (method == "DELETE") null else body)
    }
    private suspend fun execute(method: String, path: String, body: String?): String {
        val request = MobileRequest(method, "$origin$path", headers = mapOf("Accept" to "application/json", "Content-Type" to "application/json; charset=utf-8"), body = body?.toByteArray(Charsets.UTF_8))
        val response = transport.execute(auth.intercept(request))
        if (response.status in 200..299) return response.body.toString(Charsets.UTF_8)
        throw when (response.status) {
            401, 403 -> TransportFailure.Unauthorized
            409 -> BudgetRevisionConflict()
            400, 404 -> BudgetRequestRejected()
            else -> TransportFailure.Retryable
        }
    }
}
