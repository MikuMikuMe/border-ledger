package com.lofuyu.borderledger.parser

import com.lofuyu.borderledger.capture.NotificationContentCapability
import com.lofuyu.borderledger.capture.ObservationDisposition
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures.bocProfile
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures.observed
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures.syntheticEventIdProvider
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.nio.file.Files
import java.nio.file.Path
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyntheticBocCreditCardParserTest {
    private val parser = BocCreditCardParser(eventIdProvider = syntheticEventIdProvider())
    private val profile = bocProfile()

    @Test
    fun parsesRepresentativeIsoCurrenciesAsExplicitMinorUnits() {
        val cases = listOf(
            "交易提醒\n消费\n交易金额: CAD 12.34" to 1_234L,
            "交易提醒\n消费\n交易金额: 人民币 １２３．４５" to 12_345L,
            "Transaction purchase\nPurchase amount: USD 9.99" to 999L,
            "交易提醒\n消费\n交易金额: 港币 10.00" to 1_000L,
            "交易提醒\n消费\n交易金额: EUR 12.34" to 1_234L,
        )

        cases.forEachIndexed { index, (body, expectedMinor) ->
            val result = parser.parse(
                observed(body = body, messageIdentity = "currency-$index"),
                profile,
            )

            assertTrue("currency case $index should be complete", result is ParseResult.Complete)
            val event = (result as ParseResult.Complete).event
            assertEquals(expectedMinor, event.eventMoney?.amountMinor)
            assertTrue(UUID_PATTERN.matches(event.eventId))
        }
    }

    @Test
    fun parsesNonCadCnyWechatStyleBocNotificationWithoutLosingIsoCode() {
        val result = parser.parse(
            observed(
                body = "微信支付\n中国银行信用卡\n交易提醒\n消费\n交易金额: EUR 12.34\n商户名称: Paris Market",
                messageIdentity = "wechat-eur",
            ),
            profile,
        )

        assertTrue(result is ParseResult.Complete)
        val event = (result as ParseResult.Complete).event
        assertEquals(Money("EUR", 1_234L), event.eventMoney)
        assertEquals("EUR", event.amounts.single().currency)
    }

    @Test
    fun fullWidthCurrencyLettersAndQualifiedSymbolsAreNormalizedDeliberately() {
        val cases = listOf(
            "交易提醒\n消费\n交易金额: ＣＡＤ １２．３４" to 1_234L,
            "交易提醒\n消费\n交易金额: ＵＳ＄ 9.99" to 999L,
            "交易提醒\n消费\n交易金额: ＣＮ￥ １２．３４" to 1_234L,
        )

        cases.forEachIndexed { index, (body, expectedMinor) ->
            val result = parser.parse(observed(body = body, messageIdentity = "full-width-$index"), profile)
            assertTrue("full-width case $index should be complete", result is ParseResult.Complete)
            assertEquals(expectedMinor, (result as ParseResult.Complete).event.eventMoney?.amountMinor)
        }
    }

    @Test
    fun matchingLeadingAndTrailingCurrenciesAndSingleValidTokensRemainComplete() {
        val cases = listOf(
            "交易提醒\n消费\n交易金额: CAD 12.00 CAD" to Money("CAD", 1_200L),
            "交易提醒\n消费\n交易金额: ＣＡＤ １２．００ ＣＡＤ" to Money("CAD", 1_200L),
            "交易提醒\n消费\n交易金额: 加元 12.00 CAD" to Money("CAD", 1_200L),
            "交易提醒\n消费\n交易金额: 12.00 USD" to Money("USD", 1_200L),
            "交易提醒\n消费\n交易金额: USD 12.00" to Money("USD", 1_200L),
        )

        cases.forEachIndexed { index, (body, expectedMoney) ->
            val result = parser.parse(observed(body = body, messageIdentity = "matching-currency-$index"), profile)
            assertTrue("matching currency case $index should be complete", result is ParseResult.Complete)
            assertEquals(expectedMoney, (result as ParseResult.Complete).event.eventMoney)
        }
    }

    @Test
    fun mismatchedLeadingAndTrailingCurrenciesStayAmbiguousAfterNormalization() {
        val bodies = listOf(
            "交易提醒\n消费\n交易金额: CAD 12.00 USD",
            "交易提醒\n消费\n交易金额: ＣＡＤ １２．００ ＵＳＤ",
            "交易提醒\n消费\n交易金额: 加元 12.00 美元",
        )

        bodies.forEachIndexed { index, body ->
            val result = parser.parse(observed(body = body, messageIdentity = "mismatched-currency-$index"), profile)
            assertTrue("mismatched currency case $index should need review", result is ParseResult.NeedsReview)
            val review = result as ParseResult.NeedsReview
            assertTrue(review.reasons.contains(ParseReviewReason.AMBIGUOUS_CURRENCY))
            assertNull(review.event?.eventMoney)
            assertTrue(review.event?.amounts.orEmpty().isEmpty())
        }
    }

    @Test
    fun unknownCurrencyFormsStayExplicitlyAmbiguous() {
        listOf(
            "交易提醒\n消费\n交易金额: ZZZ 12.34",
            "交易提醒\n消费\n交易金额: $ 12.34",
            "交易提醒\n消费\n交易金额: ＄ 12.34",
            "交易提醒\n消费\n交易金额: ¥ 12.34",
            "交易提醒\n消费\n交易金额: ￥ 12.34",
            "交易提醒\n消费\n交易金额: € 12.34",
            "交易提醒\n消费\n交易金额: £ 12.34",
            "交易提醒\n消费\n交易金额: ﹩ 12.34",
        ).forEachIndexed { index, body ->
            val result = parser.parse(observed(body = body, messageIdentity = "unknown-currency-$index"), profile)
            assertTrue(result is ParseResult.NeedsReview)
            val review = result as ParseResult.NeedsReview
            assertTrue(review.reasons.contains(ParseReviewReason.AMBIGUOUS_CURRENCY))
            assertNull(review.event?.eventMoney)
            assertTrue(review.event?.amounts.orEmpty().isEmpty())
        }
    }

    @Test
    fun everyContractCurrencyIsAcceptedWithItsDeclaredMinorUnitScale() {
        val contractCurrencies = loadContractCurrencies()
        val androidCurrencies = CurrencyRegistry.DEFAULT_ENTRIES.mapValues { (_, metadata) -> metadata.minorUnitDigits }

        assertEquals(contractCurrencies, androidCurrencies)

        contractCurrencies.forEach { (code, minorUnitDigits) ->
            val (rawAmount, expectedMinor) = when (minorUnitDigits) {
                0 -> "100" to 100L
                1 -> "1.2" to 12L
                2 -> "1.23" to 123L
                3 -> "1.234" to 1_234L
                else -> error("Unsupported contract scale for $code: $minorUnitDigits")
            }
            val result = parser.parse(
                observed(
                    body = "交易提醒\n消费\n交易金额: $code $rawAmount",
                    messageIdentity = "contract-currency-$code",
                ),
                profile,
            )

            assertTrue("$code should be accepted at scale $minorUnitDigits", result is ParseResult.Complete)
            assertEquals(Money(code, expectedMinor), (result as ParseResult.Complete).event.eventMoney)
        }
    }

    @Test
    fun preservesOriginalPostedTimeSeparatelyFromCaptureAndBankDisplayedTime() {
        val posted = Instant.parse("2026-10-13T04:00:00Z").toEpochMilli()
        val captured = Instant.parse("2026-10-13T12:00:00Z").toEpochMilli()
        val result = parser.parse(
            observed(
                body = "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2026-10-12 23:00",
                messageIdentity = "time-case",
                postTime = posted,
                capturedAt = captured,
            ),
            profile,
        )

        assertTrue(result is ParseResult.Complete)
        val event = (result as ParseResult.Complete).event
        assertEquals(Instant.ofEpochMilli(posted).toString(), event.notificationPostedAt)
        assertEquals(Instant.ofEpochMilli(captured).toString(), event.capturedAt)
        assertEquals(EventTimeBasis.NOTIFICATION_POSTED, event.eventTimeBasis)
        assertEquals("2026-10-12 23:00", event.bankDisplayedTime?.localDateTime)
    }

    @Test
    fun missingIndividualTimeCannotBorrowCapturedOrBankDisplayedTime() {
        val result = parser.parse(
            observed(
                body = "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2026-10-12 23:00",
                messageIdentity = "summary-child-without-time",
                postTime = 0L,
                individualTimestampVerified = false,
            ),
            profile,
        )

        assertTrue(result is ParseResult.NeedsReview)
        val review = result as ParseResult.NeedsReview
        assertTrue(review.reasons.contains(ParseReviewReason.UNRESOLVED_TIME))
        assertNull(review.event?.notificationPostedAt)
        assertEquals(EventTimeBasis.UNRESOLVED, review.event?.eventTimeBasis)
        assertNotNull(review.event?.capturedAt)
        assertEquals("2026-10-12 23:00", review.event?.bankDisplayedTime?.localDateTime)
    }

    @Test
    fun genericAndScreenshotOnlyRichContentStayUnsupportedAndCarryNoRawBody() {
        val generic = parser.parse(
            observed(
                body = "raw screenshot-only merchant CAD 999.99",
                messageIdentity = "generic",
                contentCapability = NotificationContentCapability.GENERIC_OS_NOTIFICATION,
            ),
            profile,
        )
        val screenshot = parser.parse(
            observed(
                body = "raw screenshot-only merchant CAD 999.99",
                messageIdentity = "screenshot",
                contentCapability = NotificationContentCapability.SCREENSHOT_ONLY_RICH_CONTENT,
            ),
            profile,
        )

        listOf(generic, screenshot).forEach { result ->
            assertTrue(result is ParseResult.NeedsReview)
            val review = result as ParseResult.NeedsReview
            assertTrue(review.reasons.contains(ParseReviewReason.UNSUPPORTED_NOTIFICATION_CONTENT))
            assertNull(review.event?.eventMoney)
            assertFalse(review.event.toString().contains("raw screenshot-only"))
        }
    }

    @Test
    fun evaluatesTypeBeforeMoneyAndDoesNotGuessUnknownTypeFromAnAmount() {
        val result = parser.parse(
            observed(
                body = "交易金额: CAD 12.34\n余额: CAD 900.00\n可用额度: CAD 8000.00",
                messageIdentity = "unknown-type",
            ),
            profile,
        )

        assertTrue(result is ParseResult.NeedsReview)
        val review = result as ParseResult.NeedsReview
        assertTrue(review.reasons.contains(ParseReviewReason.UNKNOWN_EVENT_TYPE))
        assertNull(review.event?.eventMoney)
        assertTrue(review.event?.amounts.orEmpty().isEmpty())
    }

    @Test
    fun balancesLimitsAndFxAmountsNeverBecomeTransactionMoney() {
        val result = parser.parse(
            observed(
                body = "交易提醒\n消费\n余额: CAD 999.99\n可用额度: CAD 8000.00\n汇率: USD 1.20\n交易金额: CAD 12.34",
                messageIdentity = "labeled-money",
            ),
            profile,
        )

        assertTrue(result is ParseResult.Complete)
        val event = (result as ParseResult.Complete).event
        assertEquals(Money("CAD", 1_234L), event.eventMoney)
        assertEquals(1, event.amounts.size)
        assertEquals(MoneyRole.TRANSACTION, event.amounts.single().role)
    }

    @Test
    fun merchantTextDoesNotTurnCoffeeIntoAFeeTemplate() {
        val result = parser.parse(
            observed(
                body = "交易提醒\n消费\n交易金额: CAD 12.34\n商户名称: Coffee",
                messageIdentity = "coffee-merchant",
            ),
            profile,
        )

        assertTrue(result is ParseResult.Complete)
        val event = (result as ParseResult.Complete).event
        assertEquals(BankAlertEventType.PURCHASE_NOTICE, event.eventType)
        assertEquals(MoneyRole.TRANSACTION, event.primaryMoneyRole)
    }

    @Test
    fun everyFinancialEventWithoutItsLabeledPrimaryMoneyStaysReviewAndZeroImpact() {
        val cases = listOf(
            "交易提醒\n消费" to BankAlertEventType.PURCHASE_NOTICE,
            "撤销" to BankAlertEventType.AUTHORIZATION_REVERSAL,
            "交易失败提醒" to BankAlertEventType.DECLINED,
            "退款通知" to BankAlertEventType.REFUND_NOTICE,
            "预授权提醒" to BankAlertEventType.HOLD_NOTICE,
            "还款通知" to BankAlertEventType.REPAYMENT_NOTICE,
            "转账通知" to BankAlertEventType.TRANSFER_NOTICE,
            "手续费通知" to BankAlertEventType.FEE_NOTICE,
            "调整通知" to BankAlertEventType.ADJUSTMENT_NOTICE,
        )

        cases.forEachIndexed { index, (body, expectedType) ->
            val result = parser.parse(observed(body = body, messageIdentity = "missing-money-$index"), profile)
            assertTrue("missing-money case $index should need review", result is ParseResult.NeedsReview)
            val event = (result as ParseResult.NeedsReview).event
            assertEquals(expectedType, event?.eventType)
            assertNull(event?.eventMoney)
            assertEquals(false, event?.completeness?.labeledMoney)
            assertTrue((result as ParseResult.NeedsReview).reasons.contains(ParseReviewReason.UNRESOLVED_MONEY))
        }
    }

    @Test
    fun declinedAndHoldWithMissingMoneyRemainConservativeZeroImpact() {
        val declined = parser.parse(observed(body = "交易失败提醒", messageIdentity = "declined-without-money"), profile)
        val hold = parser.parse(observed(body = "预授权提醒", messageIdentity = "hold-without-money"), profile)

        assertTrue(declined is ParseResult.NeedsReview)
        assertEquals(MoneyDirection.NONE, (declined as ParseResult.NeedsReview).event?.direction)
        assertTrue(hold is ParseResult.NeedsReview)
        assertEquals(MoneyDirection.NONE, (hold as ParseResult.NeedsReview).event?.direction)
    }

    @Test
    fun unknownSymbolScaleAndOverflowBecomeReviewInsteadOfUnsafeMoney() {
        val bodies = listOf(
            "交易提醒\n消费\n交易金额: $ 12.34" to ParseReviewReason.AMBIGUOUS_CURRENCY,
            "交易提醒\n消费\n交易金额: CAD 12.345" to ParseReviewReason.INVALID_MONEY,
            "交易提醒\n消费\n交易金额: CAD 9007199254740992.00" to ParseReviewReason.INVALID_MONEY,
        )

        bodies.forEach { (body, reason) ->
            val result = parser.parse(observed(body = body, messageIdentity = body), profile)
            assertTrue(result is ParseResult.NeedsReview)
            assertTrue((result as ParseResult.NeedsReview).reasons.contains(reason))
            assertNull(result.event?.eventMoney)
        }
    }

    @Test
    fun failureAndCancellationAreZeroImpactLifecycleEvents() {
        val failed = parser.parse(
            observed(body = "交易失败提醒\n交易金额: CAD 12.34", messageIdentity = "failed"),
            profile,
        )
        val cancelled = parser.parse(
            observed(body = "交易提醒\n撤销\n撤销金额: CAD 12.34", messageIdentity = "cancelled"),
            profile,
        )

        assertTrue(failed is ParseResult.Complete)
        assertEquals(BankAlertEventType.DECLINED, (failed as ParseResult.Complete).event.eventType)
        assertEquals(MoneyDirection.NONE, failed.event.direction)
        assertTrue(cancelled is ParseResult.Complete)
        assertEquals(BankAlertEventType.AUTHORIZATION_REVERSAL, (cancelled as ParseResult.Complete).event.eventType)
        assertEquals(MoneyDirection.NONE, cancelled.event.direction)
    }

    @Test
    fun refundHoldFeeAndTransferKeepExplicitTypeDirectionAndRole() {
        val refund = parser.parse(observed(body = "退款通知\n退款金额: CAD 3.00", messageIdentity = "refund"), profile)
        val hold = parser.parse(observed(body = "预授权提醒\n授权金额: USD 5.00", messageIdentity = "hold"), profile)
        val fee = parser.parse(observed(body = "手续费通知\n手续费: CAD 1.00", messageIdentity = "fee"), profile)
        val transfer = parser.parse(observed(body = "转账通知\n交易金额: CAD 10.00", messageIdentity = "transfer"), profile)

        assertEquals(BankAlertEventType.REFUND_NOTICE, (refund as ParseResult.Complete).event.eventType)
        assertEquals(MoneyDirection.INFLOW, refund.event.direction)
        assertEquals(BankAlertEventType.HOLD_NOTICE, (hold as ParseResult.Complete).event.eventType)
        assertEquals(MoneyRole.AUTHORIZATION, hold.event.primaryMoneyRole)
        assertEquals(BankAlertEventType.FEE_NOTICE, (fee as ParseResult.Complete).event.eventType)
        assertEquals(MoneyRole.FEE, fee.event.primaryMoneyRole)
        assertEquals(BankAlertEventType.TRANSFER_NOTICE, (transfer as ParseResult.Complete).event.eventType)
        assertEquals(MoneyDirection.NONE, transfer.event.direction)
    }

    @Test
    fun injectedZeroAndThreeDecimalCurrenciesUseTheirRegistryMetadata() {
        val registry = CurrencyRegistry(
            mapOf(
                "CAD" to CurrencyMeta("CAD", 2),
                "JPY" to CurrencyMeta("JPY", 0),
                "TND" to CurrencyMeta("TND", 3),
            ),
        )
        val customParser = BocCreditCardParser(registry, syntheticEventIdProvider())
        val customProfile = profile.copy(allowedCurrencies = setOf("JPY", "TND"))

        val zero = customParser.parse(observed(body = "交易提醒\n消费\n交易金额: JPY 100", messageIdentity = "jpy"), customProfile)
        val three = customParser.parse(observed(body = "交易提醒\n消费\n交易金额: TND 1.234", messageIdentity = "tnd"), customProfile)

        assertEquals(100L, (zero as ParseResult.Complete).event.eventMoney?.amountMinor)
        assertEquals(1_234L, (three as ParseResult.Complete).event.eventMoney?.amountMinor)
    }

    @Test
    fun defaultRegistrySupportsZeroAndThreeDecimalIsoCurrencies() {
        val zero = parser.parse(
            observed(body = "交易提醒\n消费\n交易金额: JPY 100", messageIdentity = "default-jpy"),
            profile,
        )
        val three = parser.parse(
            observed(body = "交易提醒\n消费\n交易金额: TND 1.234", messageIdentity = "default-tnd"),
            profile,
        )

        assertEquals(Money("JPY", 100L), (zero as ParseResult.Complete).event.eventMoney)
        assertEquals(Money("TND", 1_234L), (three as ParseResult.Complete).event.eventMoney)
    }

    @Test
    fun missingInstrumentAndAmbiguousDuplicateStayReviewable() {
        val noInstrument = parser.parse(
            observed(profile = profile.copy(instrumentHint = null), messageIdentity = "no-instrument"),
            profile.copy(instrumentHint = null),
        )
        assertTrue(noInstrument is ParseResult.NeedsReview)
        assertTrue((noInstrument as ParseResult.NeedsReview).reasons.contains(ParseReviewReason.UNRESOLVED_INSTRUMENT))

        val tracker = com.lofuyu.borderledger.capture.ObservationTracker(
            activatedAtMillis = Instant.parse("2026-10-01T00:00:00Z").toEpochMilli(),
        ) { Instant.parse("2026-10-13T12:00:00Z").toEpochMilli() }
        val first = observed(messageIdentity = null, key = "duplicate-a")
        val second = observed(messageIdentity = null, key = "duplicate-b")
        tracker.diff(listOf(first))
        val ambiguous = tracker.diff(listOf(second)).reviewObservations.single()
        val review = parser.parse(ambiguous.copy(observationDisposition = ObservationDisposition.POSSIBLE_DUPLICATE_REVIEW), profile)
        assertTrue(review is ParseResult.NeedsReview)
        assertTrue((review as ParseResult.NeedsReview).reasons.contains(ParseReviewReason.POSSIBLE_DUPLICATE))
    }

    @Test
    fun suppliedEventIdIsAUuidAndRemainsTheSameAcrossParserRetries() {
        val suppliedId = "00000000-0000-4000-8000-000000000006"
        val retryParser = BocCreditCardParser(eventIdProvider = EventIdProvider { suppliedId })
        val message = observed(messageIdentity = "retry-event")

        val first = retryParser.parse(message, profile)
        val retry = retryParser.parse(message.copy(capturedAtMillis = message.capturedAtMillis + 10_000L), profile)

        assertTrue(first is ParseResult.Complete)
        assertTrue(retry is ParseResult.Complete)
        assertEquals(suppliedId, (first as ParseResult.Complete).event.eventId)
        assertEquals(suppliedId, (retry as ParseResult.Complete).event.eventId)
        assertTrue(UUID_PATTERN.matches(suppliedId))
    }

    @Test
    fun invalidBankDisplayedDateAndTimeRangesNeedReviewAndAreNotEmitted() {
        val bodies = listOf(
            "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2023-02-29 12:00",
            "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2024-02-30 12:00",
            "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2026-13-01 12:00",
            "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2026-10-13 24:00",
        )

        bodies.forEachIndexed { index, body ->
            val result = parser.parse(observed(body = body, messageIdentity = "invalid-bank-time-$index"), profile)
            assertTrue("invalid bank time case $index should need review", result is ParseResult.NeedsReview)
            val review = result as ParseResult.NeedsReview
            assertTrue(review.reasons.contains(ParseReviewReason.INVALID_BANK_DISPLAYED_TIME))
            assertNull(review.event?.bankDisplayedTime)
        }
    }

    @Test
    fun validLeapDayAndSecondPrecisionArePreserved() {
        val result = parser.parse(
            observed(
                body = "交易提醒\n消费\n交易金额: CAD 12.34\n交易时间: 2024-02-29 23:59:59",
                messageIdentity = "valid-leap-day",
            ),
            profile,
        )

        assertTrue(result is ParseResult.Complete)
        assertEquals("2024-02-29 23:59:59", (result as ParseResult.Complete).event.bankDisplayedTime?.localDateTime)
    }

    companion object {
        private val UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

        private fun loadContractCurrencies(): Map<String, Int> {
            val contractPath = generateSequence(Path.of("").toAbsolutePath()) { it.parent }
                .map { it.resolve("contracts/currencies.json") }
                .firstOrNull { Files.isRegularFile(it) }
                ?: error("Could not locate contracts/currencies.json from the test working directory.")
            val entryPattern = Regex("""\{\s*"code"\s*:\s*"([A-Z]{3})"\s*,\s*"minorUnitDigits"\s*:\s*([0-3])\s*\}""")
            val entries = entryPattern.findAll(String(Files.readAllBytes(contractPath), StandardCharsets.UTF_8)).associate { match ->
                match.groupValues[1] to match.groupValues[2].toInt()
            }
            require(entries.isNotEmpty()) { "contracts/currencies.json contained no currency entries." }
            return entries
        }
    }
}
