package com.lofuyu.borderledger.parser

private val CANONICAL_UUID_PATTERN = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

data class Money(
    val currency: String,
    val amountMinor: Long,
) {
    init {
        require(CurrencyRegistry().metadata(currency) != null) { "Currency must be registered." }
        require(amountMinor > 0L) { "Money amount must be positive." }
    }
}

enum class MoneyRole(val wireValue: String) {
    TRANSACTION("transaction"),
    AUTHORIZATION("authorization"),
    BILLING("billing"),
    FEE("fee"),
}

data class MoneyComponent(
    val role: MoneyRole,
    val currency: String,
    val amountMinor: Long,
) {
    init {
        require(CurrencyRegistry().metadata(currency) != null) { "Currency must be registered." }
        require(amountMinor > 0L) { "Money component amount must be positive." }
    }
}

enum class BankAlertEventType(val wireValue: String) {
    PURCHASE_NOTICE("purchase_notice"),
    AUTHORIZATION_REVERSAL("authorization_reversal"),
    DECLINED("declined"),
    REFUND_NOTICE("refund_notice"),
    HOLD_NOTICE("hold_notice"),
    ADJUSTMENT_NOTICE("adjustment_notice"),
    REPAYMENT_NOTICE("repayment_notice"),
    TRANSFER_NOTICE("transfer_notice"),
    FEE_NOTICE("fee_notice"),
    UNKNOWN("unknown"),
}

enum class MoneyDirection(val wireValue: String) {
    OUTFLOW("outflow"),
    INFLOW("inflow"),
    NONE("none"),
    UNKNOWN("unknown"),
}

enum class FeeTreatment(val wireValue: String) {
    INCLUDED("included"),
    SEPARATE("separate"),
    UNKNOWN("unknown"),
}

enum class EventTimeBasis(val wireValue: String) {
    NOTIFICATION_POSTED("notification_posted"),
    BANK_TRANSACTION_DATE("bank_transaction_date"),
    STATEMENT_POSTING_DATE("statement_posting_date"),
    UNRESOLVED("unresolved"),
}

enum class EventTimePrecision(val wireValue: String) {
    MILLISECOND("millisecond"),
    DATE("date"),
    UNKNOWN("unknown"),
}

enum class BankTimePrecision(val wireValue: String) {
    MINUTE("minute"),
    SECOND("second"),
    DATE("date"),
    UNKNOWN("unknown"),
}

enum class BankYearProvenance(val wireValue: String) {
    EXPLICIT("explicit"),
    INFERRED("inferred"),
    TWO_DIGIT("two_digit"),
    MISSING("missing"),
}

enum class InstrumentHintKind(val wireValue: String) {
    CARD_SUFFIX("card_suffix"),
    ACCOUNT_HINT("account_hint"),
    SOURCE_REFERENCE("source_reference"),
}

data class InstrumentHint(
    val kind: InstrumentHintKind,
    val value: String,
)

data class BankDisplayedTime(
    val localDateTime: String?,
    val zone: String?,
    val precision: BankTimePrecision,
    val yearProvenance: BankYearProvenance,
)

data class EventCompleteness(
    val individualTimestamp: Boolean,
    val supportedSource: Boolean,
    val labeledMoney: Boolean,
)

/** Kotlin representation of Task 2's v1 BankAlertEventInput contract. */
data class BankAlertEventInput(
    val schemaVersion: Int = 1,
    val eventId: String,
    val observationId: String,
    val sourceProfileId: String,
    val parserVersion: String,
    val notificationPostedAt: String?,
    val capturedAt: String,
    val eventTimeBasis: EventTimeBasis,
    val eventType: BankAlertEventType,
    val direction: MoneyDirection,
    val instrumentHint: InstrumentHint?,
    val eventMoney: Money?,
    val primaryMoneyRole: MoneyRole?,
    val amounts: List<MoneyComponent>,
    val feeTreatment: FeeTreatment,
    val bankReference: String?,
    val bankDisplayedTime: BankDisplayedTime?,
    val merchant: String?,
    val completeness: EventCompleteness,
) {
    init {
        require(schemaVersion == 1) { "Only BankAlertEventInput schema version 1 is supported." }
        require(CANONICAL_UUID_PATTERN.matches(eventId)) { "Event identity must be a canonical UUID." }
        require(observationId.isNotBlank()) { "Observation identity is required." }
        require(sourceProfileId.isNotBlank()) { "Source profile identity is required." }
        require(parserVersion.isNotBlank()) { "Parser version is required." }
        require(capturedAt.isNotBlank()) { "Capture time is required." }
        require(amounts.all { it.amountMinor > 0L && it.currency.length == 3 }) {
            "Money components must be positive bounded ISO-like scalars."
        }
        if (eventMoney != null) {
            require(eventMoney.amountMinor > 0L && eventMoney.currency.length == 3)
            require(primaryMoneyRole != null)
        }
        if (primaryMoneyRole != null && eventMoney != null) {
            require(amounts.any { it.role == primaryMoneyRole && it.currency == eventMoney.currency && it.amountMinor == eventMoney.amountMinor }) {
                "Primary event money must be represented by a matching component."
            }
        }
    }
}
