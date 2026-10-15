package com.lofuyu.borderledger.capture

import java.nio.charset.StandardCharsets
import java.security.MessageDigest

data class ObservationDiff(
    val newObservations: List<ObservedBankMessage>,
    val reviewObservations: List<ObservedBankMessage>,
    val replayedObservations: List<ObservedBankMessage>,
    val duplicateReviewEvidence: List<DuplicateReviewEvidence> = emptyList(),
)

data class DuplicateReviewEvidence(
    val observationId: String,
    val matchingObservationIds: List<String>,
    val contentFingerprint: String,
)

/**
 * Stable identity is deliberately based on notification metadata and
 * accessible message identity/time, never on a screenshot or raw payload.
 */
object ObservationIdentity {
    fun forMessage(message: ObservedBankMessage): String = hash(
        listOf(
            message.sourceProfileId,
            message.androidUserProfile,
            message.packageName,
            message.notificationKey,
            message.notificationGeneration.toString(),
            message.messageIdentity ?: "<no-message-identity>",
            (message.individualMessageTimestampMillis ?: message.notificationPostedAtMillis)?.toString() ?: "<no-message-time>",
        ),
    ).let { "obs_$it" }

    private fun hash(parts: List<String>): String {
        val canonical = parts.joinToString(separator = "") { part -> "${part.length}:$part|" }
        return MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
}

/**
 * Tracks a process-local observation set. Task 7 owns durable persistence;
 * this class intentionally has no database, network, or logging side effect.
 */
class ObservationTracker(
    private val activatedAtMillis: Long,
    private val historicalWindowMillis: Long = 7L * 24L * 60L * 60L * 1_000L,
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
) {
    private val seenObservationIds = mutableSetOf<String>()
    private val seenLogicalMessageIds = mutableSetOf<String>()
    private val frozenNotificationTimes = mutableMapOf<String, Long?>()
    private val seenUnidentifiedContent = mutableMapOf<String, MutableSet<String>>()

    fun diff(messages: Iterable<ObservedBankMessage>): ObservationDiff {
        val candidates = skipSummariesWhenChildrenExist(messages.toList())
            .sortedWith(compareBy({ stableSortKey(it) }, { it.snapshotOrdinal }))

        val fresh = mutableListOf<ObservedBankMessage>()
        val review = mutableListOf<ObservedBankMessage>()
        val replayed = mutableListOf<ObservedBankMessage>()
        val duplicateEvidence = mutableListOf<DuplicateReviewEvidence>()

        candidates.forEach { input ->
            val logicalKey = logicalKey(input)
            val frozenTime = freezeTime(logicalKey, input.notificationPostedAtMillis)
            val normalized = input.copy(notificationPostedAtMillis = frozenTime)
            val observationId = normalized.observationId
            val fingerprint = if (logicalKey == null) contentFingerprint(normalized) else null
            val priorUnknownIds = fingerprint?.let { seenUnidentifiedContent[it].orEmpty() }.orEmpty()
            val repeatedUnidentifiedId = logicalKey == null && seenObservationIds.contains(observationId)
            if (logicalKey == null && (priorUnknownIds.isNotEmpty() || repeatedUnidentifiedId)) {
                val unidentifiedFingerprint = requireNotNull(fingerprint)
                val baseDisposition = dispositionFor(normalized)
                val disposition = if (baseDisposition == ObservationDisposition.ELIGIBLE) {
                    ObservationDisposition.POSSIBLE_DUPLICATE_REVIEW
                } else {
                    baseDisposition
                }
                val marked = normalized.withDisposition(disposition)
                val matchingIds = (priorUnknownIds + if (repeatedUnidentifiedId) observationId else "")
                    .filter(String::isNotBlank)
                    .distinct()
                duplicateEvidence += DuplicateReviewEvidence(
                    observationId = observationId,
                    matchingObservationIds = matchingIds,
                    contentFingerprint = unidentifiedFingerprint,
                )
                review += marked
                seenObservationIds += observationId
                seenUnidentifiedContent.getOrPut(unidentifiedFingerprint) { mutableSetOf() }.add(observationId)
                return@forEach
            }
            if (seenObservationIds.contains(observationId) || (logicalKey != null && seenLogicalMessageIds.contains(logicalKey))) {
                replayed += normalized
                return@forEach
            }

            seenObservationIds += observationId
            logicalKey?.let(seenLogicalMessageIds::add)
            val disposition = dispositionFor(normalized)
            val marked = normalized.withDisposition(disposition)
            if (disposition == ObservationDisposition.ELIGIBLE) {
                fresh += marked
            } else {
                review += marked
            }
            fingerprint?.let { seenUnidentifiedContent.getOrPut(it) { mutableSetOf() }.add(observationId) }
        }

        return ObservationDiff(
            newObservations = fresh.sortedBy(ObservedBankMessage::observationId),
            reviewObservations = review.sortedBy(ObservedBankMessage::observationId),
            replayedObservations = replayed.sortedBy(ObservedBankMessage::observationId),
            duplicateReviewEvidence = duplicateEvidence.sortedBy(DuplicateReviewEvidence::observationId),
        )
    }

    private fun dispositionFor(message: ObservedBankMessage): ObservationDisposition {
        if (message.notificationPostedAtMillis == null || !message.individualTimestampVerified) {
            return ObservationDisposition.UNSTABLE_IDENTITY_REVIEW
        }
        val postTime = message.notificationPostedAtMillis
        if (postTime < activatedAtMillis || (message.messageIdentity == null && nowMillis() - postTime > historicalWindowMillis)) {
            return ObservationDisposition.HISTORICAL_REVIEW
        }
        if (message.messageIdentity == null) {
            val fingerprint = contentFingerprint(message)
            val priorObservations = seenUnidentifiedContent[fingerprint]
            if (!priorObservations.isNullOrEmpty()) {
                return ObservationDisposition.POSSIBLE_DUPLICATE_REVIEW
            }
        }
        return ObservationDisposition.ELIGIBLE
    }

    private fun freezeTime(logicalKey: String?, candidate: Long?): Long? {
        if (logicalKey == null) return candidate
        if (logicalKey !in frozenNotificationTimes) {
            frozenNotificationTimes[logicalKey] = candidate
        }
        return frozenNotificationTimes[logicalKey]
    }

    private fun logicalKey(message: ObservedBankMessage): String? {
        val identity = message.messageIdentity ?: return null
        return listOf(message.sourceProfileId, message.androidUserProfile, message.packageName, identity)
            .joinToString("|")
    }

    private fun contentFingerprint(message: ObservedBankMessage): String {
        val value = listOf(
            message.sourceProfileId,
            message.androidUserProfile,
            message.packageName,
            message.groupKey.orEmpty(),
            message.title.orEmpty(),
            message.text.orEmpty(),
            message.textLines.joinToString("\u001f"),
        ).joinToString("\u001e")
        return MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }

    private fun stableSortKey(message: ObservedBankMessage): String = listOf(
        message.groupKey.orEmpty(),
        message.messageIdentity.orEmpty(),
        message.notificationPostedAtMillis?.toString().orEmpty(),
        message.notificationKey,
        message.notificationGeneration.toString(),
        contentFingerprint(message),
    ).joinToString("|")

    private fun skipSummariesWhenChildrenExist(messages: List<ObservedBankMessage>): List<ObservedBankMessage> {
        val childGroups = messages.asSequence()
            .filterNot(ObservedBankMessage::isGroupSummary)
            .mapNotNull(ObservedBankMessage::groupKey)
            .toSet()
        return messages.filterNot { it.isGroupSummary && it.groupKey != null && it.groupKey in childGroups }
    }
}
