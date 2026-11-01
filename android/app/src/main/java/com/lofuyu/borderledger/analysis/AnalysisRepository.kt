package com.lofuyu.borderledger.analysis
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.budget.BudgetHttpTransport
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import org.json.JSONObject
class AnalysisFailure(val code:String):Exception()
private const val ROOT = "/api/mobile/v1/analysis"
internal fun analysisRoute(action:String, body:String):Pair<String,String> {
    require(body.toByteArray(Charsets.UTF_8).size <= 16384)
    return when(action) {
        "settings" -> "GET" to ROOT
        "configuration", "sharing" -> "PUT" to "$ROOT/$action"
        "preview", "run" -> "POST" to "$ROOT/$action"
        "remove" -> {
            val provider=JSONObject(body).getString("provider")
            require(provider in setOf("openai","anthropic"))
            "DELETE" to "$ROOT/configuration/$provider"
        }
        else -> throw IllegalArgumentException("Invalid analysis action")
    }
}
class HttpWorkerAnalysisApi(private val origin:String, environment:String, credentials:OwnerCredentialProvider,
    private val transport:RecurringHttpTransport=BudgetHttpTransport(readTimeoutMillis=40_000)) {
    private val auth=OwnerAuthInterceptor(credentials,ApiEnvironment(origin,environment))
    suspend fun execute(action:String,body:String):String {
        val (method,path)=analysisRoute(action,body)
        if(method=="PUT" || method=="POST") JSONObject(body)
        val payload=if(method=="PUT" || method=="POST") body.toByteArray(Charsets.UTF_8) else null
        val request=MobileRequest(method,"$origin$path",headers=mapOf("Accept" to "application/json","Content-Type" to "application/json; charset=utf-8"),body=payload)
        val response=transport.execute(auth.intercept(request))
        if(response.status in 200..299) return response.body.toString(Charsets.UTF_8)
        throw when(response.status) {401,403 -> TransportFailure.Unauthorized; 422 -> AnalysisFailure("provider_authentication"); 429 -> AnalysisFailure("provider_rate_limit"); 400,404,409 -> TransportFailure.Unavailable; else -> TransportFailure.Retryable}
    }
}
