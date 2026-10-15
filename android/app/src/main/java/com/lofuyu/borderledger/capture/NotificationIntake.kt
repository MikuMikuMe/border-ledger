package com.lofuyu.borderledger.capture

import com.lofuyu.borderledger.local.CaptureCandidateDisposition
import com.lofuyu.borderledger.local.CaptureCommitRequest
import com.lofuyu.borderledger.local.CaptureCommitResult
import com.lofuyu.borderledger.local.EncryptedCaptureIntakeStore
import com.lofuyu.borderledger.parser.BankAlertParser
import com.lofuyu.borderledger.parser.ParseResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface CaptureSourceProfileProvider {
    fun approvedProfiles(): List<SourceProfile>

    fun profileFor(snapshot: AndroidNotificationSnapshot): SourceProfile? = approvedProfiles().firstOrNull { profile ->
        profile.approved &&
        snapshot.sourceProfileId == profile.sourceProfileId &&
            profile.matchesPackage(snapshot.packageName) &&
            profile.matchesChannel(snapshot.channelId) &&
            profile.matchesAndroidUserProfile(snapshot.androidUserProfile)
    } ?: approvedProfiles().firstOrNull { profile ->
        profile.approved &&
        snapshot.sourceProfileId == null &&
            profile.matchesPackage(snapshot.packageName) &&
            profile.matchesChannel(snapshot.channelId) &&
            profile.matchesAndroidUserProfile(snapshot.androidUserProfile)
    }

    fun isPackageApproved(packageName: String): Boolean = approvedProfiles().any { it.approved && it.matchesPackage(packageName) }

    fun sourceProfileForPackage(packageName: String): SourceProfile? = approvedProfiles().firstOrNull { it.approved && it.matchesPackage(packageName) }
}

class MutableSourceProfileRegistry : CaptureSourceProfileProvider {
    private val lock = Any()
    private var values: List<SourceProfile> = emptyList()

    override fun approvedProfiles(): List<SourceProfile> = synchronized(lock) { values.toList() }

    fun replace(profiles: List<SourceProfile>) {
        synchronized(lock) { values = profiles.distinctBy(SourceProfile::sourceProfileId) }
    }

    fun register(profile: SourceProfile) {
        synchronized(lock) {
            values = (values.filterNot { it.sourceProfileId == profile.sourceProfileId } + profile)
        }
    }

    fun remove(sourceProfileId: String) {
        synchronized(lock) { values = values.filterNot { it.sourceProfileId == sourceProfileId } }
    }
}

enum class CaptureItemStatus { QUEUED, REVIEW, ALREADY_PROCESSED, INTAKE_PAUSED, IGNORED, FAILED, CONFLICT }

data class CaptureItemResult(
    val status: CaptureItemStatus,
    val observationId: String? = null,
    val eventId: String? = null,
)

data class NotificationProcessResult(val items: List<CaptureItemResult>) {
    val queuedEventIds: List<String>
        get() = items.mapNotNull { item -> item.eventId.takeIf { item.status == CaptureItemStatus.QUEUED } }

    /** A replay can refer to a durable unsent event even when no new row was committed. */
    val requiresUploadScheduling: Boolean
        get() = items.any { it.status == CaptureItemStatus.QUEUED || it.status == CaptureItemStatus.ALREADY_PROCESSED }
}

/**
 * The callback boundary has no Android or storage side effect. The service
 * supplies a Default-dispatcher scope; tests can supply a test scope.
 */
class NotificationWorkDispatcher(
    private val scope: CoroutineScope,
    private val work: suspend () -> Unit,
) {
    fun dispatch() {
        scope.launch { work() }
    }
}

class BankNotificationIntake(
    private val profiles: CaptureSourceProfileProvider,
    private val store: EncryptedCaptureIntakeStore,
    private val health: CaptureHealthStore,
    private val parserFor: (SourceProfile) -> BankAlertParser,
    private val extractor: NotificationExtractor = NotificationExtractor(),
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val mutex = Mutex()
    private var activationAtMillis: Long? = null
    private var tracker: ObservationTracker? = null

    suspend fun onListenerConnected() = mutex.withLock {
        try {
            activationAtMillis = store.ensureActivation(clock())
            tracker = ObservationTracker(requireNotNull(activationAtMillis), nowMillis = clock)
            health.storageReady()
            health.listenerConnected()
            health.pendingCount(store.pendingCount())
            health.storedIntakeCount(store.storedIntakeCount())
        } catch (_: Exception) {
            health.storageFailed()
        }
    }

    suspend fun process(snapshot: AndroidNotificationSnapshot): NotificationProcessResult = mutex.withLock {
        if (health.monitoringIsPaused()) {
            return@withLock NotificationProcessResult(listOf(CaptureItemResult(CaptureItemStatus.INTAKE_PAUSED)))
        }
        val profile = profiles.profileFor(snapshot)
        if (profile == null) {
            health.ignoredSource()
            return@withLock NotificationProcessResult(listOf(CaptureItemResult(CaptureItemStatus.IGNORED)))
        }
        val extraction = extractor.extract(snapshot, profile)
        val messages = when (extraction) {
            is ExtractionResult.Ignored -> {
                if (extraction.reason == ExtractionIgnoreReason.CHANNEL_MISMATCH) health.genericOrMutedSource()
                else health.ignoredSource()
                return@withLock NotificationProcessResult(listOf(CaptureItemResult(CaptureItemStatus.IGNORED)))
            }
            is ExtractionResult.NeedsReview -> extraction.message?.let(::listOf) ?: run {
                health.reviewSource()
                return@withLock NotificationProcessResult(listOf(CaptureItemResult(CaptureItemStatus.REVIEW)))
            }
            is ExtractionResult.Accepted -> extraction.messages
        }
        if (messages.any { it.contentCapability != NotificationContentCapability.BOUNDED_TEXT }) {
            health.genericOrMutedSource()
            return@withLock NotificationProcessResult(messages.map {
                CaptureItemResult(CaptureItemStatus.IGNORED, it.observationId)
            })
        }
        val activeTracker = tracker ?: run {
            val activated = runCatching { store.ensureActivation(clock()) }.getOrElse {
                health.storageFailed()
                return@withLock NotificationProcessResult(messages.map {
                    CaptureItemResult(CaptureItemStatus.FAILED, it.observationId)
                })
            }
            activationAtMillis = activated
            ObservationTracker(activated, nowMillis = clock).also { tracker = it }
        }
        val diff = activeTracker.diff(messages)
        val processable = diff.newObservations + diff.reviewObservations
        val itemResults = processable.map { message -> processMessage(message, profile) }.toMutableList()
        if (diff.replayedObservations.isNotEmpty()) {
            itemResults += diff.replayedObservations.map {
                CaptureItemResult(CaptureItemStatus.ALREADY_PROCESSED, it.observationId)
            }
        }
        if (itemResults.any { it.status == CaptureItemStatus.FAILED || it.status == CaptureItemStatus.INTAKE_PAUSED }) {
            // ObservationTracker is process-local. Discard a mutation that did
            // not commit; the encrypted store remains the source of truth for
            // retryability after a full intake cap or storage failure.
            tracker = activationAtMillis?.let { ObservationTracker(it, nowMillis = clock) }
        }
        runCatching {
            health.pendingCount(store.pendingCount())
            health.storedIntakeCount(store.storedIntakeCount())
        }.onFailure { health.storageFailed() }
        NotificationProcessResult(itemResults)
    }

    private suspend fun processMessage(message: ObservedBankMessage, profile: SourceProfile): CaptureItemResult {
        val parsed = runCatching { parserFor(profile).parse(message, profile) }.getOrElse {
            health.storageFailed("parser_failed")
            return CaptureItemResult(CaptureItemStatus.FAILED, message.observationId)
        }
        if (parsed is ParseResult.Ignored) {
            health.ignoredSource()
            return CaptureItemResult(CaptureItemStatus.IGNORED, message.observationId)
        }
        val event = parsed.event
        if (event == null) {
            health.reviewSource()
            return CaptureItemResult(CaptureItemStatus.REVIEW, message.observationId)
        }
        val queue = parsed is ParseResult.Complete && message.observationDisposition == ObservationDisposition.ELIGIBLE
        val commit = store.commit(
            CaptureCommitRequest(
                message = message,
                event = event,
                disposition = if (queue) CaptureCandidateDisposition.QUEUED else CaptureCandidateDisposition.REVIEW,
            ),
        )
        return when (commit) {
            is CaptureCommitResult.Queued -> {
                health.eligibleSource()
                CaptureItemResult(CaptureItemStatus.QUEUED, message.observationId, commit.eventId)
            }
            is CaptureCommitResult.ReviewStored -> {
                health.reviewSource()
                CaptureItemResult(CaptureItemStatus.REVIEW, message.observationId, commit.eventId)
            }
            is CaptureCommitResult.AlreadyProcessed -> CaptureItemResult(CaptureItemStatus.ALREADY_PROCESSED, message.observationId, commit.eventId)
            is CaptureCommitResult.Conflict -> CaptureItemResult(CaptureItemStatus.CONFLICT, message.observationId, commit.eventId)
            CaptureCommitResult.IntakePaused -> CaptureItemResult(CaptureItemStatus.INTAKE_PAUSED, message.observationId, event.eventId)
            is CaptureCommitResult.PersistenceFailed -> {
                health.storageFailed(commit.code)
                CaptureItemResult(CaptureItemStatus.FAILED, message.observationId, event.eventId)
            }
        }
    }
}
