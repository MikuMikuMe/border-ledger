package com.lofuyu.borderledger.parser

import com.lofuyu.borderledger.capture.ObservedBankMessage
import com.lofuyu.borderledger.capture.SourceProfile

/**
 * Supplies the immutable event UUID allocated by the capture persistence boundary.
 * The boundary allocates a random UUID before the first upload and returns that
 * same persisted value for every retry; parsers never derive an upload identity
 * from an observation fingerprint.
 */
fun interface EventIdProvider {
    fun eventIdFor(message: ObservedBankMessage): String
}

interface BankAlertParser {
    fun parse(message: ObservedBankMessage, profile: SourceProfile): ParseResult
}

enum class ParseReviewReason {
    UNSUPPORTED_SOURCE,
    UNSUPPORTED_NOTIFICATION_CONTENT,
    UNKNOWN_EVENT_TYPE,
    UNRESOLVED_TIME,
    UNRESOLVED_MONEY,
    INVALID_MONEY,
    AMBIGUOUS_CURRENCY,
    UNRESOLVED_INSTRUMENT,
    INVALID_DIRECTION,
    FEE_TREATMENT_UNKNOWN,
    INVALID_BANK_DISPLAYED_TIME,
    HISTORICAL_REVIEW,
    POSSIBLE_DUPLICATE,
    UNSTABLE_IDENTITY,
}

enum class ParseIgnoreReason {
    UNRELATED_SOURCE,
    UNAPPROVED_PROFILE,
    PRIVATE_OR_PROMOTIONAL_NOTIFICATION,
}

sealed interface ParseResult {
    val observationId: String
    val event: BankAlertEventInput?

    data class Complete(
        override val event: BankAlertEventInput,
    ) : ParseResult {
        override val observationId: String = event.observationId
    }

    data class NeedsReview(
        override val observationId: String,
        val reasons: List<ParseReviewReason>,
        override val event: BankAlertEventInput?,
    ) : ParseResult

    data class Ignored(
        override val observationId: String,
        val reason: ParseIgnoreReason,
    ) : ParseResult {
        override val event: BankAlertEventInput? = null
    }
}

