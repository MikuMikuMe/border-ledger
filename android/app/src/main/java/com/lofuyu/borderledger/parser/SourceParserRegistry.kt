package com.lofuyu.borderledger.parser

import com.lofuyu.borderledger.capture.SourceProfile
import com.lofuyu.borderledger.capture.SourceProfileKind
import java.util.UUID

/** Selects a parser only for a source kind with an independently verified adapter. */
object SourceParserRegistry {
    fun parserFor(profile: SourceProfile): BankAlertParser = parserFor(
        profile,
        EventIdProvider { UUID.randomUUID().toString() },
    )

    internal fun parserFor(profile: SourceProfile, eventIdProvider: EventIdProvider): BankAlertParser = when (profile.sourceKind) {
        SourceProfileKind.BOC_CREDIT_CARD -> BocCreditCardParser(CurrencyRegistry(), eventIdProvider)
        SourceProfileKind.CMB_UNSUPPORTED,
        SourceProfileKind.UNSUPPORTED,
        -> UnsupportedSourceParser()
    }
}
