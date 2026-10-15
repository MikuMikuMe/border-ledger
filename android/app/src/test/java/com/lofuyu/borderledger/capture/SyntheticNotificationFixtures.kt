package com.lofuyu.borderledger.capture

import com.lofuyu.borderledger.parser.InstrumentHint
import com.lofuyu.borderledger.parser.InstrumentHintKind
import com.lofuyu.borderledger.parser.EventIdProvider
import java.time.Instant
import java.nio.charset.StandardCharsets
import java.util.UUID

/** Synthetic-only fixtures. No private notification, bank, or chat data belongs here. */
object SyntheticNotificationFixtures {
    const val PACKAGE = "com.tencent.mm"
    const val CHANNEL = "synthetic-boc-alerts"

    fun syntheticEventIdProvider(): EventIdProvider = EventIdProvider { message ->
        val seed = message.messageIdentity?.let { "message:$it" } ?: "observation:${message.observationId}"
        UUID.nameUUIDFromBytes(seed.toByteArray(StandardCharsets.UTF_8)).toString()
    }

    fun bocProfile(
        instrumentHint: InstrumentHint? = InstrumentHint(InstrumentHintKind.CARD_SUFFIX, "1234"),
    ): SourceProfile = SourceProfile.syntheticBocCreditCard(
        sourceProfileId = "synthetic-boc-credit-card",
        packageName = PACKAGE,
        channelId = CHANNEL,
        senderDisplayNames = setOf("Bank of China"),
        instrumentHint = instrumentHint,
    )

    fun snapshot(
        body: String? = "交易提醒\n消费\n交易金额: CAD 12.34\n商户名称: Synthetic Market",
        title: String? = "Bank of China",
        packageName: String = PACKAGE,
        channelId: String? = CHANNEL,
        sender: String? = "Bank of China",
        key: String = "notification-key",
        generation: Long = 1L,
        postTime: Long = Instant.parse("2026-10-13T04:00:00Z").toEpochMilli(),
        capturedAt: Long = Instant.parse("2026-10-13T04:00:03Z").toEpochMilli(),
        sourceProfileId: String? = "synthetic-boc-credit-card",
        userProfile: String = "android-user-0",
        category: String = "msg",
        isPrivate: Boolean? = false,
        isSummary: Boolean = false,
        groupKey: String? = null,
        contentCapability: NotificationContentCapability = NotificationContentCapability.BOUNDED_TEXT,
        individualTimestampVerified: Boolean = true,
        children: List<NotificationMessageSnapshot> = emptyList(),
        origin: ObservationOrigin = ObservationOrigin.NEW_CALLBACK,
    ): AndroidNotificationSnapshot = AndroidNotificationSnapshot(
        sourceProfileId = sourceProfileId,
        androidUserProfile = userProfile,
        packageName = packageName,
        notificationKey = key,
        notificationGeneration = generation,
        notificationPostedAtMillis = postTime,
        capturedAtMillis = capturedAt,
        channelId = channelId,
        senderDisplayName = sender,
        title = title,
        text = body,
        textLines = body?.lines().orEmpty(),
        childMessages = children,
        isGroupSummary = isSummary,
        groupKey = groupKey,
        isPrivateConversation = isPrivate,
        contentCapability = contentCapability,
        notificationCategory = category,
        origin = origin,
        individualTimestampVerified = individualTimestampVerified,
    )

    fun observed(
        body: String = "交易提醒\n消费\n交易金额: CAD 12.34\n商户名称: Synthetic Market",
        profile: SourceProfile = bocProfile(),
        messageIdentity: String? = "message-1",
        key: String = "notification-key",
        generation: Long = 1L,
        postTime: Long = Instant.parse("2026-10-13T04:00:00Z").toEpochMilli(),
        capturedAt: Long = Instant.parse("2026-10-13T04:00:03Z").toEpochMilli(),
        userProfile: String = "android-user-0",
        contentCapability: NotificationContentCapability = NotificationContentCapability.BOUNDED_TEXT,
        individualTimestampVerified: Boolean = true,
    ): ObservedBankMessage {
        val result = NotificationExtractor().extract(
            snapshot(
                body = body,
                sourceProfileId = profile.sourceProfileId,
                packageName = profile.packageName,
                channelId = profile.channelId,
                sender = profile.approvedSenderNames.firstOrNull(),
                key = key,
                generation = generation,
                postTime = postTime,
                capturedAt = capturedAt,
                userProfile = userProfile,
                contentCapability = contentCapability,
                individualTimestampVerified = individualTimestampVerified,
            ),
            profile,
        )
        val message = when (result) {
            is ExtractionResult.Accepted -> result.messages.single()
            is ExtractionResult.NeedsReview -> result.message
            is ExtractionResult.Ignored -> error("Synthetic fixture was unexpectedly ignored: ${result.reason}")
        } ?: error("Synthetic fixture did not produce a bounded message")
        return message.copy(messageIdentity = messageIdentity)
    }
}
