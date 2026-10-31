package com.lofuyu.borderledger.recurring

import java.io.IOException
import com.lofuyu.borderledger.api.TransportFailure

import org.json.JSONObject
private const val MAX_SAFE_INTEGER = 9007199254740991L

data class RecurringPlanDto(val id: String, val accountId: String, val currency: String, val merchant: String, val direction: String, val amountMinor: Long, val frequency: String, val startDate: String, val endDate: String?, val enabled: Boolean, val revision: Int)
data class PlanCandidateDto(val id:String,val date:String,val merchant:String,val amountMinor:Long,val currency:String,val status:String)
data class PlanOccurrenceDto(val planId: String, val date: String, val status: String, val candidateIds: List<String>, val candidateCount: Int, val candidateDetails: List<PlanCandidateDto>)
data class RecurringPlanInput(val accountId: String, val currency: String, val merchant: String, val direction: String, val amountMinor: Long, val frequency: String, val startDate: String, val endDate: String?, val enabled: Boolean)
object RecurringPlanJson {
    private val statuses = setOf("expected", "matched", "pending", "ambiguous", "potentially_missing", "not_assessable")
    fun decodePlans(bytes: ByteArray): List<RecurringPlanDto> {
        val values = JSONObject(bytes.decodeToString()).getJSONArray("plans")
        require(values.length() <= 200)
        return (0 until values.length()).map { plan(values.getJSONObject(it)) }
    }
    fun decodePlan(bytes: ByteArray): RecurringPlanDto = plan(JSONObject(bytes.decodeToString()))
    private fun plan(v: JSONObject): RecurringPlanDto {
        val amount = v.getLong("amountMinor").also { require(it in 1..MAX_SAFE_INTEGER) }
        val currency = v.getString("currency").also { require(RecurringCurrencyPolicy.isSupported(it)) }
        val direction = v.getString("direction").also { require(it in setOf("expense", "income")) }
        val frequency = v.getString("frequency").also { require(it in setOf("weekly", "biweekly", "monthly", "yearly")) }
        val revision = v.getInt("revision").also { require(it >= 0) }
        return RecurringPlanDto(v.getString("id"), v.getString("accountId"), currency, v.getString("merchant"), direction, amount, frequency, v.getString("startDate"), if(v.isNull("endDate")) null else v.getString("endDate"), v.getBoolean("enabled"), revision)
    }
    fun decodeOccurrences(bytes: ByteArray): List<PlanOccurrenceDto> {
        val values = JSONObject(bytes.decodeToString()).getJSONArray("occurrences")
        require(values.length() <= 6000)
        return (0 until values.length()).map { index ->
            val v = values.getJSONObject(index)
            val status = v.getString("status").also { require(it in statuses) }
            val ids = v.getJSONArray("candidateIds"); require(ids.length() <= 10000)
            val details=v.getJSONArray("candidateDetails"); require(details.length() <= 2)
            val candidates=(0 until details.length()).map { i -> val c=details.getJSONObject(i); PlanCandidateDto(c.getString("id"),c.getString("date"),c.getString("merchant"),c.getLong("amountMinor"),c.getString("currency"),c.getString("status")) }
            PlanOccurrenceDto(v.getString("planId"), v.getString("date"), status, (0 until ids.length()).map(ids::getString), v.getInt("candidateCount").also { require(it >= ids.length()) }, candidates)
        }
    }
    fun body(input: RecurringPlanInput): JSONObject {
        require(input.amountMinor in 1..MAX_SAFE_INTEGER)
        return JSONObject().put("accountId", input.accountId).put("currency", input.currency).put("merchant", input.merchant)
            .put("direction", input.direction).put("amountMinor", input.amountMinor).put("frequency", input.frequency)
            .put("startDate", input.startDate).put("endDate", input.endDate ?: JSONObject.NULL).put("enabled", input.enabled)
    }
}

class RecurringPlanRejected(val statusCode: Int) : IOException("The recurring plan request was rejected.")
internal fun planWriteResponse(status: Int, body: ByteArray): RecurringPlanDto {
    if (status in 200..299) return RecurringPlanJson.decodePlan(body)
    if (status == 409) {
        val revision = runCatching { JSONObject(body.decodeToString()).optInt("currentRevision", 0) }.getOrDefault(0)
        throw RecurringRevisionConflict(revision.coerceAtLeast(0))
    }
    if (status in 400..499) throw RecurringPlanRejected(status)
    throw TransportFailure.Retryable
}
