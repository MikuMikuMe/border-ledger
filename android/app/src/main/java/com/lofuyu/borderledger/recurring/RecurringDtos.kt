package com.lofuyu.borderledger.recurring

import com.lofuyu.borderledger.parser.CurrencyRegistry
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

enum class RecurringClassification(val wireValue: String) {
    UNCLASSIFIED("unclassified"),
    SUBSCRIPTION("subscription"),
    BILL("bill"),
    OTHER("other"),
    EXCLUDED("excluded"),
}

data class RecurringStreamDto(
    val id: String,
    val accountId: String,
    val currency: String,
    val merchantName: String?,
    val merchantEntityId: String?,
    val frequency: String,
    val sourceFrequency: String?,
    val classification: String,
    val sourceStatus: String,
    val isOutflow: Boolean,
    val firstDate: String?,
    val lastDate: String?,
    val averageAmountMinor: Long?,
    val lastAmountMinor: Long?,
    val predictedAmountMinor: Long?,
    val predictedNextDate: String?,
    val sourceUpdatedAt: String?,
    val revision: Int,
)

data class RecurringMembershipDto(
    val providerTransactionId: String,
    val pendingProviderTransactionId: String?,
    val date: String,
    val amountMinor: Long,
    val currency: String,
    val status: String,
    val kind: String,
)

data class RecurringPageInfo(val nextCursor: String?, val limit: Int)

data class RecurringPageDto(
    val items: List<RecurringStreamDto>,
    val page: RecurringPageInfo,
    val state: String,
    val checkedAt: String?,
    val sourceUpdatedAt: String?,
    val lastError: String?,
    val coverageWarnings: List<String>,
)

data class RecurringSummaryDto(
    val monthlyByCurrency: Map<String, Long>,
    val yearlyByCurrency: Map<String, Long>,
    val subscriptionByCurrency: Map<String, Long>,
    val actualCostByCurrency: Map<String, Long>,
    val upcoming: List<RecurringUpcomingDto>,
    val latestPaymentChanges: List<RecurringStreamDto>,
    val streamCount: Int,
    val coverageWarnings: List<String>,
    val checkedAt: String?,
    val sourceUpdatedAt: String?,
    val lastError: String?,
    val state: String,
)

data class RecurringUpcomingDto(val stream: RecurringStreamDto, val nextExpectedAmountMinor: Long?)

data class RecurringDetailDto(
    val stream: RecurringStreamDto,
    val history: List<RecurringMembershipDto>,
    val page: RecurringPageInfo,
    val classification: String,
)

data class RecurringClassificationAck(val id: String, val revision: Int, val updatedAt: String)

object RecurringCurrencyPolicy {
    val initialCodes: List<String> = listOf("CAD", "CNY", "USD", "HKD")

    private val registeredCodes = CurrencyRegistry.DEFAULT_ENTRIES.keys
    val supportedCodes: List<String> = initialCodes.filter { it in registeredCodes } +
        registeredCodes.filterNot { it in initialCodes }

    fun isSupported(code: String): Boolean = code in registeredCodes
}

object RecurringJson {
    private val states = setOf("ready", "waiting", "empty", "stale", "error", "unavailable", "incomplete")

    fun decodePage(payload: ByteArray): RecurringPageDto = decodePage(JSONObject(String(payload, StandardCharsets.UTF_8)))

    fun decodeSummary(payload: ByteArray): RecurringSummaryDto = decodeSummary(JSONObject(String(payload, StandardCharsets.UTF_8)))

    fun decodeDetail(payload: ByteArray): RecurringDetailDto = decodeDetail(JSONObject(String(payload, StandardCharsets.UTF_8)))

    fun decodeClassificationAck(payload: ByteArray): RecurringClassificationAck {
        val value = JSONObject(String(payload, StandardCharsets.UTF_8))
        return RecurringClassificationAck(value.requiredString("id"), value.requiredInt("revision"), value.requiredString("updatedAt"))
    }

    fun classificationBody(expectedRevision: Int, classification: String): String {
        require(expectedRevision >= 0)
        require(RecurringClassification.entries.any { it.wireValue == classification })
        return "{\"expectedRevision\":$expectedRevision,\"classification\":\"$classification\"}"
    }

    private fun decodePage(value: JSONObject): RecurringPageDto {
        val page = value.requiredObject("page")
        val state = value.requiredString("state").also { require(it in states) }
        return RecurringPageDto(
            items = value.requiredArray("items").bounded(100).map { parseStream(it asObject "stream item") },
            page = parsePageInfo(page),
            state = state,
            checkedAt = value.nullableString("checkedAt"),
            sourceUpdatedAt = value.nullableString("sourceUpdatedAt"),
            lastError = value.nullableString("lastError"),
            coverageWarnings = value.requiredArray("coverageWarnings").bounded(100).map { it asString "coverage warning" },
        )
    }

    private fun decodeSummary(value: JSONObject): RecurringSummaryDto {
        val state = value.requiredString("state").also { require(it in states) }
        return RecurringSummaryDto(
            monthlyByCurrency = value.moneyMap("monthlyByCurrency"),
            yearlyByCurrency = value.moneyMap("yearlyByCurrency"),
            subscriptionByCurrency = value.moneyMap("subscriptionByCurrency"),
            actualCostByCurrency = value.moneyMap("actualCostByCurrency"),
            upcoming = value.requiredArray("upcoming").bounded(100).map { item ->
                val objectValue = item asObject "upcoming item"
                RecurringUpcomingDto(parseStream(objectValue), objectValue.nullableLong("nextExpectedAmountMinor"))
            },
            latestPaymentChanges = value.requiredArray("latestPaymentChanges").bounded(100).map { parseStream(it asObject "payment change") },
            streamCount = value.requiredInt("streamCount").also { require(it >= 0) },
            coverageWarnings = value.requiredArray("coverageWarnings").bounded(100).map { it asString "coverage warning" },
            checkedAt = value.nullableString("checkedAt"),
            sourceUpdatedAt = value.nullableString("sourceUpdatedAt"),
            lastError = value.nullableString("lastError"),
            state = state,
        )
    }

    private fun decodeDetail(value: JSONObject): RecurringDetailDto {
        val page = value.requiredObject("page")
        return RecurringDetailDto(
            stream = parseStream(value.requiredObject("stream")),
            history = value.requiredArray("history").bounded(100).map { parseMembership(it asObject "history item") },
            page = parsePageInfo(page),
            classification = value.requiredString("classification"),
        )
    }

    private fun parsePageInfo(value: JSONObject): RecurringPageInfo {
        val limit = value.requiredInt("limit").also { require(it in 1..100) }
        return RecurringPageInfo(value.nullableString("nextCursor"), limit)
    }

    private fun parseStream(value: JSONObject): RecurringStreamDto {
        val currency = value.requiredString("currency").also { require(RecurringCurrencyPolicy.isSupported(it)) }
        return RecurringStreamDto(
            id = value.requiredString("id"),
            accountId = value.requiredString("accountId"),
            currency = currency,
            merchantName = value.nullableString("merchantName"),
            merchantEntityId = value.nullableString("merchantEntityId"),
            frequency = value.requiredString("frequency"),
            sourceFrequency = value.nullableString("sourceFrequency"),
            classification = value.requiredString("classification"),
            sourceStatus = value.requiredString("sourceStatus"),
            isOutflow = value.optBoolean("isOutflow", false),
            firstDate = value.nullableString("firstDate"),
            lastDate = value.nullableString("lastDate"),
            averageAmountMinor = value.nullableLong("averageAmountMinor"),
            lastAmountMinor = value.nullableLong("lastAmountMinor"),
            predictedAmountMinor = value.nullableLong("predictedAmountMinor"),
            predictedNextDate = value.nullableString("predictedNextDate"),
            sourceUpdatedAt = value.nullableString("sourceUpdatedAt"),
            revision = value.requiredInt("revision").also { require(it >= 0) },
        )
    }

    private fun parseMembership(value: JSONObject): RecurringMembershipDto {
        val currency = value.requiredString("currency").also { require(RecurringCurrencyPolicy.isSupported(it)) }
        return RecurringMembershipDto(
            providerTransactionId = value.requiredString("providerTransactionId"),
            pendingProviderTransactionId = value.nullableString("pendingProviderTransactionId"),
            date = value.requiredString("date"),
            amountMinor = value.requiredLong("amountMinor"),
            currency = currency,
            status = value.optString("status", "posted"),
            kind = value.optString("kind", "expense"),
        )
    }

    private fun JSONObject.moneyMap(name: String): Map<String, Long> {
        val result = linkedMapOf<String, Long>()
        val value = requiredObject(name)
        for (key in value.keys()) {
            require(RecurringCurrencyPolicy.isSupported(key))
            result[key] = value.requiredLong(key)
        }
        return result
    }

    private fun JSONObject.requiredString(name: String): String = optString(name, "").takeIf { it.isNotBlank() } ?: error("Missing Worker field: $name")
    private fun JSONObject.nullableString(name: String): String? = if (!has(name) || isNull(name)) null else requiredString(name)
    private fun JSONObject.requiredInt(name: String): Int = get(name).let { it as? Number ?: error("Worker field is not an integer: $name") }.toInt()
    private fun JSONObject.requiredLong(name: String): Long = get(name).let { it as? Number ?: error("Worker field is not an integer: $name") }.toLong()
    private fun JSONObject.nullableLong(name: String): Long? = if (!has(name) || isNull(name)) null else requiredLong(name)
    private fun JSONObject.requiredObject(name: String): JSONObject = getJSONObject(name)
    private fun JSONObject.requiredArray(name: String): JSONArray = getJSONArray(name)
    private fun JSONArray.bounded(max: Int): List<Any?> {
        require(length() <= max)
        return (0 until length()).map { get(it) }
    }
    private infix fun Any?.asString(name: String): String = (this as? String)?.takeIf { it.isNotBlank() } ?: error("Invalid Worker $name")
    private infix fun Any?.asObject(name: String): JSONObject = this as? JSONObject ?: error("Invalid Worker $name")
}
