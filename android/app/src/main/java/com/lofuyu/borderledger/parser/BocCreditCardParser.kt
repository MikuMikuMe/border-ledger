package com.lofuyu.borderledger.parser

import com.lofuyu.borderledger.capture.NotificationContentCapability
import com.lofuyu.borderledger.capture.ObservationDisposition
import com.lofuyu.borderledger.capture.ObservedBankMessage
import com.lofuyu.borderledger.capture.SourceProfile
import com.lofuyu.borderledger.capture.SourceProfileKind
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale

private data class ComponentParse(
    val components: List<MoneyComponent>,
    val failure: ParseReviewReason? = null,
)

/**
 * Synthetic BOC credit-card adapter. It accepts only an explicitly approved
 * SourceProfile and bounded accessible text; screenshots and generic OS text
 * are never interpreted as a richer bank template.
 */
class BocCreditCardParser(
    private val currencies: CurrencyRegistry = CurrencyRegistry(),
    private val eventIdProvider: EventIdProvider,
) : BankAlertParser {
    override fun parse(message: ObservedBankMessage, profile: SourceProfile): ParseResult {
        if (!profile.approved || profile.sourceKind != SourceProfileKind.BOC_CREDIT_CARD) {
            return ParseResult.Ignored(message.observationId, ParseIgnoreReason.UNAPPROVED_PROFILE)
        }
        if (message.sourceProfileId != profile.sourceProfileId || !profile.matchesPackage(message.packageName) ||
            !profile.matchesChannel(message.channelId) || !profile.matchesSender(message.senderDisplayName)
        ) {
            return ParseResult.Ignored(message.observationId, ParseIgnoreReason.UNRELATED_SOURCE)
        }
        if (message.capturedAtMillis <= 0L) {
            return ParseResult.NeedsReview(message.observationId, listOf(ParseReviewReason.UNRESOLVED_TIME), null)
        }

        val unsupportedContent = message.contentCapability != NotificationContentCapability.BOUNDED_TEXT
        if (unsupportedContent) {
            val event = buildEvent(
                message = message,
                profile = profile,
                eventType = BankAlertEventType.UNKNOWN,
                direction = MoneyDirection.UNKNOWN,
                components = emptyList(),
                primaryRole = null,
            )
            return ParseResult.NeedsReview(
                message.observationId,
                listOf(ParseReviewReason.UNSUPPORTED_NOTIFICATION_CONTENT),
                event,
            )
        }

        val text = normalizeText(message.scalarText())
        val eventType = classifyType(text)
        if (eventType == BankAlertEventType.UNKNOWN) {
            val event = buildEvent(message, profile, eventType, MoneyDirection.UNKNOWN, emptyList(), null)
            return ParseResult.NeedsReview(
                message.observationId,
                listOf(ParseReviewReason.UNKNOWN_EVENT_TYPE),
                event,
            )
        }

        // Type/header is classified before this money scan. This prevents a
        // balance, limit, or FX number in an unrelated template from becoming a charge.
        val componentParse = parseComponents(text)
        val components = componentParse.components
        val primaryRole = primaryRoleFor(eventType)
        val primary = components.firstOrNull { it.role == primaryRole }
        val direction = directionFor(eventType)
        val reasons = linkedSetOf<ParseReviewReason>()

        componentParse.failure?.let(reasons::add)
        if (message.notificationPostedAtMillis == null || !message.individualTimestampVerified) {
            reasons += ParseReviewReason.UNRESOLVED_TIME
        }
        if (hasInvalidBankDisplayedTime(text)) {
            reasons += ParseReviewReason.INVALID_BANK_DISPLAYED_TIME
        }
        if (message.observationDisposition == ObservationDisposition.HISTORICAL_REVIEW) {
            reasons += ParseReviewReason.HISTORICAL_REVIEW
        }
        if (message.observationDisposition == ObservationDisposition.POSSIBLE_DUPLICATE_REVIEW) {
            reasons += ParseReviewReason.POSSIBLE_DUPLICATE
        }
        if (message.observationDisposition == ObservationDisposition.UNSTABLE_IDENTITY_REVIEW ||
            message.observationDisposition == ObservationDisposition.SUMMARY_ONLY_REVIEW
        ) {
            reasons += ParseReviewReason.UNSTABLE_IDENTITY
        }

        val amountRequired = eventType != BankAlertEventType.UNKNOWN
        if (amountRequired && primary == null && componentParse.failure == null) {
            reasons += ParseReviewReason.UNRESOLVED_MONEY
        }
        if (primary != null && primary.currency !in profile.allowedCurrencies) {
            reasons += ParseReviewReason.INVALID_MONEY
        }
        if (eventType in setOf(BankAlertEventType.PURCHASE_NOTICE, BankAlertEventType.REFUND_NOTICE, BankAlertEventType.FEE_NOTICE) &&
            profile.instrumentHint == null
        ) {
            reasons += ParseReviewReason.UNRESOLVED_INSTRUMENT
        }
        if (eventType == BankAlertEventType.FEE_NOTICE && componentParse.failure == null && primary != null && feeTreatment(text) == FeeTreatment.UNKNOWN) {
            reasons += ParseReviewReason.FEE_TREATMENT_UNKNOWN
        }
        if (eventType == BankAlertEventType.REFUND_NOTICE && direction != MoneyDirection.INFLOW) {
            reasons += ParseReviewReason.INVALID_DIRECTION
        }

        val event = buildEvent(message, profile, eventType, direction, components, primaryRole)
        return if (reasons.isEmpty()) {
            ParseResult.Complete(event)
        } else {
            ParseResult.NeedsReview(message.observationId, reasons.toList(), event)
        }
    }

    private fun classifyType(text: String): BankAlertEventType {
        return when {
            hasTemplateLine(text, "交易失败提醒", "交易失败", "交易失敗提醒", "交易失敗", "declined", "declined notice", "failed", "failed notice", "failure", "transaction failed", "transaction declined") -> BankAlertEventType.DECLINED
            hasTemplateLine(text, "撤销", "撤銷", "取消", "reversal", "reversed", "reversal notice", "authorization reversal") -> BankAlertEventType.AUTHORIZATION_REVERSAL
            hasTemplateLine(text, "退款", "退款通知", "refund", "refund notice") -> BankAlertEventType.REFUND_NOTICE
            hasTemplateLine(text, "预授权", "預授權", "预授权提醒", "預授權提醒", "preauthorization", "pre-authorisation", "preauthorization notice", "hold", "hold notice") -> BankAlertEventType.HOLD_NOTICE
            hasTemplateLine(text, "还款", "還款", "还款通知", "還款通知", "repayment", "repayment notice") -> BankAlertEventType.REPAYMENT_NOTICE
            hasTemplateLine(text, "转账", "轉帳", "转账通知", "轉帳通知", "transfer", "transfer notice", "wallet funding") -> BankAlertEventType.TRANSFER_NOTICE
            hasTemplateLine(text, "手续费", "手續費", "利息", "手续费通知", "手續費通知", "fee", "fee notice", "interest", "interest notice") -> BankAlertEventType.FEE_NOTICE
            hasTemplateLine(text, "调整", "調整", "调整通知", "調整通知", "adjustment", "adjustment notice") -> BankAlertEventType.ADJUSTMENT_NOTICE
            hasTemplateLine(text, "交易提醒", "交易提示", "消费", "消費", "purchase", "purchase notice", "transaction purchase") -> BankAlertEventType.PURCHASE_NOTICE
            else -> BankAlertEventType.UNKNOWN
        }
    }

    private fun hasTemplateLine(text: String, vararg tokens: String): Boolean {
        val knownTokens = tokens.map { normalizeText(it).trim().lowercase(Locale.ROOT) }.toSet()
        return normalizeText(text)
            .lineSequence()
            .map { it.trim().lowercase(Locale.ROOT) }
            .filter { it.isNotBlank() && it.length <= MAX_TYPE_TOKEN_CHARS && ':' !in it && '=' !in it }
            .any(knownTokens::contains)
    }

    private fun parseComponents(text: String): ComponentParse {
        val components = mutableListOf<MoneyComponent>()
        var failure: ParseReviewReason? = null
        text.lines().forEach { rawLine ->
            val line = normalizeText(rawLine).trim()
            if (line.isBlank() || isNonMoneyScalar(line)) return@forEach
            val label = LABEL_PATTERN.find(line) ?: return@forEach
            val role = roleForLabel(label.groupValues[1]) ?: return@forEach
            val candidate = label.groupValues[2].trim()
            val money = MONEY_PATTERN.matchEntire(candidate)
            if (money == null) {
                failure = failure ?: ParseReviewReason.INVALID_MONEY
                return@forEach
            }
            val leadingCurrency = money.groupValues[1].takeIf(String::isNotBlank)
            val trailingCurrency = money.groupValues[3].takeIf(String::isNotBlank)
            val leadingCode = currencies.resolveCurrencyToken(leadingCurrency)
            val trailingCode = currencies.resolveCurrencyToken(trailingCurrency)
            if (leadingCurrency != null && trailingCurrency != null &&
                (leadingCode == null || trailingCode == null || leadingCode != trailingCode)
            ) {
                failure = failure ?: ParseReviewReason.AMBIGUOUS_CURRENCY
                return@forEach
            }
            val currency = leadingCode ?: trailingCode
            if (currency == null) {
                failure = failure ?: ParseReviewReason.AMBIGUOUS_CURRENCY
                return@forEach
            }
            val amountMinor = currencies.parseMinor(money.groupValues[2], currency)
            if (amountMinor == null) {
                failure = failure ?: ParseReviewReason.INVALID_MONEY
                return@forEach
            }
            components += MoneyComponent(role, currency, amountMinor)
        }
        val duplicateRole = components.groupingBy(MoneyComponent::role).eachCount().values.any { it > 1 }
        if (duplicateRole) failure = failure ?: ParseReviewReason.AMBIGUOUS_CURRENCY
        return ComponentParse(components = components, failure = failure)
    }

    private fun buildEvent(
        message: ObservedBankMessage,
        profile: SourceProfile,
        eventType: BankAlertEventType,
        direction: MoneyDirection,
        components: List<MoneyComponent>,
        primaryRole: MoneyRole?,
    ): BankAlertEventInput {
        val primary = primaryRole?.let { role -> components.firstOrNull { it.role == role } }
        val hasPostedTime = message.notificationPostedAtMillis != null && message.individualTimestampVerified
        val eventTimeBasis = if (hasPostedTime) EventTimeBasis.NOTIFICATION_POSTED else EventTimeBasis.UNRESOLVED
        val fee = feeTreatment(message.scalarText())
        return BankAlertEventInput(
            schemaVersion = 1,
            eventId = eventIdProvider.eventIdFor(message),
            observationId = message.observationId,
            sourceProfileId = profile.sourceProfileId,
            parserVersion = profile.parserVersion,
            notificationPostedAt = if (hasPostedTime) message.notificationPostedAtMillis?.let(::instantString) else null,
            capturedAt = instantString(message.capturedAtMillis),
            eventTimeBasis = eventTimeBasis,
            eventType = eventType,
            direction = direction,
            instrumentHint = profile.instrumentHint,
            eventMoney = primary?.let { Money(it.currency, it.amountMinor) },
            primaryMoneyRole = primary?.role,
            amounts = components,
            feeTreatment = fee,
            bankReference = extractScalarValue(message.scalarText(), REFERENCE_PATTERN, MAX_REFERENCE_CHARS),
            bankDisplayedTime = parseBankDisplayedTime(message.scalarText()),
            merchant = extractScalarValue(message.scalarText(), MERCHANT_PATTERN, MAX_MERCHANT_CHARS),
            completeness = EventCompleteness(
                individualTimestamp = hasPostedTime,
                supportedSource = true,
                labeledMoney = primary != null,
            ),
        )
    }

    private fun primaryRoleFor(eventType: BankAlertEventType): MoneyRole? = when (eventType) {
        BankAlertEventType.HOLD_NOTICE -> MoneyRole.AUTHORIZATION
        BankAlertEventType.FEE_NOTICE -> MoneyRole.FEE
        BankAlertEventType.UNKNOWN -> null
        else -> MoneyRole.TRANSACTION
    }

    private fun directionFor(eventType: BankAlertEventType): MoneyDirection = when (eventType) {
        BankAlertEventType.PURCHASE_NOTICE, BankAlertEventType.FEE_NOTICE -> MoneyDirection.OUTFLOW
        BankAlertEventType.REFUND_NOTICE -> MoneyDirection.INFLOW
        BankAlertEventType.UNKNOWN -> MoneyDirection.UNKNOWN
        else -> MoneyDirection.NONE
    }

    private fun feeTreatment(text: String): FeeTreatment {
        val normalized = normalizeText(text).lowercase(Locale.ROOT)
        val headerLines = normalized.lineSequence()
            .map(String::trim)
            .filter { it.isNotBlank() && ':' !in it && '=' !in it && it.length <= MAX_TYPE_TOKEN_CHARS }
            .toSet()
        return when {
            headerLines.any { it in setOf("含手续费", "含手續費", "fee included", "included fee") } -> FeeTreatment.INCLUDED
            headerLines.any { it in setOf("手续费", "手續費", "手续费通知", "手續費通知", "separate fee", "fee", "interest", "interest notice") } ||
                normalized.lineSequence().any { Regex("^(?:手续费|手續費|fee|interest)\\s*[:=]").containsMatchIn(it.trim()) } -> FeeTreatment.SEPARATE
            else -> FeeTreatment.UNKNOWN
        }
    }

    private fun parseBankDisplayedTime(text: String): BankDisplayedTime? {
        val line = text.lines().firstOrNull { TIME_PATTERN.containsMatchIn(it) } ?: return null
        val match = TIME_PATTERN.find(line) ?: return null
        val raw = match.groupValues[1].trim().replace('/', '-')
        val dateAndTime = raw.split(Regex("\\s+"))
        val date = dateAndTime.firstOrNull() ?: return null
        val dateParts = date.split('-')
        if (dateParts.size != 3) return null
        val yearText = dateParts[0]
        val year = when (yearText.length) {
            2 -> yearText.toIntOrNull()?.plus(2_000)
            4 -> yearText.toIntOrNull()
            else -> null
        }?.takeIf { it in 1..9_999 } ?: return null
        val month = dateParts[1].toIntOrNull() ?: return null
        val day = dateParts[2].toIntOrNull() ?: return null
        val localDate = runCatching { LocalDate.of(year, month, day) }.getOrNull() ?: return null
        val time = dateAndTime.getOrNull(1)
        val normalized = if (time == null) {
            localDate.toString()
        } else {
            val timeParts = time.split(':')
            if (timeParts.size !in 2..3) return null
            val hour = timeParts[0].toIntOrNull() ?: return null
            val minute = timeParts[1].toIntOrNull() ?: return null
            val second = if (timeParts.size == 3) timeParts[2].toIntOrNull() else null
            if (timeParts.size == 3 && second == null) return null
            val localTime = runCatching {
                if (second == null) LocalTime.of(hour, minute) else LocalTime.of(hour, minute, second)
            }.getOrNull() ?: return null
            val normalizedTime = if (second == null) {
                "%02d:%02d".format(Locale.ROOT, localTime.hour, localTime.minute)
            } else {
                "%02d:%02d:%02d".format(Locale.ROOT, localTime.hour, localTime.minute, localTime.second)
            }
            "${localDate} $normalizedTime"
        }
        val precision = if (time == null) BankTimePrecision.DATE else if (time.count { it == ':' } == 1) BankTimePrecision.MINUTE else BankTimePrecision.SECOND
        return BankDisplayedTime(
            localDateTime = normalized,
            zone = null,
            precision = precision,
            yearProvenance = when {
                yearText.length == 4 -> BankYearProvenance.EXPLICIT
                yearText.length == 2 -> BankYearProvenance.TWO_DIGIT
                else -> BankYearProvenance.MISSING
            },
        )
    }

    private fun hasInvalidBankDisplayedTime(text: String): Boolean = normalizeText(text)
        .lineSequence()
        .map(String::trim)
        .filter(BANK_TIME_LABEL_PATTERN::matches)
        .any { parseBankDisplayedTime(it) == null }

    private fun extractScalarValue(text: String, pattern: Regex, limit: Int): String? =
        pattern.find(normalizeText(text))?.groupValues?.getOrNull(1)?.trim()?.take(limit)?.ifBlank { null }

    private fun instantString(millis: Long): String = Instant.ofEpochMilli(millis).toString()

    private fun roleForLabel(label: String): MoneyRole? {
        val lower = label.lowercase(Locale.ROOT)
        return when {
            containsAny(lower, "授权金额", "授權金額", "預授權金額", "authorization amount", "authorized amount") -> MoneyRole.AUTHORIZATION
            containsAny(lower, "入账金额", "入賬金額", "账单金额", "帳單金額", "billing amount", "posted amount") -> MoneyRole.BILLING
            containsAny(lower, "手续费", "手續費", "fee", "interest") -> MoneyRole.FEE
            containsAny(lower, "交易金额", "交易金額", "消费金额", "消費金額", "退款金额", "退款金額", "撤销金额", "撤銷金額", "purchase amount", "refund amount", "transaction amount", "amount") -> MoneyRole.TRANSACTION
            else -> null
        }
    }

    private fun isNonMoneyScalar(line: String): Boolean = containsAny(
        line.lowercase(Locale.ROOT),
        "余额", "餘額", "可用额度", "可用額度", "信用额度", "信用額度", "balance", "available limit", "credit limit", "exchange rate", "汇率", "匯率", "fx:",
    )

    private fun normalizeText(value: String): String = value
        .replace('\uFF1A', ':')
        .replace('\uFF1D', '=')
        .replace('\uFF0C', ',')
        .replace('\uFF0E', '.')
        .map { character ->
            when {
                character in '\uFF10'..'\uFF19' -> ('0'.code + character.code - '\uFF10'.code).toChar()
                character in '\uFF21'..'\uFF3A' -> ('A'.code + character.code - '\uFF21'.code).toChar()
                character in '\uFF41'..'\uFF5A' -> ('a'.code + character.code - '\uFF41'.code).toChar()
                character == '\uFF04' -> '$'
                character == '\uFFE5' -> '¥'
                else -> character
            }
        }
        .joinToString("")

    private fun containsAny(value: String, vararg candidates: String): Boolean = candidates.any(value::contains)

    companion object {
        private const val MAX_MERCHANT_CHARS = 120
        private const val MAX_REFERENCE_CHARS = 80
        private const val MAX_TYPE_TOKEN_CHARS = 64
        private const val CURRENCY_TOKEN_PATTERN = "(RMB|人民币|人民幣|美元|港币|港幣|加元|CA\\$|US\\$|HK\\$|C\\$|CN¥|CNY¥|\\$|¥|￥|﹩|€|£|[A-Za-z]{2,8}|\\p{L}{1,8})"
        private val LABEL_PATTERN = Regex("^(交易金额|交易金額|消费金额|消費金額|退款金额|退款金額|撤销金额|撤銷金額|授权金额|授權金額|入账金额|入賬金額|账单金额|帳單金額|手续费|手續費|金额|金額|purchase amount|refund amount|transaction amount|authorization amount|authorized amount|billing amount|posted amount|fee|interest|amount)\\s*[:=]\\s*(.+)$", RegexOption.IGNORE_CASE)
        private val MONEY_PATTERN = Regex("^\\s*(?:(?:$CURRENCY_TOKEN_PATTERN)\\s*)?([0-9]+(?:[,][0-9]{3})*(?:\\.[0-9]+)?)\\s*(?:(?:$CURRENCY_TOKEN_PATTERN))?\\s*$", RegexOption.IGNORE_CASE)
        private val MERCHANT_PATTERN = Regex("(?im)^(?:商户名称|商戶名稱|商户|商戶|merchant)\\s*[:=]\\s*(.{1,200})$")
        private val REFERENCE_PATTERN = Regex("(?im)^(?:参考号|參考號|参考编号|參考編號|reference)\\s*[:=]\\s*([A-Za-z0-9_-]{1,100})$")
        private val TIME_PATTERN = Regex("(?im)^(?:交易时间|交易時間|日期时间|日期時間|bank time|time)\\s*[:=]\\s*([0-9]{2,4}[-/][0-9]{1,2}[-/][0-9]{1,2}(?:\\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)$")
        private val BANK_TIME_LABEL_PATTERN = Regex("^(?:交易时间|交易時間|日期时间|日期時間|bank time|time)\\s*[:=].*$", RegexOption.IGNORE_CASE)
    }
}
