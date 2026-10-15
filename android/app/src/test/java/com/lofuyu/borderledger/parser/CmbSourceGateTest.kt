package com.lofuyu.borderledger.parser

import com.lofuyu.borderledger.capture.MutableSourceProfileRegistry
import com.lofuyu.borderledger.capture.SourceProfile
import com.lofuyu.borderledger.capture.SourceProfileKind
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CmbSourceGateTest {
    @Test
    fun cmbProfileIsExplicitlyDisabledAndNeverApprovedByRegistry() {
        val profile = SourceProfile.disabledCmbCreditCard()
        val registry = MutableSourceProfileRegistry().apply { register(profile) }

        assertEquals(SourceProfileKind.CMB_UNSUPPORTED, profile.sourceKind)
        assertFalse(profile.approved)
        assertTrue(profile.displayName.contains("unsupported", ignoreCase = true))
        assertTrue(registry.approvedProfiles().contains(profile))
        assertNull(registry.profileFor(SyntheticNotificationFixtures.snapshot(
            packageName = profile.packageName,
            sourceProfileId = profile.sourceProfileId,
            channelId = profile.channelId,
            sender = null,
        )))
    }

    @Test
    fun cmbLabeledObservationIsReviewOnlyWithNoMoneyAndNoBocParser() {
        val profile = SourceProfile.disabledCmbCreditCard().copy(approved = true)
        val message = SyntheticNotificationFixtures.observed(
            profile = profile,
            body = "交易提醒\n消费\n交易金额: CAD 12.34\n商户名称: Synthetic Market",
        )

        val result = SourceParserRegistry.parserFor(profile).parse(message, profile)

        assertFalse(SourceParserRegistry.parserFor(profile) is BocCreditCardParser)
        assertTrue(result is ParseResult.NeedsReview)
        val review = result as ParseResult.NeedsReview
        assertTrue(review.reasons.contains(ParseReviewReason.UNSUPPORTED_SOURCE))
        assertNull(review.event)
    }

    @Test
    fun genericObservationWithCmbLabelDoesNotBecomeBocCharge() {
        val profile = SourceProfile.disabledCmbCreditCard().copy(approved = true)
        val message = SyntheticNotificationFixtures.observed(
            profile = profile,
            contentCapability = com.lofuyu.borderledger.capture.NotificationContentCapability.GENERIC_OS_NOTIFICATION,
            body = "CMB notification CAD 99.99",
        )

        val result = SourceParserRegistry.parserFor(profile).parse(message, profile)

        assertTrue(result is ParseResult.NeedsReview)
        val review = result as ParseResult.NeedsReview
        assertTrue(review.reasons.contains(ParseReviewReason.UNSUPPORTED_SOURCE))
        assertNull(review.event)
    }
}
