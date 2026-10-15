package com.lofuyu.borderledger.parser

import com.lofuyu.borderledger.capture.ObservedBankMessage
import com.lofuyu.borderledger.capture.SourceProfile

/**
 * Fail-closed parser for source profiles that have no independently verified
 * notification capability. It deliberately emits no event or money.
 */
class UnsupportedSourceParser : BankAlertParser {
    override fun parse(message: ObservedBankMessage, profile: SourceProfile): ParseResult =
        ParseResult.NeedsReview(
            observationId = message.observationId,
            reasons = listOf(ParseReviewReason.UNSUPPORTED_SOURCE),
            event = null,
        )
}
