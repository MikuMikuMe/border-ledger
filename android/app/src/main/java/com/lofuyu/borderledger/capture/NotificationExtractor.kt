package com.lofuyu.borderledger.capture

import java.util.Locale

enum class NotificationContentCapability {
    BOUNDED_TEXT,
    GENERIC_OS_NOTIFICATION,
    SCREENSHOT_ONLY_RICH_CONTENT,
    SUMMARY_ONLY,
}

enum class ObservationOrigin {
    NEW_CALLBACK,
    ACTIVE_RECOVERY,
}

enum class ObservationDisposition {
    ELIGIBLE,
    HISTORICAL_REVIEW,
    POSSIBLE_DUPLICATE_REVIEW,
    UNSTABLE_IDENTITY_REVIEW,
    SUMMARY_ONLY_REVIEW,
}

data class NotificationMessageSnapshot(
    val messageIdentity: String?,
    val postedAtMillis: Long?,
    val senderDisplayName: String?,
    val text: String?,
    val title: String? = null,
)

/**
 * Testable scalar boundary for Android StatusBarNotification data. A future
 * listener may construct this from public Android fields, but the raw bundle,
 * screenshots, and notification objects must not cross this boundary.
 */
data class AndroidNotificationSnapshot(
    val sourceProfileId: String?,
    val androidUserProfile: String,
    val packageName: String,
    val notificationKey: String,
    val notificationGeneration: Long,
    val notificationPostedAtMillis: Long,
    val capturedAtMillis: Long,
    val channelId: String?,
    val senderDisplayName: String?,
    val title: String?,
    val text: String?,
    val textLines: List<String> = emptyList(),
    val childMessages: List<NotificationMessageSnapshot> = emptyList(),
    val isGroupSummary: Boolean = false,
    val groupKey: String? = null,
    /** Null means the public notification metadata cannot distinguish a private chat. */
    val isPrivateConversation: Boolean? = null,
    val contentCapability: NotificationContentCapability = NotificationContentCapability.BOUNDED_TEXT,
    val notificationCategory: String = "msg",
    val origin: ObservationOrigin = ObservationOrigin.NEW_CALLBACK,
    val individualTimestampVerified: Boolean = true,
)

/**
 * Bounded, ephemeral evidence. It intentionally contains no Android Bundle,
 * Parcelable, screenshot, or raw notification object and is not a persistence
 * model. The parser maps only selected scalars into BankAlertEventInput.
 */
data class ObservedBankMessage(
    val sourceProfileId: String,
    val androidUserProfile: String,
    val packageName: String,
    val channelId: String?,
    val senderDisplayName: String?,
    val notificationKey: String,
    val notificationGeneration: Long,
    val messageIdentity: String?,
    val individualMessageTimestampMillis: Long?,
    val notificationPostedAtMillis: Long?,
    val capturedAtMillis: Long,
    val individualTimestampVerified: Boolean,
    val isGroupSummary: Boolean,
    val groupKey: String?,
    val snapshotMultiplicity: Int,
    val snapshotOrdinal: Int,
    val contentCapability: NotificationContentCapability,
    val notificationCategory: String,
    val origin: ObservationOrigin,
    val title: String?,
    val text: String?,
    val textLines: List<String>,
    val textTruncated: Boolean = false,
    val observationDisposition: ObservationDisposition = ObservationDisposition.ELIGIBLE,
) {
    val observationId: String
        get() = ObservationIdentity.forMessage(this)

    fun scalarText(): String = buildList {
        title?.let(::add)
        if (text != null) add(text) else addAll(textLines)
    }.joinToString("\n")

    fun withDisposition(disposition: ObservationDisposition): ObservedBankMessage =
        copy(observationDisposition = disposition)
}

sealed interface ExtractionResult {
    data class Accepted(val messages: List<ObservedBankMessage>) : ExtractionResult

    data class NeedsReview(
        val reason: ExtractionReviewReason,
        val message: ObservedBankMessage? = null,
    ) : ExtractionResult

    data class Ignored(val reason: ExtractionIgnoreReason) : ExtractionResult
}

enum class ExtractionReviewReason {
    SUMMARY_ONLY,
    SCREENSHOT_ONLY_CONTENT,
    SENDER_UNAVAILABLE,
    UNSTABLE_IDENTITY,
    MISSING_CAPTURE_TIME,
    CONVERSATION_CONTEXT_UNKNOWN,
}

enum class ExtractionIgnoreReason {
    UNRELATED_PACKAGE,
    PROFILE_MISMATCH,
    UNAPPROVED_PROFILE,
    CHANNEL_MISMATCH,
    USER_PROFILE_MISMATCH,
    UNMATCHED_SENDER,
    PRIVATE_CONVERSATION,
    CATEGORY_NOT_APPROVED,
    PROMOTION_OR_OTP,
}

class NotificationExtractor {
    fun extract(snapshot: AndroidNotificationSnapshot, profile: SourceProfile): ExtractionResult {
        if (!profile.approved) return ExtractionResult.Ignored(ExtractionIgnoreReason.UNAPPROVED_PROFILE)
        if (snapshot.sourceProfileId != profile.sourceProfileId) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.PROFILE_MISMATCH)
        }
        if (!profile.matchesPackage(snapshot.packageName)) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.UNRELATED_PACKAGE)
        }
        if (!profile.matchesAndroidUserProfile(snapshot.androidUserProfile)) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.USER_PROFILE_MISMATCH)
        }
        if (!profile.matchesChannel(snapshot.channelId)) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.CHANNEL_MISMATCH)
        }
        if (!profile.matchesCategory(snapshot.notificationCategory)) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.CATEGORY_NOT_APPROVED)
        }
        when (snapshot.isPrivateConversation) {
            true -> return ExtractionResult.Ignored(ExtractionIgnoreReason.PRIVATE_CONVERSATION)
            null -> return ExtractionResult.NeedsReview(ExtractionReviewReason.CONVERSATION_CONTEXT_UNKNOWN)
            false -> Unit
        }
        if (profile.approvedSenderNames.isNotEmpty() && snapshot.senderDisplayName == null) {
            return ExtractionResult.NeedsReview(ExtractionReviewReason.SENDER_UNAVAILABLE)
        }
        if (!profile.matchesSender(snapshot.senderDisplayName)) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.UNMATCHED_SENDER)
        }
        if (containsPromotionalOrOtpScalar(snapshot.title, snapshot.text, snapshot.textLines)) {
            return ExtractionResult.Ignored(ExtractionIgnoreReason.PROMOTION_OR_OTP)
        }
        if (snapshot.notificationKey.isBlank()) {
            return ExtractionResult.NeedsReview(ExtractionReviewReason.UNSTABLE_IDENTITY)
        }
        if (snapshot.capturedAtMillis <= 0L) {
            return ExtractionResult.NeedsReview(ExtractionReviewReason.MISSING_CAPTURE_TIME)
        }

        if (snapshot.isGroupSummary && snapshot.childMessages.isEmpty()) {
            val summary = buildMessage(snapshot, profile, child = null, ordinal = 1, multiplicity = 1, summaryOnly = true)
                .withDisposition(ObservationDisposition.SUMMARY_ONLY_REVIEW)
            return ExtractionResult.NeedsReview(ExtractionReviewReason.SUMMARY_ONLY, summary)
        }

        val children = if (snapshot.isGroupSummary) {
            snapshot.childMessages
                .filter { profile.matchesSender(it.senderDisplayName ?: snapshot.senderDisplayName) }
                .sortedWith(compareBy({ it.messageIdentity ?: "" }, { it.postedAtMillis ?: Long.MAX_VALUE }, { it.text ?: "" }))
        } else {
            emptyList()
        }
        if (snapshot.isGroupSummary && children.isEmpty()) {
            val summary = buildMessage(snapshot, profile, child = null, ordinal = 1, multiplicity = 1, summaryOnly = true)
                .withDisposition(ObservationDisposition.SUMMARY_ONLY_REVIEW)
            return ExtractionResult.NeedsReview(ExtractionReviewReason.SUMMARY_ONLY, summary)
        }
        val multiplicity = if (children.isEmpty()) 1 else children.size
        val messages = if (children.isEmpty()) {
            listOf(buildMessage(snapshot, profile, child = null, ordinal = 1, multiplicity = 1))
        } else {
            children.mapIndexed { index, child ->
                buildMessage(snapshot, profile, child, ordinal = index + 1, multiplicity = multiplicity)
            }
        }
        if (snapshot.contentCapability == NotificationContentCapability.SCREENSHOT_ONLY_RICH_CONTENT) {
            return ExtractionResult.NeedsReview(
                ExtractionReviewReason.SCREENSHOT_ONLY_CONTENT,
                messages.firstOrNull()?.copy(
                    contentCapability = NotificationContentCapability.SCREENSHOT_ONLY_RICH_CONTENT,
                    title = null,
                    text = null,
                    textLines = emptyList(),
                    textTruncated = false,
                ),
            )
        }
        return ExtractionResult.Accepted(messages)
    }

    private fun buildMessage(
        snapshot: AndroidNotificationSnapshot,
        profile: SourceProfile,
        child: NotificationMessageSnapshot?,
        ordinal: Int,
        multiplicity: Int,
        summaryOnly: Boolean = false,
    ): ObservedBankMessage {
        val childTimestamp = child?.postedAtMillis?.takeIf { it > 0L }
        val isIndividual = when {
            summaryOnly -> false
            child != null -> childTimestamp != null && snapshot.individualTimestampVerified
            else -> snapshot.individualTimestampVerified && snapshot.notificationPostedAtMillis > 0L
        }
        val postedAt = when {
            summaryOnly -> null
            child != null -> childTimestamp
            isIndividual -> snapshot.notificationPostedAtMillis
            else -> null
        }
        val content = when {
            summaryOnly -> NotificationContentCapability.SUMMARY_ONLY
            snapshot.contentCapability != NotificationContentCapability.BOUNDED_TEXT -> snapshot.contentCapability
            child != null && child.text.isNullOrBlank() && child.title.isNullOrBlank() -> NotificationContentCapability.GENERIC_OS_NOTIFICATION
            child == null && snapshot.text.isNullOrBlank() && snapshot.title.isNullOrBlank() -> NotificationContentCapability.GENERIC_OS_NOTIFICATION
            else -> NotificationContentCapability.BOUNDED_TEXT
        }
        val rawTitle = child?.title ?: snapshot.title
        val rawText = child?.text ?: snapshot.text
        val boundedTitle = if (content == NotificationContentCapability.BOUNDED_TEXT) {
            boundText(rawTitle, MAX_TITLE_CHARS)
        } else {
            BoundedText(null, false)
        }
        val boundedText = if (content == NotificationContentCapability.BOUNDED_TEXT || content == NotificationContentCapability.GENERIC_OS_NOTIFICATION) {
            boundText(rawText, MAX_TEXT_CHARS)
        } else {
            BoundedText(null, false)
        }
        val lines = if (content == NotificationContentCapability.BOUNDED_TEXT || content == NotificationContentCapability.GENERIC_OS_NOTIFICATION) {
            (child?.text ?: snapshot.textLines.joinToString("\n"))
                .orEmpty()
                .lines()
                .filter { it.isNotBlank() }
                .take(MAX_TEXT_LINES)
                .map { boundText(it, MAX_LINE_CHARS).value.orEmpty() }
        } else {
            emptyList()
        }
        val key = boundText(snapshot.notificationKey, MAX_KEY_CHARS).value.orEmpty()
        return ObservedBankMessage(
            sourceProfileId = profile.sourceProfileId,
            androidUserProfile = boundText(snapshot.androidUserProfile, MAX_PROFILE_CHARS).value.orEmpty(),
            packageName = profile.packageName,
            channelId = snapshot.channelId?.let { boundText(it, MAX_CHANNEL_CHARS).value },
            senderDisplayName = (child?.senderDisplayName ?: snapshot.senderDisplayName)?.let { boundText(it, MAX_SENDER_CHARS).value },
            notificationKey = key,
            notificationGeneration = snapshot.notificationGeneration,
            messageIdentity = child?.messageIdentity?.let { boundText(it, MAX_IDENTITY_CHARS).value }?.takeIf { !it.isNullOrBlank() },
            individualMessageTimestampMillis = childTimestamp,
            notificationPostedAtMillis = postedAt,
            capturedAtMillis = snapshot.capturedAtMillis,
            individualTimestampVerified = isIndividual,
            isGroupSummary = summaryOnly,
            groupKey = snapshot.groupKey?.let { boundText(it, MAX_GROUP_CHARS).value },
            snapshotMultiplicity = multiplicity.coerceIn(1, MAX_SNAPSHOT_MULTIPLICITY),
            snapshotOrdinal = ordinal.coerceIn(1, MAX_SNAPSHOT_MULTIPLICITY),
            contentCapability = content,
            notificationCategory = snapshot.notificationCategory,
            origin = snapshot.origin,
            title = boundedTitle.value,
            text = boundedText.value,
            textLines = lines,
            textTruncated = boundedText.truncated,
        )
    }

    private data class BoundedText(val value: String?, val truncated: Boolean)

    private fun boundText(value: String?, limit: Int): BoundedText {
        if (value == null) return BoundedText(null, false)
        val sanitized = value.replace('\u0000', ' ').trim()
        return if (sanitized.length <= limit) BoundedText(sanitized, false)
        else BoundedText(sanitized.take(limit), true)
    }

    private fun containsPromotionalOrOtpScalar(title: String?, text: String?, lines: List<String>): Boolean {
        val value = listOfNotNull(title, text).plus(lines).joinToString(" ").lowercase(Locale.ROOT)
        return listOf(
            "验证码", "otp", "one-time password", "verification code", "优惠活动", "促销",
            "promotion", "bonus points", "积分活动", "立即领取",
        ).any(value::contains)
    }

    companion object {
        const val MAX_TITLE_CHARS = 128
        const val MAX_TEXT_CHARS = 1024
        const val MAX_LINE_CHARS = 256
        const val MAX_TEXT_LINES = 20
        const val MAX_KEY_CHARS = 512
        const val MAX_PROFILE_CHARS = 64
        const val MAX_CHANNEL_CHARS = 128
        const val MAX_SENDER_CHARS = 128
        const val MAX_IDENTITY_CHARS = 256
        const val MAX_GROUP_CHARS = 256
        const val MAX_SNAPSHOT_MULTIPLICITY = 20
    }
}
