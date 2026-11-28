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
    val limit=if(action=="ocr_scan") 6*1024*1024 else 16384
    require(body.toByteArray(Charsets.UTF_8).size <= limit)
    return when(action) {
        "settings" -> "GET" to ROOT
        "configuration", "sharing" -> "PUT" to "$ROOT/$action"
        "preview", "run", "receipt" -> "POST" to "$ROOT/$action"
        "ocr_settings" -> "GET" to "$ROOT/ocr/configuration"
        "ocr_configuration" -> "PUT" to "$ROOT/ocr/configuration"
        "ocr_remove" -> "DELETE" to "$ROOT/ocr/configuration"
        "ocr_scan" -> "POST" to "$ROOT/ocr/scan"
        "remove" -> {
            val provider=JSONObject(body).getString("provider")
            require(provider in setOf("openai","anthropic","deepseek"))
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
