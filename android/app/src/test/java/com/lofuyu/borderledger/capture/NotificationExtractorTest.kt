package com.lofuyu.borderledger.capture

import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures.bocProfile
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures.snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationExtractorTest {
    private val extractor = NotificationExtractor()
    private val profile = bocProfile()

    @Test
    fun rejectsUnrelatedPackageBeforeAcceptingNotificationFields() {
        val result = extractor.extract(snapshot(packageName = "com.example.unrelated"), profile)

        assertTrue(result is ExtractionResult.Ignored)
        assertEquals(ExtractionIgnoreReason.UNRELATED_PACKAGE, (result as ExtractionResult.Ignored).reason)
    }

    @Test
    fun rejectsPrivateChatEvenWhenPackageChannelAndSenderMatch() {
        val result = extractor.extract(snapshot(isPrivate = true), profile)

        assertTrue(result is ExtractionResult.Ignored)
        assertEquals(ExtractionIgnoreReason.PRIVATE_CONVERSATION, (result as ExtractionResult.Ignored).reason)
    }

    @Test
    fun unknownConversationContextRequiresReviewBeforeFinancialParsing() {
        val result = extractor.extract(snapshot(isPrivate = null), profile)

        assertTrue(result is ExtractionResult.NeedsReview)
        assertEquals(
            ExtractionReviewReason.CONVERSATION_CONTEXT_UNKNOWN,
            (result as ExtractionResult.NeedsReview).reason,
        )
    }

    @Test
    fun rejectsMatchedBankSenderPromotionsAndOtpMessages() {
        val bodies = listOf(
            "优惠活动\n立即领取积分",
            "验证码 OTP 482901",
            "Promotion: earn bonus points",
        )

        bodies.forEach { body ->
            val result = extractor.extract(snapshot(body = body), profile)
            assertTrue("unexpected result for synthetic body", result is ExtractionResult.Ignored)
            assertEquals(ExtractionIgnoreReason.PROMOTION_OR_OTP, (result as ExtractionResult.Ignored).reason)
        }
    }

    @Test
    fun groupSummaryIsSkippedWhenChildrenAreAvailableAndChildOrderIsStable() {
        val children = listOf(
            NotificationMessageSnapshot("message-b", 1_700_000_002_000L, "Bank of China", "交易提醒 消费 交易金额: CAD 2.00"),
            NotificationMessageSnapshot("message-a", 1_700_000_001_000L, "Bank of China", "交易提醒 消费 交易金额: CAD 1.00"),
        )
        val result = extractor.extract(
            snapshot(
                body = "summary text that is never parsed",
                isSummary = true,
                groupKey = "group-1",
                children = children,
            ),
            profile,
        )

        assertTrue(result is ExtractionResult.Accepted)
        val messages = (result as ExtractionResult.Accepted).messages
        assertEquals(2, messages.size)
        assertEquals(listOf("message-a", "message-b"), messages.map { it.messageIdentity })
        assertTrue(messages.none { it.isGroupSummary })
    }

    @Test
    fun summaryWithoutIndividualChildrenIsReviewableWithoutBorrowingSummaryTime() {
        val result = extractor.extract(
            snapshot(isSummary = true, groupKey = "group-1", children = emptyList()),
            profile,
        )

        assertTrue(result is ExtractionResult.NeedsReview)
        val review = result as ExtractionResult.NeedsReview
        assertEquals(ExtractionReviewReason.SUMMARY_ONLY, review.reason)
        assertEquals(null, review.message?.notificationPostedAtMillis)
        assertEquals(true, review.message?.isGroupSummary)
    }

    @Test
    fun summaryWithOnlyFilteredChildrenNeverBecomesAnAcceptedParentMessage() {
        val result = extractor.extract(
            snapshot(
                body = "summary text that is never parsed",
                isSummary = true,
                groupKey = "group-1",
                children = listOf(
                    NotificationMessageSnapshot("other-message", 1_700_000_001_000L, "Unrelated Sender", "promotion"),
                ),
            ),
            profile,
        )

        assertTrue(result is ExtractionResult.NeedsReview)
        val review = result as ExtractionResult.NeedsReview
        assertEquals(ExtractionReviewReason.SUMMARY_ONLY, review.reason)
        assertEquals(null, review.message?.notificationPostedAtMillis)
        assertEquals(true, review.message?.isGroupSummary)
        assertEquals(null, review.message?.messageIdentity)
    }

    @Test
    fun copiesOnlyBoundedScalarsAndNeverRetainsUnboundedText() {
        val body = "A".repeat(NotificationExtractor.MAX_TEXT_CHARS + 100)
        val result = extractor.extract(snapshot(body = body), profile)

        assertTrue(result is ExtractionResult.Accepted)
        val message = (result as ExtractionResult.Accepted).messages.single()
        assertTrue(message.text.orEmpty().length <= NotificationExtractor.MAX_TEXT_CHARS)
        assertTrue(message.textLines.size <= NotificationExtractor.MAX_TEXT_LINES)
        assertTrue(message.textTruncated)
    }

    @Test
    fun missingSenderIsNeedsReviewRatherThanTreatingDisplayNameAsAuthentication() {
        val result = extractor.extract(snapshot(sender = null), profile)

        assertTrue(result is ExtractionResult.NeedsReview)
        assertEquals(ExtractionReviewReason.SENDER_UNAVAILABLE, (result as ExtractionResult.NeedsReview).reason)
    }
}
