package com.lofuyu.borderledger.debug

enum class ProbeObservationKind(val label: String) {
    NEW_CALLBACK("new callback"),
    RECOVERED_ACTIVE("recovered active notification"),
}

enum class ProbeSourceIdentification(val label: String) {
    PACKAGE_ONLY("package only; conversation identity unavailable"),
}

/**
 * Derived notification structure only. Counts are capped before this value is retained;
 * notification text and message objects never belong to this model.
 */
data class NotificationRepresentationSummary(
    val standardTextPresent: Boolean = false,
    val bigTextPresent: Boolean = false,
    val textLineCount: Int = 0,
    val textLinesTruncated: Boolean = false,
    val messagingRepresentationPresent: Boolean = false,
    val messagingMessageCount: Int = 0,
    val messagingMessagesTruncated: Boolean = false,
    val individualTimestampInspectionAvailable: Boolean = false,
    val individualTimestampCount: Int = 0,
    val individualTimestampMin: Long? = null,
    val individualTimestampMax: Long? = null,
) {
    fun bounded(): NotificationRepresentationSummary {
        val boundedLineCount = textLineCount.coerceIn(0, MAX_REPRESENTATION_ITEMS)
        val boundedMessageCount = messagingMessageCount.coerceIn(0, MAX_REPRESENTATION_ITEMS)
        val boundedTimestampCount = individualTimestampCount.coerceIn(0, MAX_REPRESENTATION_ITEMS)
        return copy(
            textLineCount = boundedLineCount,
            textLinesTruncated = textLinesTruncated || textLineCount > MAX_REPRESENTATION_ITEMS,
            messagingMessageCount = boundedMessageCount,
            messagingMessagesTruncated = messagingMessagesTruncated || messagingMessageCount > MAX_REPRESENTATION_ITEMS,
            individualTimestampCount = boundedTimestampCount,
            individualTimestampMin = if (boundedTimestampCount == 0) null else individualTimestampMin,
            individualTimestampMax = if (boundedTimestampCount == 0) null else individualTimestampMax,
        )
    }

    companion object {
        const val MAX_REPRESENTATION_ITEMS = 20
    }
}

/** Metadata only. Never retain notification text, title, sender, key or account details. */
data class ProbePreview private constructor(
    val sourcePackage: String,
    val sourceIdentification: ProbeSourceIdentification,
    val observationKind: ProbeObservationKind,
    val notificationPostedAt: Long,
    val callbackAt: Long,
    val titlePresent: Boolean,
    val bodyPresent: Boolean,
    val category: String,
    val representations: NotificationRepresentationSummary,
) {
    fun sanitizedCsvRow(): String = listOf(
        sourcePackage,
        sourceIdentification.name,
        observationKind.name,
        notificationPostedAt,
        callbackAt,
        titlePresent,
        bodyPresent,
        category,
        representations.standardTextPresent,
        representations.bigTextPresent,
        representations.textLineCount,
        representations.textLinesTruncated,
        representations.messagingRepresentationPresent,
        representations.messagingMessageCount,
        representations.messagingMessagesTruncated,
        representations.individualTimestampInspectionAvailable,
        representations.individualTimestampCount,
        representations.individualTimestampMin ?: "",
        representations.individualTimestampMax ?: "",
    ).joinToString(",")

    companion object {
        const val APPROVED_PACKAGE = "com.tencent.mm"

        fun from(
            packageName: String,
            postTime: Long,
            callbackTime: Long,
            title: CharSequence?,
            body: CharSequence?,
            category: String?,
            representations: NotificationRepresentationSummary = NotificationRepresentationSummary(
                standardTextPresent = !body.isNullOrEmpty(),
            ),
            observationKind: ProbeObservationKind = ProbeObservationKind.NEW_CALLBACK,
        ): ProbePreview? {
            if (packageName != APPROVED_PACKAGE || postTime <= 0 || callbackTime <= 0) return null
            val safeCategory = when (category) {
                "msg", "email", "status" -> category
                else -> "other"
            }
            return ProbePreview(
                sourcePackage = packageName,
                sourceIdentification = ProbeSourceIdentification.PACKAGE_ONLY,
                observationKind = observationKind,
                notificationPostedAt = postTime,
                callbackAt = callbackTime,
                titlePresent = !title.isNullOrEmpty(),
                bodyPresent = !body.isNullOrEmpty(),
                category = safeCategory,
                representations = representations.bounded(),
            )
        }
    }
}
