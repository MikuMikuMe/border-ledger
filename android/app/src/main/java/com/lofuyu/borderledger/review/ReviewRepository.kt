package com.lofuyu.borderledger.review

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerAuthInterceptor
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import com.lofuyu.borderledger.parser.CurrencyRegistry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant

object ReviewLimits {
    const val MAX_PAGE_ITEMS = 100
    const val MAX_RESPONSE_BYTES = 512 * 1024
    const val MAX_STRING_LENGTH = 512
    const val MAX_ID_LENGTH = 128
    const val MAX_REASON_CODES = 8
    const val MAX_PROVENANCE = 8
    const val MAX_CANDIDATES = 5
    const val MAX_LINKS = 8
    const val MAX_CATEGORY_LENGTH = 80
    const val MAX_NOTE_LENGTH = 1_000
    const val MAX_MONEY_AMOUNT_MINOR = 9_007_199_254_740_991L
}

data class ReviewQuery(
    val cursor: String? = null,
    val limit: Int = 50,
) {
    init {
        require(limit in 1..ReviewLimits.MAX_PAGE_ITEMS)
        require(cursor == null || cursor.length <= ReviewLimits.MAX_STRING_LENGTH)
    }
}

data class ReviewMoney(
    val currency: String,
    val amountMinor: Long,
) {
    init {
        require(CurrencyRegistry().metadata(currency) != null)
        require(amountMinor in 1..ReviewLimits.MAX_MONEY_AMOUNT_MINOR)
    }
}

data class ReviewProvenanceDto(
    val sourceKind: String,
    val sourceId: String,
    val basis: String,
    val revision: Int,
)

data class ReviewSourceEvidenceDto(
    val sourceProfileId: String,
    val parserVersion: String,
    val eventTimeBasis: String,
    val capturedAt: String,
    val notificationPostedAt: String?,
    val bankReference: String?,
    val merchant: String?,
    val eventMoney: ReviewMoney?,
)

data class ReviewTransactionComparisonDto(
    val id: String,
    val date: String,
    val merchant: String,
    val amountMinor: Long,
    val currency: String,
    val kind: String,
    val status: String,
    val source: String,
) {
    init {
        require(id.isNotBlank() && id.length <= ReviewLimits.MAX_ID_LENGTH)
        require(date.matches(DATE_PATTERN))
        require(merchant.isNotBlank() && merchant.length <= 160)
        require(amountMinor in -ReviewLimits.MAX_MONEY_AMOUNT_MINOR..ReviewLimits.MAX_MONEY_AMOUNT_MINOR)
        require(currency.matches(CURRENCY_PATTERN))
        require(kind in VALID_TRANSACTION_KINDS)
        require(status in VALID_TRANSACTION_STATES)
        require(source == "statement")
    }
}

data class ReviewCandidateDto(
    val id: String,
    val statementTransactionId: String,
    val candidateTransactionId: String,
    val score: Int,
    val reasonCodes: List<String>,
    val status: String,
    val evidenceBasis: String,
    val relation: ReviewRelation?,
    val targetTransaction: ReviewTransactionComparisonDto,
)

data class ReviewLinkEvidenceDto(
    val id: String,
    val targetEventId: String?,
    val targetTransactionId: String?,
    val relation: ReviewRelation,
    val allocatedMoney: ReviewMoney?,
    val evidenceBasis: String,
    val revision: Int,
)

data class ReviewLinkActionDto(
    val targetId: String,
    val candidateTransactionId: String,
    val relation: ReviewRelation,
    val allocatedMoney: ReviewMoney?,
)

data class ReviewAnnotationDto(
    val transactionId: String,
    val expectedRevision: Int,
    val category: String,
    val note: String?,
) {
    init {
        require(transactionId.isNotBlank() && transactionId.length <= ReviewLimits.MAX_ID_LENGTH)
        require(expectedRevision >= 0)
        require(category.isNotBlank() && category.length <= ReviewLimits.MAX_CATEGORY_LENGTH)
        require(note == null || note.length <= ReviewLimits.MAX_NOTE_LENGTH)
    }
}

data class ReviewAlertDto(
    val eventId: String,
    val eventType: String,
    val state: String,
    val countedMoney: ReviewMoney?,
    val reportingDate: String?,
    val revision: Int,
    val reasonCodes: List<String> = emptyList(),
    val sourceEvidence: ReviewSourceEvidenceDto? = null,
    val provenance: List<ReviewProvenanceDto> = emptyList(),
    val affectedMoney: ReviewMoney? = null,
    val candidates: List<ReviewCandidateDto> = emptyList(),
    val links: List<ReviewLinkEvidenceDto> = emptyList(),
    val linkAction: ReviewLinkActionDto? = null,
    val linkDisabledReason: String? = null,
    val transactionId: String? = null,
    val annotation: ReviewAnnotationDto? = null,
    val annotationDisabledReason: String? = null,
) {
    init {
        require(eventId.matches(EVENT_ID_PATTERN))
        require(eventType in VALID_EVENT_TYPES)
        require(state in VALID_STATES)
        require(reportingDate == null || reportingDate.matches(DATE_PATTERN))
        require(revision >= 0)
        require(reasonCodes.size <= ReviewLimits.MAX_REASON_CODES && reasonCodes.all { it.isNotBlank() && it.length <= 64 })
        require(provenance.size <= ReviewLimits.MAX_PROVENANCE)
        require(candidates.size <= ReviewLimits.MAX_CANDIDATES)
        require(links.size <= ReviewLimits.MAX_LINKS)
        require(linkDisabledReason == null || linkDisabledReason.length <= ReviewLimits.MAX_STRING_LENGTH)
        require(transactionId == null || (transactionId.isNotBlank() && transactionId.length <= ReviewLimits.MAX_ID_LENGTH))
        require(annotation == null || annotation.transactionId == transactionId)
        require(annotationDisabledReason == null || annotationDisabledReason.length <= ReviewLimits.MAX_STRING_LENGTH)
    }
}

data class ReviewPageDto(
    val items: List<ReviewAlertDto>,
    val nextCursor: String?,
    val limit: Int,
) {
    init {
        require(items.size <= ReviewLimits.MAX_PAGE_ITEMS)
        require(limit in 1..ReviewLimits.MAX_PAGE_ITEMS)
        require(nextCursor == null || nextCursor.length <= ReviewLimits.MAX_STRING_LENGTH)
    }
}

enum class ReviewDecision(val wireValue: String) {
    KEEP_SEPARATE("keep_separate"),
    IGNORE("ignore"),
    LINK("link"),
    CLASSIFY("classify"),
}

enum class ReviewRelation(val wireValue: String) {
    CANCELS("cancels"),
    PARTIALLY_REVERSES("partially_reverses"),
    REPLACES_AUTHORIZATION("replaces_authorization"),
    REFUND_OF("refund_of"),
    CONFIRMS("confirms"),
    POSSIBLE_DUPLICATE("possible_duplicate"),

    ;

    companion object {
        fun fromWire(value: String): ReviewRelation? = values().firstOrNull { it.wireValue == value }
    }
}

data class ReviewRevisionAck(
    val id: String,
    val revision: Int,
    val updatedAt: String,
)

interface ReviewRepository {
    suspend fun readAlerts(query: ReviewQuery = ReviewQuery()): ReviewPageDto

    suspend fun reviewAlert(
        eventId: String,
        expectedRevision: Int,
        decision: ReviewDecision,
        targetId: String? = null,
        candidateTransactionId: String? = null,
        relation: ReviewRelation? = null,
        allocatedMoney: ReviewMoney? = null,
    ): ReviewRevisionAck

    suspend fun annotateTransaction(
        transactionId: String,
        expectedRevision: Int,
        category: String,
        note: String?,
    ): ReviewRevisionAck
}

data class ReviewHttpResponse(val statusCode: Int, val body: String)

fun interface ReviewHttpTransport {
    suspend fun execute(request: MobileRequest): ReviewHttpResponse
}

class ReviewRevisionConflict(val currentRevision: Int?) : IOException(
    "This review changed elsewhere; refresh before saving.",
)

class ReviewRouteUnavailable(
    val statusCode: Int,
    val route: String,
) : IOException("The owner Review route is unavailable (HTTP $statusCode): $route")

class ReviewResponseInvalid(message: String) : IOException(message)

class ReviewRequestFailed(
    val statusCode: Int,
    val code: String?,
    message: String,
) : IOException(message)

class HttpWorkerReviewRepository(
    private val origin: String,
    environment: String,
    ownerCredentials: OwnerCredentialProvider,
    private val transport: ReviewHttpTransport = UrlConnectionReviewHttpTransport(),
) : ReviewRepository {
    private val ownerInterceptor = OwnerAuthInterceptor(ownerCredentials, ApiEnvironment(origin, environment))

    override suspend fun readAlerts(query: ReviewQuery): ReviewPageDto {
        val path = queryPath(
            "/api/mobile/v1/alerts",
            buildMap {
                put("limit", query.limit.toString())
                query.cursor?.let { put("cursor", it) }
            },
        )
        return ReviewJson.decodePage(readSuccess(execute(MobileRequest("GET", "$origin$path")), path))
    }

    override suspend fun reviewAlert(
        eventId: String,
        expectedRevision: Int,
        decision: ReviewDecision,
        targetId: String?,
        candidateTransactionId: String?,
        relation: ReviewRelation?,
        allocatedMoney: ReviewMoney?,
    ): ReviewRevisionAck {
        validateId(eventId, "eventId")
        require(expectedRevision >= 0)
        require(targetId == null || targetId.length <= ReviewLimits.MAX_ID_LENGTH)
        require(candidateTransactionId == null || candidateTransactionId.length <= ReviewLimits.MAX_ID_LENGTH)
        val path = "/api/mobile/v1/alerts/${encode(eventId)}/review"
        val response = execute(
            MobileRequest(
                method = "PATCH",
                url = "$origin$path",
                headers = JSON_HEADERS,
                body = ReviewJson.reviewBody(expectedRevision, decision, targetId, candidateTransactionId, relation, allocatedMoney)
                    .toByteArray(StandardCharsets.UTF_8),
            ),
        )
        return ReviewJson.decodeAck(readSuccess(response, path))
    }

    override suspend fun annotateTransaction(
        transactionId: String,
        expectedRevision: Int,
        category: String,
        note: String?,
    ): ReviewRevisionAck {
        validateId(transactionId, "transactionId")
        require(expectedRevision >= 0)
        require(category.isNotBlank() && category.length <= ReviewLimits.MAX_CATEGORY_LENGTH)
        require(note == null || note.length <= ReviewLimits.MAX_NOTE_LENGTH)
        val path = "/api/mobile/v1/transactions/${encode(transactionId)}/annotation"
        val response = execute(
            MobileRequest(
                method = "PATCH",
                url = "$origin$path",
                headers = JSON_HEADERS,
                body = ReviewJson.annotationBody(expectedRevision, category, note)
                    .toByteArray(StandardCharsets.UTF_8),
            ),
        )
        return ReviewJson.decodeAck(readSuccess(response, path))
    }

    private suspend fun execute(request: MobileRequest): ReviewHttpResponse {
        val response = transport.execute(ownerInterceptor.intercept(request))
        if (response.body.toByteArray(StandardCharsets.UTF_8).size > ReviewLimits.MAX_RESPONSE_BYTES) {
            throw ReviewResponseInvalid("The owner Review response is too large.")
        }
        return response
    }

    private fun readSuccess(response: ReviewHttpResponse, route: String): String {
        if (response.statusCode in 200..299) return response.body
        val error = runCatching { JSONObject(response.body) }.getOrNull()
        val currentRevision = error?.optInt("currentRevision", -1)?.takeIf { it >= 0 }
        when (response.statusCode) {
            HttpURLConnection.HTTP_UNAUTHORIZED, HttpURLConnection.HTTP_FORBIDDEN -> throw TransportFailure.Unauthorized
            HttpURLConnection.HTTP_NOT_FOUND, HttpURLConnection.HTTP_NOT_IMPLEMENTED -> throw ReviewRouteUnavailable(response.statusCode, route)
            HttpURLConnection.HTTP_CONFLICT -> throw ReviewRevisionConflict(currentRevision)
        }
        val code = error?.optString("code")?.takeIf { it.isNotBlank() }
        val message = error?.optString("message")?.takeIf { it.isNotBlank() }
            ?: "The owner Review request failed (HTTP ${response.statusCode})."
        throw ReviewRequestFailed(response.statusCode, code, message)
    }

    private fun validateId(value: String, field: String) {
        require(value.isNotBlank() && value.length <= ReviewLimits.MAX_ID_LENGTH) { "$field is not valid." }
    }

    private fun queryPath(base: String, query: Map<String, String>): String = query.entries.joinToString(
        separator = "&",
        prefix = "$base?",
    ) { "${encode(it.key)}=${encode(it.value)}" }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    private companion object {
        val JSON_HEADERS = mapOf(
            "Accept" to "application/json",
            "Content-Type" to "application/json; charset=utf-8",
        )
    }
}

object ReviewJson {
    fun decodePage(body: String): ReviewPageDto {
        val root = parseObject(body)
        val items = root.optJSONArray("items") ?: throw ReviewResponseInvalid("The Review page items are missing.")
        if (items.length() > ReviewLimits.MAX_PAGE_ITEMS) throw ReviewResponseInvalid("The Review page is too large.")
        val page = root.optJSONObject("page") ?: throw ReviewResponseInvalid("The Review page metadata is missing.")
        val limit = requiredInteger(page, "limit")
        if (limit !in 1..ReviewLimits.MAX_PAGE_ITEMS) throw ReviewResponseInvalid("The Review page limit is invalid.")
        val nextCursor = nullableString(page, "nextCursor", ReviewLimits.MAX_STRING_LENGTH)
        return ReviewPageDto(
            items = buildList(items.length()) {
                for (index in 0 until items.length()) add(decodeAlert(items.optJSONObject(index) ?: invalid("Review item")))
            },
            nextCursor = nextCursor,
            limit = limit,
        )
    }

    fun decodeAck(body: String): ReviewRevisionAck {
        val root = parseObject(body)
        val id = requiredString(root, "id", ReviewLimits.MAX_ID_LENGTH)
        val revision = requiredInteger(root, "revision")
        if (revision < 1) throw ReviewResponseInvalid("The Review acknowledgement revision is invalid.")
        val updatedAt = requiredString(root, "updatedAt", ReviewLimits.MAX_STRING_LENGTH)
        if (runCatching { Instant.parse(updatedAt) }.isFailure) {
            throw ReviewResponseInvalid("The Review acknowledgement timestamp is invalid.")
        }
        return ReviewRevisionAck(id, revision, updatedAt)
    }

    fun reviewBody(
        expectedRevision: Int,
        decision: ReviewDecision,
        targetId: String?,
        candidateTransactionId: String?,
        relation: ReviewRelation?,
        allocatedMoney: ReviewMoney?,
    ): String = JSONObject()
        .put("expectedRevision", expectedRevision)
        .put("decision", decision.wireValue)
        .also { body ->
            targetId?.let { body.put("targetId", it) }
            candidateTransactionId?.let { body.put("candidateTransactionId", it) }
            relation?.let { body.put("relation", it.wireValue) }
            allocatedMoney?.let {
                body.put("allocatedMoney", JSONObject().put("currency", it.currency).put("amountMinor", it.amountMinor))
            }
        }
        .toString()

    fun annotationBody(expectedRevision: Int, category: String, note: String?): String = JSONObject()
        .put("expectedRevision", expectedRevision)
        .put("category", category)
        .put("note", note ?: JSONObject.NULL)
        .toString()

    private fun decodeAlert(value: JSONObject): ReviewAlertDto {
        return try {
            val eventId = requiredString(value, "eventId", ReviewLimits.MAX_ID_LENGTH)
            if (!eventId.matches(EVENT_ID_PATTERN)) throw ReviewResponseInvalid("The alert event ID is invalid.")
            val countedMoney = nullableMoney(value, "countedMoney")
            val affectedMoney = nullableMoney(value, "affectedMoney")
            val reasonCodes = requiredStringArray(value, "reasonCodes", ReviewLimits.MAX_REASON_CODES)
            val sourceEvidence = decodeSourceEvidence(value.optJSONObject("sourceEvidence") ?: invalid("Alert sourceEvidence"))
            val provenance = decodeProvenance(value)
            val candidates = decodeCandidates(value)
            val links = decodeLinks(value)
            val linkAction = decodeLinkAction(value)
            val transactionId = nullableString(value, "transactionId", ReviewLimits.MAX_ID_LENGTH)
            val annotation = decodeAnnotation(value)
            ReviewAlertDto(
                eventId = eventId,
                eventType = requiredString(value, "eventType", ReviewLimits.MAX_STRING_LENGTH),
                state = requiredString(value, "state", ReviewLimits.MAX_STRING_LENGTH),
                countedMoney = countedMoney,
                reportingDate = nullableString(value, "reportingDate", ReviewLimits.MAX_STRING_LENGTH),
                revision = requiredInteger(value, "revision"),
                reasonCodes = reasonCodes,
                sourceEvidence = sourceEvidence,
                provenance = provenance,
                affectedMoney = affectedMoney,
                candidates = candidates,
                links = links,
                linkAction = linkAction,
                linkDisabledReason = nullableString(value, "linkDisabledReason", ReviewLimits.MAX_STRING_LENGTH),
                transactionId = transactionId,
                annotation = annotation,
                annotationDisabledReason = nullableString(value, "annotationDisabledReason", ReviewLimits.MAX_STRING_LENGTH),
            )
        } catch (error: ReviewResponseInvalid) {
            throw error
        } catch (_: IllegalArgumentException) {
            throw ReviewResponseInvalid("The alert DTO is invalid.")
        }
    }

    private fun nullableMoney(value: JSONObject, name: String): ReviewMoney? {
        if (!value.has(name)) invalid("Alert $name")
        if (value.isNull(name)) return null
        val money = value.optJSONObject(name) ?: invalid("Alert $name")
        return ReviewMoney(
            currency = requiredString(money, "currency", 3),
            amountMinor = requiredLong(money, "amountMinor"),
        )
    }

    private fun decodeSourceEvidence(value: JSONObject): ReviewSourceEvidenceDto {
        val eventMoney = if (!value.has("eventMoney")) invalid("Alert sourceEvidence.eventMoney") else if (value.isNull("eventMoney")) null else {
            val money = value.optJSONObject("eventMoney") ?: invalid("Alert sourceEvidence.eventMoney")
            ReviewMoney(requiredString(money, "currency", 3), requiredLong(money, "amountMinor"))
        }
        return ReviewSourceEvidenceDto(
            sourceProfileId = requiredString(value, "sourceProfileId", ReviewLimits.MAX_ID_LENGTH),
            parserVersion = requiredString(value, "parserVersion", 64),
            eventTimeBasis = requiredString(value, "eventTimeBasis", 64),
            capturedAt = requiredString(value, "capturedAt", 64),
            notificationPostedAt = nullableString(value, "notificationPostedAt", 64),
            bankReference = nullableString(value, "bankReference", 128),
            merchant = nullableString(value, "merchant", 160),
            eventMoney = eventMoney,
        )
    }

    private fun decodeProvenance(value: JSONObject): List<ReviewProvenanceDto> {
        val array = value.optJSONArray("provenance") ?: invalid("Alert provenance")
        if (array.length() > ReviewLimits.MAX_PROVENANCE) throw ReviewResponseInvalid("The alert provenance is too large.")
        return buildList(array.length()) {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: invalid("Alert provenance")
                add(ReviewProvenanceDto(
                    sourceKind = requiredString(item, "sourceKind", 64),
                    sourceId = requiredString(item, "sourceId", ReviewLimits.MAX_ID_LENGTH),
                    basis = requiredString(item, "basis", 64),
                    revision = requiredInteger(item, "revision").also { if (it < 1) invalid("Alert provenance revision") },
                ))
            }
        }
    }

    private fun decodeCandidates(value: JSONObject): List<ReviewCandidateDto> {
        val array = value.optJSONArray("candidates") ?: invalid("Alert candidates")
        if (array.length() > ReviewLimits.MAX_CANDIDATES) throw ReviewResponseInvalid("The alert candidates are too large.")
        return buildList(array.length()) {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: invalid("Alert candidate")
                val score = requiredInteger(item, "score")
                if (score !in 0..100) invalid("Alert candidate score")
                val relation = nullableRelation(item, "relation")
                val status = requiredString(item, "status", 32)
                if (status !in VALID_CANDIDATE_STATES) invalid("Alert candidate status")
                val evidenceBasis = requiredString(item, "evidenceBasis", 64)
                if (evidenceBasis !in VALID_CANDIDATE_EVIDENCE) invalid("Alert candidate evidence")
                add(ReviewCandidateDto(
                    id = requiredString(item, "id", ReviewLimits.MAX_ID_LENGTH),
                    statementTransactionId = requiredString(item, "statementTransactionId", ReviewLimits.MAX_ID_LENGTH),
                    candidateTransactionId = requiredString(item, "candidateTransactionId", ReviewLimits.MAX_ID_LENGTH),
                    score = score,
                    reasonCodes = requiredStringArray(item, "reasonCodes", ReviewLimits.MAX_REASON_CODES),
                    status = status,
                    evidenceBasis = evidenceBasis,
                    relation = relation,
                    targetTransaction = decodeTransaction(item.optJSONObject("targetTransaction") ?: invalid("Alert candidate targetTransaction")),
                ))
            }
        }
    }

    private fun decodeLinks(value: JSONObject): List<ReviewLinkEvidenceDto> {
        val array = value.optJSONArray("links") ?: invalid("Alert links")
        if (array.length() > ReviewLimits.MAX_LINKS) throw ReviewResponseInvalid("The alert links are too large.")
        return buildList(array.length()) {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: invalid("Alert link")
                val targetEventId = nullableString(item, "targetEventId", ReviewLimits.MAX_ID_LENGTH)
                val targetTransactionId = nullableString(item, "targetTransactionId", ReviewLimits.MAX_ID_LENGTH)
                if ((targetEventId == null) == (targetTransactionId == null)) invalid("Alert link target")
                val relation = ReviewRelation.fromWire(requiredString(item, "relation", 64)) ?: invalid("Alert link relation")
                val evidenceBasis = requiredString(item, "evidenceBasis", 64)
                if (evidenceBasis !in VALID_LINK_EVIDENCE) invalid("Alert link evidence")
                add(ReviewLinkEvidenceDto(
                    id = requiredString(item, "id", ReviewLimits.MAX_ID_LENGTH),
                    targetEventId = targetEventId,
                    targetTransactionId = targetTransactionId,
                    relation = relation,
                    allocatedMoney = nullableMoney(item, "allocatedMoney"),
                    evidenceBasis = evidenceBasis,
                    revision = requiredInteger(item, "revision").also { if (it < 1) invalid("Alert link revision") },
                ))
            }
        }
    }

    private fun decodeLinkAction(value: JSONObject): ReviewLinkActionDto? {
        if (!value.has("linkAction")) invalid("Alert linkAction")
        if (value.isNull("linkAction")) return null
        val item = value.optJSONObject("linkAction") ?: invalid("Alert linkAction")
        return ReviewLinkActionDto(
            targetId = requiredString(item, "targetId", ReviewLimits.MAX_ID_LENGTH),
            candidateTransactionId = requiredString(item, "candidateTransactionId", ReviewLimits.MAX_ID_LENGTH),
            relation = ReviewRelation.fromWire(requiredString(item, "relation", 64)) ?: invalid("Alert linkAction relation"),
            allocatedMoney = nullableMoney(item, "allocatedMoney"),
        )
    }

    private fun decodeAnnotation(value: JSONObject): ReviewAnnotationDto? {
        if (!value.has("annotation")) invalid("Alert annotation")
        if (value.isNull("annotation")) return null
        val item = value.optJSONObject("annotation") ?: invalid("Alert annotation")
        val expectedRevision = requiredInteger(item, "expectedRevision")
        if (expectedRevision < 0) invalid("Alert annotation expectedRevision")
        val note = nullableString(item, "note", ReviewLimits.MAX_NOTE_LENGTH)
        return ReviewAnnotationDto(
            transactionId = requiredString(item, "transactionId", ReviewLimits.MAX_ID_LENGTH),
            expectedRevision = expectedRevision,
            category = requiredString(item, "category", ReviewLimits.MAX_CATEGORY_LENGTH),
            note = note,
        )
    }

    private fun decodeTransaction(value: JSONObject): ReviewTransactionComparisonDto = ReviewTransactionComparisonDto(
        id = requiredString(value, "id", ReviewLimits.MAX_ID_LENGTH),
        date = requiredString(value, "date", 32),
        merchant = requiredString(value, "merchant", 160),
        amountMinor = requiredLong(value, "amountMinor"),
        currency = requiredString(value, "currency", 3),
        kind = requiredString(value, "kind", 32),
        status = requiredString(value, "status", 32),
        source = requiredString(value, "source", 32),
    )

    private fun nullableRelation(value: JSONObject, name: String): ReviewRelation? {
        if (!value.has(name)) invalid("Alert $name")
        if (value.isNull(name)) return null
        return ReviewRelation.fromWire(requiredString(value, name, 64)) ?: invalid("Alert $name")
    }

    private fun requiredStringArray(value: JSONObject, name: String, maxItems: Int): List<String> {
        val array = value.optJSONArray(name) ?: invalid("Alert $name")
        if (array.length() > maxItems) throw ReviewResponseInvalid("The alert $name is too large.")
        return buildList(array.length()) {
            for (index in 0 until array.length()) add(requiredString(array, index, name))
        }
    }

    private fun requiredString(value: org.json.JSONArray, index: Int, name: String): String {
        val raw = value.opt(index)
        if (raw !is String || raw.isBlank() || raw.length > 64) throw ReviewResponseInvalid("The Review field $name is invalid.")
        return raw
    }

    private fun parseObject(body: String): JSONObject = runCatching {
        if (body.toByteArray(StandardCharsets.UTF_8).size > ReviewLimits.MAX_RESPONSE_BYTES) {
            throw ReviewResponseInvalid("The owner Review response is too large.")
        }
        JSONObject(body)
    }.getOrElse { error ->
        if (error is ReviewResponseInvalid) throw error
        throw ReviewResponseInvalid("The owner Review response is not valid JSON.")
    }

    private fun requiredString(value: JSONObject, name: String, max: Int): String {
        val raw = value.opt(name)
        if (raw !is String || raw.isBlank() || raw.length > max) throw ReviewResponseInvalid("The Review field $name is invalid.")
        return raw
    }

    private fun nullableString(value: JSONObject, name: String, max: Int): String? {
        if (!value.has(name)) throw ReviewResponseInvalid("The Review field $name is missing.")
        if (value.isNull(name)) return null
        val raw = value.opt(name)
        if (raw !is String || raw.length > max) throw ReviewResponseInvalid("The Review field $name is invalid.")
        return raw
    }

    private fun requiredInteger(value: JSONObject, name: String): Int {
        val raw = value.opt(name)
        val text = raw?.toString()
        val parsed = if (raw is Number && text != null && text.matches(INTEGER_PATTERN)) text.toLongOrNull() else null
        if (parsed == null || parsed !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
            throw ReviewResponseInvalid("The Review field $name is invalid.")
        }
        return parsed.toInt()
    }

    private fun requiredLong(value: JSONObject, name: String): Long {
        val raw = value.opt(name)
        val text = raw?.toString()
        if (raw !is Number || text == null || !text.matches(INTEGER_PATTERN)) {
            throw ReviewResponseInvalid("The Review field $name is invalid.")
        }
        return text.toLongOrNull() ?: throw ReviewResponseInvalid("The Review field $name is invalid.")
    }

    private fun invalid(field: String): Nothing = throw ReviewResponseInvalid("The $field is invalid.")
}

private class UrlConnectionReviewHttpTransport : ReviewHttpTransport {
    override suspend fun execute(request: MobileRequest): ReviewHttpResponse = withContext(Dispatchers.IO) {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = 15_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Cache-Control", "no-store")
                request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
                request.body?.let { body ->
                    doOutput = true
                    setFixedLengthStreamingMode(body.size)
                    outputStream.use { it.write(body) }
                }
            }
        } catch (_: IOException) {
            throw TransportFailure.Offline
        }
        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8 * 1024)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > ReviewLimits.MAX_RESPONSE_BYTES) throw ReviewResponseInvalid("The owner Review response is too large.")
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            } ?: ByteArray(0)
            ReviewHttpResponse(status, String(bytes, StandardCharsets.UTF_8))
        } catch (error: TransportFailure) {
            throw error
        } catch (error: ReviewResponseInvalid) {
            throw error
        } catch (_: IOException) {
            throw TransportFailure.Offline
        } finally {
            connection.disconnect()
        }
    }
}

private val EVENT_ID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
private val CURRENCY_PATTERN = Regex("^[A-Z]{3}$")
private val DATE_PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}$")
private val INTEGER_PATTERN = Regex("^-?\\d+$")
private val VALID_EVENT_TYPES = setOf(
    "purchase_notice",
    "authorization_reversal",
    "declined",
    "refund_notice",
    "hold_notice",
    "adjustment_notice",
    "repayment_notice",
    "transfer_notice",
    "fee_notice",
    "unknown",
)
private val VALID_STATES = setOf("provisional", "non_spending", "needs_review", "voided", "superseded")
private val VALID_TRANSACTION_KINDS = setOf("expense", "income", "transfer", "refund", "fee")
private val VALID_TRANSACTION_STATES = setOf("confirmed", "provisional", "needs_review")
private val VALID_CANDIDATE_STATES = setOf("open", "accepted", "dismissed")
private val VALID_CANDIDATE_EVIDENCE = setOf("candidate_rank", "bank_reference", "user_review")
private val VALID_LINK_EVIDENCE = setOf("bank_reference", "user_review")
