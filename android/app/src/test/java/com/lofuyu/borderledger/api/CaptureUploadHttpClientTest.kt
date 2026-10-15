package com.lofuyu.borderledger.api

import com.lofuyu.borderledger.auth.CaptureCredentialProvider
import com.lofuyu.borderledger.auth.CaptureCredentialRecord
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.parser.BankAlertEventInput
import com.lofuyu.borderledger.parser.BankAlertEventType
import com.lofuyu.borderledger.parser.EventCompleteness
import com.lofuyu.borderledger.parser.EventTimeBasis
import com.lofuyu.borderledger.parser.FeeTreatment
import com.lofuyu.borderledger.parser.Money
import com.lofuyu.borderledger.parser.MoneyComponent
import com.lofuyu.borderledger.parser.MoneyDirection
import com.lofuyu.borderledger.parser.MoneyRole
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class CaptureUploadHttpClientTest {
    @Test
    fun alertEventMoneyRejectsUnknownCurrencyCodes() {
        assertThrows(IllegalArgumentException::class.java) { event(currency = "XYZ") }
    }

    @Test
    fun http200PerItemConflictIsParsedAsAStableQuarantineableAck() = runTest {
        val client = client(CaptureHttpResponse(
            200,
            """
            {"acks":[{"eventId":"${EVENT_ID}","status":"conflict","receiptId":null,"revision":null,"projectionState":null,"reasonCodes":["idempotency_conflict"],"error":{"code":"idempotency_conflict","message":"different immutable content","retryable":false}}]}
            """.trimIndent().encodeToByteArray(),
        ))

        val result = client.upload(listOf(event()))
        val ack = (result as CaptureUploadResult.Success).acknowledgements.single()

        assertEquals("conflict", ack.status)
        assertEquals("idempotency_conflict", ack.reasonCodes.single())
        assertEquals("idempotency_conflict", ack.errorCode)
    }

    @Test
    fun httpClassificationPreservesRetryAfterAndCredentialPause() = runTest {
        val rateLimited = client(CaptureHttpResponse(429, ByteArray(0), mapOf("Retry-After" to "42")))
        val retry = rateLimited.upload(listOf(event())) as CaptureUploadResult.Retryable
        assertEquals("rate_limited", retry.code)
        assertEquals(42L, retry.retryAfterSeconds)

        val unauthorized = client(CaptureHttpResponse(401, ByteArray(0)))
        assertTrue(unauthorized.upload(listOf(event())) is CaptureUploadResult.PairingRequired)

        val server = client(CaptureHttpResponse(503, ByteArray(0)))
        assertTrue(server.upload(listOf(event())) is CaptureUploadResult.Retryable)
    }

    @Test
    fun malformedSuccessResponseIsRetryableAndDoesNotPretendToAck() = runTest {
        val client = client(CaptureHttpResponse(200, "not-json".encodeToByteArray()))
        val result = client.upload(listOf(event()))
        assertEquals("malformed_response", (result as CaptureUploadResult.Retryable).code)
    }

    private fun client(response: CaptureHttpResponse): HttpWorkerCaptureUploadClient =
        HttpWorkerCaptureUploadClient(
            origin = "https://pf.lofuyu.com",
            environment = "sandbox",
            captureCredentials = FakeCaptureCredentials(),
            transport = object : CaptureHttpTransport {
                override suspend fun execute(request: MobileRequest): CaptureHttpResponse = response
            },
        )

    private fun event(currency: String = "CAD"): CaptureUploadEvent = CaptureUploadEvent(
        EVENT_ID,
        com.lofuyu.borderledger.local.BankAlertEventCodec.encode(
            BankAlertEventInput(
                eventId = EVENT_ID,
                observationId = "observation-1",
                sourceProfileId = "synthetic-boc-credit-card",
                parserVersion = "synthetic-1",
                notificationPostedAt = "2026-10-13T04:00:00Z",
                capturedAt = "2026-10-13T04:00:03Z",
                eventTimeBasis = EventTimeBasis.NOTIFICATION_POSTED,
                eventType = BankAlertEventType.PURCHASE_NOTICE,
                direction = MoneyDirection.OUTFLOW,
                instrumentHint = null,
                eventMoney = Money(currency, 1234L),
                primaryMoneyRole = MoneyRole.TRANSACTION,
                amounts = listOf(MoneyComponent(MoneyRole.TRANSACTION, currency, 1234L)),
                feeTreatment = FeeTreatment.INCLUDED,
                bankReference = null,
                bankDisplayedTime = null,
                merchant = "Synthetic Market",
                completeness = EventCompleteness(true, true, true),
            ),
        ),
    )

    private companion object {
        val EVENT_ID = UUID.fromString("11111111-1111-4111-8111-111111111111").toString()
    }
}

private class FakeCaptureCredentials : CaptureCredentialProvider {
    override suspend fun current() = CaptureCredentialRecord("capture", "device", 1, "2099-01-01T00:00:00Z", "revoke")
    override suspend fun save(value: CaptureCredentialRecord) = Unit
    override suspend fun clear() = Unit
}
