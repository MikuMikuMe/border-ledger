package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.budget.BudgetHttpTransport
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import org.json.JSONObject

class ManualTransactionApi(origin: String, environment: String, credentials: OwnerCredentialProvider, private val transport: RecurringHttpTransport = BudgetHttpTransport()) {
    private val root = "${origin.trimEnd('/')}/api/mobile/v1/transactions"
    private val auth = OwnerAuthInterceptor(credentials, ApiEnvironment(origin, environment))

    suspend fun matches(offset: Int): String {
        require(offset in 0..1_000_000)
        return request("GET", "$root/manual-matches?offset=$offset", null)
    }
    suspend fun write(action: String, body: String): String {
        require(body.toByteArray(Charsets.UTF_8).size <= 16384)
        JSONObject(body)
        val path = when (action) { "create" -> root; "match" -> "$root/manual-matches"; else -> throw IllegalArgumentException() }
        return request("POST", path, body)
    }
    private suspend fun request(method: String, url: String, body: String?): String {
        val request = MobileRequest(method, url, headers = mapOf("Accept" to "application/json", "Content-Type" to "application/json; charset=utf-8"), body = body?.toByteArray(Charsets.UTF_8))
        val response = transport.execute(auth.intercept(request))
        if (response.status in 200..299) return response.body.toString(Charsets.UTF_8)
        throw when (response.status) {
            401, 403 -> TransportFailure.Unauthorized
            400, 404 -> com.lofuyu.borderledger.budget.BudgetRequestRejected()
            409 -> com.lofuyu.borderledger.budget.BudgetRevisionConflict()
            else -> TransportFailure.Retryable
        }
    }
}
