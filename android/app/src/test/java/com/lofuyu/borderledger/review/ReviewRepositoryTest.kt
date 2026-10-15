package com.lofuyu.borderledger.review

import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.auth.OwnerCredentialProvider
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewRepositoryTest {
    @Test
    fun reviewMoneyAcceptsRegisteredCurrenciesAndRejectsUnknownCodes() {
        assertEquals("EUR", ReviewMoney("EUR", 1234).currency)
        assertTrue(runCatching { ReviewMoney("XYZ", 1) }.isFailure)
    }

    @Test
    fun decodesBoundedAlertPageWithoutInventingMoneyOrRevision() = runTest {
        val repository = repository(
            ReviewHttpResponse(200, alertPageJson()),
        )

        val page = repository.readAlerts(ReviewQuery(limit = 1))

        assertEquals(1, page.items.size)
        assertEquals("11111111-1111-4111-8111-111111111111", page.items.single().eventId)
        assertEquals("CAD", page.items.single().countedMoney?.currency)
        assertEquals(1234L, page.items.single().countedMoney?.amountMinor)
        assertEquals(4, page.items.single().revision)
        assertEquals(listOf("unresolved_time"), page.items.single().reasonCodes)
        assertEquals("source-boc", page.items.single().sourceEvidence?.sourceProfileId)
        assertEquals("alert", page.items.single().provenance.single().sourceKind)
        assertEquals(1234L, page.items.single().affectedMoney?.amountMinor)
        assertEquals("review-statement-row", page.items.single().candidates.single().statementTransactionId)
        assertEquals("confirms", page.items.single().linkAction?.relation?.wireValue)
        assertEquals("event-1", page.items.single().annotation?.transactionId)
        assertEquals(2, page.items.single().annotation?.expectedRevision)
        assertEquals("Travel", page.items.single().annotation?.category)
        assertEquals("next", page.nextCursor)
        assertEquals(1, page.limit)
    }

    @Test
    fun decodeRejectsMalformedOrOversizedAlertPage() = runTest {
        val malformed = repository(ReviewHttpResponse(200, "{\"items\":\"not-an-array\",\"page\":{}}"))
        val oversized = repository(ReviewHttpResponse(200, "x".repeat(ReviewLimits.MAX_RESPONSE_BYTES + 1)))

        assertTrue(runCatching { malformed.readAlerts() }.exceptionOrNull() is ReviewResponseInvalid)
        assertTrue(runCatching { oversized.readAlerts() }.exceptionOrNull() is ReviewResponseInvalid)
    }

    @Test
    fun decodeRejectsMissingRequiredNullableFieldsAndInvalidMoney() = runTest {
        val missingRequired = repository(
            ReviewHttpResponse(
                200,
                """
                    {"items":[{"eventId":"11111111-1111-4111-8111-111111111111","eventType":"purchase_notice","state":"needs_review","revision":0}],"page":{"limit":1}}
                """.trimIndent(),
            ),
        )
        val invalidMoney = repository(
            ReviewHttpResponse(
                200,
                """
                    {"items":[{"eventId":"11111111-1111-4111-8111-111111111111","eventType":"purchase_notice","state":"needs_review","countedMoney":{"currency":"CAD","amountMinor":0},"reportingDate":null,"revision":0}],"page":{"nextCursor":null,"limit":1}}
                """.trimIndent(),
            ),
        )

        assertTrue(runCatching { missingRequired.readAlerts() }.exceptionOrNull() is ReviewResponseInvalid)
        assertTrue(runCatching { invalidMoney.readAlerts() }.exceptionOrNull() is ReviewResponseInvalid)
    }

    @Test
    fun decodeRejectsUnboundedReviewEvidence() = runTest {
        val tooManyReasons = repository(ReviewHttpResponse(200, alertPageJson().replace(
            "[\"unresolved_time\"]",
            "[\"r1\",\"r2\",\"r3\",\"r4\",\"r5\",\"r6\",\"r7\",\"r8\",\"r9\"]",
        )))
        val sixCandidates = (1..6).joinToString(",") { candidateJson(it) }
        val tooManyCandidates = repository(ReviewHttpResponse(200, alertPageJson().replace(
            "\"candidates\":[{",
            "\"candidates\":[$sixCandidates,{",
        )))

        assertTrue(runCatching { tooManyReasons.readAlerts() }.exceptionOrNull() is ReviewResponseInvalid)
        assertTrue(runCatching { tooManyCandidates.readAlerts() }.exceptionOrNull() is ReviewResponseInvalid)
    }

    @Test
    fun mutationBodiesCarryExpectedRevisionAndAnnotationNulls() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(
            ReviewHttpResponse(200, ackJson("event-1", 5)),
            requests,
        )

        repository.reviewAlert(
            eventId = "event-1",
            expectedRevision = 4,
            decision = ReviewDecision.IGNORE,
        )
        repository.annotateTransaction(
            transactionId = "transaction-1",
            expectedRevision = 8,
            category = "Travel",
            note = null,
        )

        val reviewRequest = requests[0]
        assertEquals("PATCH", reviewRequest.method)
        assertEquals(
            "event-1",
            reviewRequest.url.substringAfterLast("/alerts/").substringBefore("/review"),
        )
        assertEquals(4, JSONObject(String(requireNotNull(reviewRequest.body))).getInt("expectedRevision"))
        assertEquals("ignore", JSONObject(String(requireNotNull(reviewRequest.body))).getString("decision"))

        val annotationRequest = requests[1]
        val annotationBody = JSONObject(String(requireNotNull(annotationRequest.body)))
        assertEquals(8, annotationBody.getInt("expectedRevision"))
        assertEquals("Travel", annotationBody.getString("category"))
        assertTrue(annotationBody.isNull("note"))
    }

    @Test
    fun linkMutationCarriesCandidateTargetRelationAllocationAndExpectedRevision() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(ReviewHttpResponse(200, ackJson("event-1", 5)), requests)

        repository.reviewAlert(
            eventId = "event-1",
            expectedRevision = 4,
            decision = ReviewDecision.LINK,
            targetId = "statement-1",
            candidateTransactionId = "event-1",
            relation = ReviewRelation.REFUND_OF,
            allocatedMoney = ReviewMoney("CAD", 1234),
        )

        val body = JSONObject(String(requireNotNull(requests.single().body)))
        assertEquals(4, body.getInt("expectedRevision"))
        assertEquals("link", body.getString("decision"))
        assertEquals("statement-1", body.getString("targetId"))
        assertEquals("event-1", body.getString("candidateTransactionId"))
        assertEquals("refund_of", body.getString("relation"))
        assertEquals(1234, body.getJSONObject("allocatedMoney").getInt("amountMinor"))
    }

    @Test
    fun malformedAckIsNotSuccess() = runTest {
        val repository = repository(ReviewHttpResponse(200, "{\"id\":\"event-1\",\"revision\":0}"))
        val badTimestamp = repository(ReviewHttpResponse(200, "{\"id\":\"event-1\",\"revision\":1,\"updatedAt\":\"not-a-date\"}"))

        assertTrue(runCatching {
            repository.reviewAlert("event-1", 0, ReviewDecision.KEEP_SEPARATE)
        }.exceptionOrNull() is ReviewResponseInvalid)
        assertTrue(runCatching {
            badTimestamp.reviewAlert("event-1", 0, ReviewDecision.KEEP_SEPARATE)
        }.exceptionOrNull() is ReviewResponseInvalid)
    }

    @Test
    fun revisionConflictPreservesCurrentRevisionFromWorker() = runTest {
        val repository = repository(
            ReviewHttpResponse(409, "{\"code\":\"revision_conflict\",\"message\":\"changed\",\"currentRevision\":9}"),
        )

        val error = runCatching {
            repository.reviewAlert("event-1", 4, ReviewDecision.IGNORE)
        }.exceptionOrNull()

        assertEquals(9, (error as ReviewRevisionConflict).currentRevision)
    }

    @Test
    fun annotationActionUsesTheExistingOwnerScopedEndpointAndExpectedRevision() = runTest {
        val requests = mutableListOf<MobileRequest>()
        val repository = repository(ReviewHttpResponse(200, ackJson("event-1", 3)), requests)

        repository.annotateTransaction("event-1", 2, "Food", "Updated from Review")

        val request = requests.single()
        assertEquals("PATCH", request.method)
        assertEquals("event-1", request.url.substringAfterLast("/transactions/").substringBefore("/annotation"))
        val body = JSONObject(String(requireNotNull(request.body)))
        assertEquals(2, body.getInt("expectedRevision"))
        assertEquals("Food", body.getString("category"))
        assertEquals("Updated from Review", body.getString("note"))
    }

    private fun repository(
        response: ReviewHttpResponse,
        requests: MutableList<MobileRequest> = mutableListOf(),
    ): HttpWorkerReviewRepository = HttpWorkerReviewRepository(
        origin = ORIGIN,
        environment = "sandbox",
        ownerCredentials = object : OwnerCredentialProvider {
            override suspend fun accessToken(): String = "owner-token"
        },
        transport = ReviewHttpTransport { request ->
            requests += request
            response
        },
    )

    private companion object {
        const val ORIGIN = "https://pf.example.com"

        fun alertPageJson() = """
            {
              "items":[
                {
                  "eventId":"11111111-1111-4111-8111-111111111111",
                  "eventType":"purchase_notice",
                  "state":"needs_review",
                  "countedMoney":{"currency":"CAD","amountMinor":1234},
                  "affectedMoney":{"currency":"CAD","amountMinor":1234},
                  "reportingDate":"2026-10-14",
                  "revision":4,
                  "reasonCodes":["unresolved_time"],
                  "sourceEvidence":{
                    "sourceProfileId":"source-boc",
                    "parserVersion":"parser-test-1",
                    "eventTimeBasis":"notification_posted",
                    "capturedAt":"2026-10-14T12:00:00Z",
                    "notificationPostedAt":"2026-10-14T11:59:00Z",
                    "bankReference":null,
                    "merchant":"Synthetic merchant",
                    "eventMoney":{"currency":"CAD","amountMinor":1234}
                  },
                  "provenance":[{"sourceKind":"alert","sourceId":"event-1","basis":"alert_event","revision":1}],
                  "candidates":[{
                    "id":"candidate-1",
                    "statementTransactionId":"review-statement-row",
                    "candidateTransactionId":"event-1",
                    "score":95,
                    "reasonCodes":["same_amount","same_currency"],
                    "status":"open",
                    "evidenceBasis":"candidate_rank",
                    "relation":"confirms",
                    "targetTransaction":{
                      "id":"review-statement-row",
                      "date":"2026-10-14",
                      "merchant":"Synthetic merchant",
                      "amountMinor":-1234,
                      "currency":"CAD",
                      "kind":"expense",
                      "status":"confirmed",
                      "source":"statement"
                    }
                  }],
                  "links":[],
                  "linkAction":{
                    "targetId":"review-statement-row",
                    "candidateTransactionId":"event-1",
                    "relation":"confirms",
                    "allocatedMoney":null
                  },
                  "linkDisabledReason":null,
                  "transactionId":"event-1",
                  "annotation":{
                    "transactionId":"event-1",
                    "expectedRevision":2,
                    "category":"Travel",
                    "note":"Review this category"
                  },
                  "annotationDisabledReason":null
                }
              ],
              "page":{"nextCursor":"next","limit":1}
            }
        """.trimIndent()

        fun ackJson(id: String, revision: Int) = """
            {"id":"$id","revision":$revision,"updatedAt":"2026-10-14T12:00:00Z"}
        """.trimIndent()

        fun candidateJson(index: Int) = """
            {
              "id":"candidate-$index",
              "statementTransactionId":"statement-$index",
              "candidateTransactionId":"event-$index",
              "score":95,
              "reasonCodes":["same_amount"],
              "status":"open",
              "evidenceBasis":"candidate_rank",
              "relation":"confirms",
              "targetTransaction":{
                "id":"statement-$index",
                "date":"2026-10-14",
                "merchant":"Synthetic merchant",
                "amountMinor":-1234,
                "currency":"CAD",
                "kind":"expense",
                "status":"confirmed",
                "source":"statement"
              }
            }
        """.trimIndent()
    }
}
