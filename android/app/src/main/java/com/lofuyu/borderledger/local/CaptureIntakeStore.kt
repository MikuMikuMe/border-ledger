package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.capture.CaptureIntakeLimits
import com.lofuyu.borderledger.capture.CaptureObservationKeys
import com.lofuyu.borderledger.capture.ObservationOrigin
import com.lofuyu.borderledger.capture.ObservedBankMessage
import com.lofuyu.borderledger.parser.BankAlertEventInput
import com.lofuyu.borderledger.parser.BankAlertEventType
import com.lofuyu.borderledger.parser.BankDisplayedTime
import com.lofuyu.borderledger.parser.BankTimePrecision
import com.lofuyu.borderledger.parser.BankYearProvenance
import com.lofuyu.borderledger.parser.EventCompleteness
import com.lofuyu.borderledger.parser.EventTimeBasis
import com.lofuyu.borderledger.parser.FeeTreatment
import com.lofuyu.borderledger.parser.InstrumentHint
import com.lofuyu.borderledger.parser.InstrumentHintKind
import com.lofuyu.borderledger.parser.Money
import com.lofuyu.borderledger.parser.MoneyComponent
import com.lofuyu.borderledger.parser.MoneyDirection
import com.lofuyu.borderledger.parser.MoneyRole
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class CaptureCandidateDisposition { QUEUED, REVIEW }

enum class CaptureCandidateStatus { REVIEW, QUEUED, ACKNOWLEDGED, CONFIRMED }

enum class CaptureAcknowledgementDisposition { ACKNOWLEDGED, REVIEW }

data class CaptureObservationRecord(
    val observationId: String,
    val logicalMessageKey: String?,
    val contentFingerprint: String,
    val eventId: String?,
    val notificationPostedAtMillis: Long?,
    val firstSeenAtMillis: Long,
    val origin: ObservationOrigin,
    val acknowledgedAtMillis: Long? = null,
)

data class CaptureCandidateRecord(
    val eventId: String,
    val observationId: String,
    val payload: ByteArray,
    val status: CaptureCandidateStatus,
    val createdAtMillis: Long,
    val acknowledgedAtMillis: Long? = null,
    val acknowledgementCode: String? = null,
    val acknowledgementReceiptId: String? = null,
    val acknowledgementRevision: Int? = null,
    val acknowledgementErrorCode: String? = null,
    val rawDiagnostic: String? = null,
    val rawDiagnosticExpiresAtMillis: Long? = null,
)

data class CaptureCommitRequest(
    val message: ObservedBankMessage,
    val event: BankAlertEventInput?,
    val disposition: CaptureCandidateDisposition,
    val nowMillis: Long? = null,
    val rawDiagnostic: String? = null,
)

sealed interface CaptureCommitResult {
    data class Queued(val eventId: String) : CaptureCommitResult
    data class ReviewStored(val eventId: String?) : CaptureCommitResult
    data class AlreadyProcessed(val eventId: String?) : CaptureCommitResult
    data class Conflict(val eventId: String?) : CaptureCommitResult
    data object IntakePaused : CaptureCommitResult
    data class PersistenceFailed(val code: String) : CaptureCommitResult
}

data class CaptureIntakeSnapshot(
    val activatedAtMillis: Long?,
    val observations: List<CaptureObservationRecord>,
    val candidates: List<CaptureCandidateRecord>,
    val outbox: List<QueuedAlert>,
)

data class CaptureRetentionResult(
    val removedAcknowledgedOutbox: Int,
    val removedAcknowledgedCandidates: Int,
    val removedReplayMetadata: Int,
    val clearedDiagnostics: Int,
)

/** Narrow durable boundary owned by the upload coordinator. */
interface CaptureUploadStore {
    suspend fun nextBatch(limit: Int): List<QueuedAlert>
    suspend fun applyAcknowledgements(acknowledgements: List<AlertAcknowledgement>)
    suspend fun purgeAcknowledged()
    suspend fun pendingCount(): Int
}

/**
 * One encrypted record is the transaction boundary for observation metadata,
 * normalized review/queue candidates, and immutable outbox bytes. A failed
 * write leaves the previous record untouched, so Queued is only returned
 * after the encrypted commit succeeds.
 */
class EncryptedCaptureIntakeStore(
    private val records: EncryptedRecordStore,
    private val pendingLimit: Int = CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : CaptureUploadStore {
    init {
        require(pendingLimit in 1..CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS)
    }

    private val mutex = Mutex()

    suspend fun ensureActivation(nowMillis: Long = clock()): Long = mutex.withLock {
        val current = readState()
        if (current.activatedAtMillis != null) return@withLock current.activatedAtMillis
        val activated = current.copy(activatedAtMillis = nowMillis)
        writeState(activated)
        requireNotNull(activated.activatedAtMillis)
    }

    suspend fun commit(request: CaptureCommitRequest): CaptureCommitResult = commitBatch(listOf(request)).single()

    /**
     * Commits a group of observations against one decoded state and one
     * encrypted write. Notification groups and bounded-import tests can
     * therefore exercise the same cap/idempotency rules without rewriting the
     * entire retained record once per item.
     */
    suspend fun commitBatch(requests: List<CaptureCommitRequest>): List<CaptureCommitResult> {
        require(requests.isNotEmpty())
        return mutex.withLock {
            val initial = try {
                readState()
            } catch (error: Exception) {
                return@withLock requests.map {
                    CaptureCommitResult.PersistenceFailed("encrypted_storage_unavailable")
                }
            }
            val results = ArrayList<CaptureCommitResult>(requests.size)
            var current = initial
            val changed: Boolean
            if (requests.size == 1) {
                val evaluation = evaluateCommit(initial, requests.single())
                results += evaluation.result
                current = evaluation.state
                changed = evaluation.changed
            } else {
                val mutable = MutableCommitState(initial)
                requests.forEach { request ->
                    val result = evaluateBatchCommit(mutable, request)
                    results += result
                }
                current = mutable.toPersistedState()
                changed = results.any { it is CaptureCommitResult.Queued || it is CaptureCommitResult.ReviewStored }
            }
            if (!changed) return@withLock results
            try {
                writeState(current)
            } catch (error: Exception) {
                return@withLock requests.map {
                    CaptureCommitResult.PersistenceFailed("encrypted_commit_failed")
                }
            }
            results
        }
    }

    private fun evaluateBatchCommit(
        state: MutableCommitState,
        request: CaptureCommitRequest,
    ): CaptureCommitResult {
        val message = request.message
        val logicalKey = CaptureObservationKeys.logicalMessageKey(message)
        val contentFingerprint = CaptureObservationKeys.contentFingerprint(message)
        val repeatedUnknown = logicalKey == null && contentFingerprint in state.unknownFingerprints
        val effectiveDisposition = if (repeatedUnknown) CaptureCandidateDisposition.REVIEW else request.disposition
        val event = request.event
        if (effectiveDisposition == CaptureCandidateDisposition.QUEUED && event == null) {
            return CaptureCommitResult.PersistenceFailed("missing_normalized_event")
        }
        if (event != null && event.observationId != message.observationId) {
            return CaptureCommitResult.Conflict(event.eventId)
        }

        val now = request.nowMillis ?: clock()
        val payload = try {
            event?.let(BankAlertEventCodec::encode)
        } catch (_: Exception) {
            return CaptureCommitResult.PersistenceFailed("event_encoding_failed")
        }
        val eventId = event?.eventId
        if (event != null) {
            val existingPayload = state.eventPayloads[event.eventId]
            val eventIdentitySeen = event.eventId in state.eventIdentities
            if (existingPayload != null || eventIdentitySeen) {
                if (existingPayload == null) return CaptureCommitResult.Conflict(event.eventId)
                val sameCanonicalPayload = try {
                    BankAlertEventCodec.canonicalPayload(event).contentEquals(
                        BankAlertEventCodec.canonicalPayload(BankAlertEventCodec.decode(existingPayload)),
                    )
                } catch (_: Exception) {
                    return CaptureCommitResult.PersistenceFailed("event_encoding_failed")
                }
                return if (sameCanonicalPayload) {
                    CaptureCommitResult.AlreadyProcessed(event.eventId)
                } else {
                    CaptureCommitResult.Conflict(event.eventId)
                }
            }
        }
        state.observationsById[message.observationId]?.let { observation ->
            return CaptureCommitResult.AlreadyProcessed(observation.eventId)
        }
        if (logicalKey != null) {
            state.observationsByLogicalKey[logicalKey]?.let { observation ->
                return CaptureCommitResult.AlreadyProcessed(observation.eventId)
            }
        }

        val observation = CaptureObservationRecord(
            observationId = message.observationId,
            logicalMessageKey = logicalKey,
            contentFingerprint = contentFingerprint,
            eventId = eventId,
            notificationPostedAtMillis = message.notificationPostedAtMillis,
            firstSeenAtMillis = now,
            origin = message.origin,
        )
        val candidate = if (event != null) {
            CaptureCandidateRecord(
                eventId = event.eventId,
                observationId = message.observationId,
                payload = payload!!.copyOf(),
                status = if (effectiveDisposition == CaptureCandidateDisposition.QUEUED) {
                    CaptureCandidateStatus.QUEUED
                } else {
                    CaptureCandidateStatus.REVIEW
                },
                createdAtMillis = now,
                rawDiagnostic = request.rawDiagnostic?.take(MAX_DIAGNOSTIC_CHARS),
                rawDiagnosticExpiresAtMillis = request.rawDiagnostic?.let {
                    now + CaptureIntakeLimits.UNRESOLVED_DIAGNOSTIC_RETENTION_MILLIS
                },
            )
        } else {
            null
        }
        val queued = if (effectiveDisposition == CaptureCandidateDisposition.QUEUED && event != null) {
            QueuedAlert(
                localId = message.observationId,
                ownerLedgerId = PERSONAL_LEDGER,
                eventId = event.eventId,
                payload = payload!!.copyOf(),
                createdAtMillis = now,
            )
        } else {
            null
        }
        val identity = if (event == null) {
            "observation:${message.observationId}"
        } else {
            "event:${event.eventId}"
        }
        if (identity !in state.intakeIdentities && state.intakeIdentities.size >= pendingLimit) {
            return CaptureCommitResult.IntakePaused
        }

        state.observations += observation
        state.observationsById[observation.observationId] = observation
        if (logicalKey != null) {
            state.observationsByLogicalKey.putIfAbsent(logicalKey, observation)
        } else {
            state.unknownFingerprints += contentFingerprint
        }
        if (event != null) {
            state.eventIdentities += event.eventId
            state.eventPayloads[event.eventId] = payload!!.copyOf()
        }
        candidate?.let(state.candidates::add)
        queued?.let(state.outbox::add)
        state.intakeIdentities += identity
        return when (effectiveDisposition) {
            CaptureCandidateDisposition.QUEUED -> CaptureCommitResult.Queued(requireNotNull(eventId))
            CaptureCandidateDisposition.REVIEW -> CaptureCommitResult.ReviewStored(eventId)
        }
    }

    private fun evaluateCommit(
        current: PersistedCaptureState,
        request: CaptureCommitRequest,
    ): CommitEvaluation {
        val message = request.message
        val logicalKey = CaptureObservationKeys.logicalMessageKey(message)
        val contentFingerprint = CaptureObservationKeys.contentFingerprint(message)
        val repeatedUnknown = logicalKey == null && current.observations.any {
            it.logicalMessageKey == null && it.contentFingerprint == contentFingerprint
        }
        val effectiveDisposition = if (repeatedUnknown) CaptureCandidateDisposition.REVIEW else request.disposition
        val event = request.event
        if (effectiveDisposition == CaptureCandidateDisposition.QUEUED && event == null) {
            return CommitEvaluation(current, CaptureCommitResult.PersistenceFailed("missing_normalized_event"))
        }
        if (event != null && event.observationId != message.observationId) {
            return CommitEvaluation(current, CaptureCommitResult.Conflict(event.eventId))
        }

        val now = request.nowMillis ?: clock()
        val payload = try {
            event?.let(BankAlertEventCodec::encode)
        } catch (_: Exception) {
            return CommitEvaluation(current, CaptureCommitResult.PersistenceFailed("event_encoding_failed"))
        }
        val eventId = event?.eventId
        if (event != null) {
            val existingPayload = current.candidates.asSequence()
                .filter { it.eventId == event.eventId }
                .map(CaptureCandidateRecord::payload)
                .plus(
                    current.outbox.asSequence()
                        .filter { it.eventId == event.eventId }
                        .map(QueuedAlert::payload),
                )
                .firstOrNull()
            val eventIdentitySeen = current.observations.any { it.eventId == event.eventId }
            if (existingPayload != null || eventIdentitySeen) {
                if (existingPayload == null) {
                    return CommitEvaluation(current, CaptureCommitResult.Conflict(event.eventId))
                }
                val sameCanonicalPayload = try {
                    BankAlertEventCodec.canonicalPayload(event).contentEquals(
                        BankAlertEventCodec.canonicalPayload(BankAlertEventCodec.decode(existingPayload)),
                    )
                } catch (_: Exception) {
                    return CommitEvaluation(current, CaptureCommitResult.PersistenceFailed("event_encoding_failed"))
                }
                return CommitEvaluation(current, if (sameCanonicalPayload) {
                    CaptureCommitResult.AlreadyProcessed(event.eventId)
                } else {
                    CaptureCommitResult.Conflict(event.eventId)
                })
            }
        }
        val exact = current.observations.firstOrNull { it.observationId == message.observationId }
        if (exact != null) return CommitEvaluation(current, CaptureCommitResult.AlreadyProcessed(exact.eventId))
        val logical = logicalKey?.let { key -> current.observations.firstOrNull { it.logicalMessageKey == key } }
        if (logical != null) return CommitEvaluation(current, CaptureCommitResult.AlreadyProcessed(logical.eventId))

        val observation = CaptureObservationRecord(
            observationId = message.observationId,
            logicalMessageKey = logicalKey,
            contentFingerprint = contentFingerprint,
            eventId = eventId,
            notificationPostedAtMillis = message.notificationPostedAtMillis,
            firstSeenAtMillis = now,
            origin = message.origin,
        )
        val candidate = if (event != null) {
            CaptureCandidateRecord(
                eventId = event.eventId,
                observationId = message.observationId,
                payload = payload!!.copyOf(),
                status = if (effectiveDisposition == CaptureCandidateDisposition.QUEUED) {
                    CaptureCandidateStatus.QUEUED
                } else {
                    CaptureCandidateStatus.REVIEW
                },
                createdAtMillis = now,
                rawDiagnostic = request.rawDiagnostic?.take(MAX_DIAGNOSTIC_CHARS),
                rawDiagnosticExpiresAtMillis = request.rawDiagnostic?.let {
                    now + CaptureIntakeLimits.UNRESOLVED_DIAGNOSTIC_RETENTION_MILLIS
                },
            )
        } else {
            null
        }
        val queued = if (effectiveDisposition == CaptureCandidateDisposition.QUEUED && event != null) {
            QueuedAlert(
                localId = message.observationId,
                ownerLedgerId = PERSONAL_LEDGER,
                eventId = event.eventId,
                payload = payload!!.copyOf(),
                createdAtMillis = now,
            )
        } else {
            null
        }
        val updated = current.copy(
            observations = current.observations + observation,
            candidates = candidate?.let { current.candidates + it } ?: current.candidates,
            outbox = queued?.let { current.outbox + it } ?: current.outbox,
        )
        if (storedIntakeCount(updated) > pendingLimit.toLong()) {
            // Do not evict review evidence or an unsent event to make room.
            return CommitEvaluation(current, CaptureCommitResult.IntakePaused)
        }
        val result = when (effectiveDisposition) {
            CaptureCandidateDisposition.QUEUED -> CaptureCommitResult.Queued(requireNotNull(eventId))
            CaptureCandidateDisposition.REVIEW -> CaptureCommitResult.ReviewStored(eventId)
        }
        return CommitEvaluation(updated, result, changed = true)
    }

    override suspend fun nextBatch(limit: Int): List<QueuedAlert> = mutex.withLock {
        require(limit in 1..CaptureIntakeLimits.MAX_BATCH_EVENTS)
        readState().outbox.asSequence()
            .filterNot(QueuedAlert::acknowledged)
            .sortedWith(compareBy(QueuedAlert::createdAtMillis, QueuedAlert::eventId))
            .take(limit)
            .map { it.copy(payload = it.payload.copyOf()) }
            .toList()
    }

    override suspend fun pendingCount(): Int = mutex.withLock { readState().outbox.count { !it.acknowledged } }

    suspend fun storedIntakeCount(): Int = mutex.withLock {
        storedIntakeCount(readState()).toInt()
    }

    override suspend fun applyAcknowledgements(acknowledgements: List<AlertAcknowledgement>) = mutex.withLock {
        if (acknowledgements.isEmpty()) return@withLock
        val now = clock()
        val byEvent = acknowledgements.associateBy { it.eventId }
        val existing = readState()
        val updatedOutbox = existing.outbox.map { item ->
            val ack = byEvent[item.eventId] ?: return@map item
            item.copy(
                acknowledged = true,
                acknowledgementCode = ack.code,
                receiptId = ack.receiptId,
                acknowledgementRevision = ack.revision,
                acknowledgementErrorCode = ack.errorCode,
            )
        }
        val updatedCandidates = existing.candidates.map { candidate ->
            val ack = byEvent[candidate.eventId]
            if (ack == null || candidate.status == CaptureCandidateStatus.CONFIRMED) candidate
            else if (ack.disposition == CaptureAcknowledgementDisposition.REVIEW) {
                candidate.copy(
                    status = CaptureCandidateStatus.REVIEW,
                    acknowledgedAtMillis = null,
                    acknowledgementCode = ack.code,
                    acknowledgementReceiptId = ack.receiptId,
                    acknowledgementRevision = ack.revision,
                    acknowledgementErrorCode = ack.errorCode,
                )
            } else {
                candidate.copy(
                    status = CaptureCandidateStatus.ACKNOWLEDGED,
                    acknowledgedAtMillis = now,
                    acknowledgementCode = ack.code,
                    acknowledgementReceiptId = ack.receiptId,
                    acknowledgementRevision = ack.revision,
                    acknowledgementErrorCode = ack.errorCode,
                )
            }
        }
        val updatedObservations = existing.observations.map { observation ->
            if (observation.eventId in byEvent && observation.acknowledgedAtMillis == null) {
                observation.copy(acknowledgedAtMillis = now)
            } else {
                observation
            }
        }
        writeState(existing.copy(
            observations = updatedObservations,
            candidates = updatedCandidates,
            outbox = updatedOutbox,
        ))
    }

    /** Purges only rows already durably acknowledged; review candidates remain. */
    override suspend fun purgeAcknowledged() = mutex.withLock {
        val existing = readState()
        writeState(existing.copy(outbox = existing.outbox.filterNot(QueuedAlert::acknowledged)))
    }

    suspend fun markConfirmed(eventId: String) = mutex.withLock {
        val existing = readState()
        if (existing.candidates.none { it.eventId == eventId }) return@withLock
        writeState(existing.copy(candidates = existing.candidates.map {
            if (it.eventId == eventId) it.copy(status = CaptureCandidateStatus.CONFIRMED) else it
        }))
    }

    suspend fun retain(nowMillis: Long = clock()): CaptureRetentionResult = mutex.withLock {
        val existing = readState()
        val unsentIds = existing.outbox.asSequence().filterNot(QueuedAlert::acknowledged).map(QueuedAlert::eventId).toSet()
        val confirmedIds = existing.candidates.asSequence()
            .filter { it.status == CaptureCandidateStatus.CONFIRMED }
            .map(CaptureCandidateRecord::eventId)
            .toSet()
        val expiredAcknowledgedIds = existing.outbox.asSequence()
            .filter { it.acknowledged }
            .filter { item ->
                val acknowledgedAt = existing.candidates.firstOrNull { it.eventId == item.eventId }?.acknowledgedAtMillis
                acknowledgedAt != null && acknowledgedAt + CaptureIntakeLimits.ACKNOWLEDGED_EVIDENCE_RETENTION_MILLIS <= nowMillis
            }
            .map(QueuedAlert::eventId)
            .toSet()
        val keptOutbox = existing.outbox.filterNot { it.eventId in expiredAcknowledgedIds }
        val keptCandidates = existing.candidates.mapNotNull { candidate ->
            val diagnosticExpired = candidate.rawDiagnosticExpiresAtMillis?.let { it <= nowMillis } == true
            if (candidate.eventId in expiredAcknowledgedIds &&
                candidate.eventId !in confirmedIds &&
                candidate.status == CaptureCandidateStatus.ACKNOWLEDGED
            ) {
                null
            } else {
                candidate.copy(
                    rawDiagnostic = if (diagnosticExpired) null else candidate.rawDiagnostic,
                    rawDiagnosticExpiresAtMillis = if (diagnosticExpired) null else candidate.rawDiagnosticExpiresAtMillis,
                )
            }
        }
        val keptObservations = existing.observations.filter { observation ->
            val replayMetadataLive = observation.firstSeenAtMillis + CaptureIntakeLimits.REPLAY_METADATA_RETENTION_MILLIS > nowMillis
            observation.eventId in unsentIds || observation.eventId in confirmedIds || replayMetadataLive
        }
        val result = CaptureRetentionResult(
            removedAcknowledgedOutbox = existing.outbox.size - keptOutbox.size,
            removedAcknowledgedCandidates = existing.candidates.count { old -> keptCandidates.none { it.eventId == old.eventId } },
            removedReplayMetadata = existing.observations.size - keptObservations.size,
            clearedDiagnostics = existing.candidates.count { old ->
                old.rawDiagnostic != null && keptCandidates.any { it.eventId == old.eventId && it.rawDiagnostic == null }
            },
        )
        writeState(existing.copy(
            observations = keptObservations,
            candidates = keptCandidates,
            outbox = keptOutbox,
        ))
        result
    }

    suspend fun snapshot(): CaptureIntakeSnapshot = mutex.withLock {
        val current = readState()
        current.toSnapshot()
    }

    private suspend fun readState(): PersistedCaptureState {
        val bytes = records.read(LedgerRecord.CAPTURE_INTAKE) ?: return PersistedCaptureState()
        return CaptureIntakeStateCodec.decode(bytes).also { state ->
            if (storedIntakeCount(state) > pendingLimit.toLong()) {
                throw SecureStorageException("Encrypted capture intake exceeds its retained-item cap.")
            }
        }
    }

    private suspend fun writeState(state: PersistedCaptureState) {
        records.write(LedgerRecord.CAPTURE_INTAKE, CaptureIntakeStateCodec.encode(state))
    }

    /** Count each pending event identity or unresolved observation once. */
    private fun storedIntakeCount(state: PersistedCaptureState): Long = state.storedIntakeIdentityCount()

    private data class CommitEvaluation(
        val state: PersistedCaptureState,
        val result: CaptureCommitResult,
        val changed: Boolean = false,
    )

    private class MutableCommitState(initial: PersistedCaptureState) {
        private val activatedAtMillis = initial.activatedAtMillis
        val observations = initial.observations.toMutableList()
        val candidates = initial.candidates.toMutableList()
        val outbox = initial.outbox.toMutableList()
        val observationsById = initial.observations.associateBy { it.observationId }.toMutableMap()
        val observationsByLogicalKey = LinkedHashMap<String, CaptureObservationRecord>().apply {
            initial.observations.forEach { observation ->
                observation.logicalMessageKey?.let { putIfAbsent(it, observation) }
            }
        }
        val unknownFingerprints = initial.observations.asSequence()
            .filter { it.logicalMessageKey == null }
            .mapTo(mutableSetOf(), CaptureObservationRecord::contentFingerprint)
        val eventIdentities = initial.observations.mapNotNullTo(mutableSetOf(), CaptureObservationRecord::eventId)
        val eventPayloads = LinkedHashMap<String, ByteArray>().apply {
            initial.candidates.forEach { putIfAbsent(it.eventId, it.payload) }
            initial.outbox.forEach { putIfAbsent(it.eventId, it.payload) }
        }
        val intakeIdentities = mutableSetOf<String>().apply {
            initial.observations
                .filter { it.eventId == null }
                .forEach { add("observation:${it.observationId}") }
            initial.candidates
                .filter { it.status == CaptureCandidateStatus.REVIEW }
                .forEach { add("event:${it.eventId}") }
            initial.outbox
                .filterNot(QueuedAlert::acknowledged)
                .forEach { add("event:${it.eventId}") }
        }

        fun toPersistedState(): PersistedCaptureState = PersistedCaptureState(
            activatedAtMillis = activatedAtMillis,
            observations = observations.toList(),
            candidates = candidates.toList(),
            outbox = outbox.toList(),
        )
    }

    private data class PersistedCaptureState(
        val activatedAtMillis: Long? = null,
        val observations: List<CaptureObservationRecord> = emptyList(),
        val candidates: List<CaptureCandidateRecord> = emptyList(),
        val outbox: List<QueuedAlert> = emptyList(),
    ) {
        fun storedIntakeIdentityCount(): Long {
            val identities = mutableSetOf<String>()
            // Eventful observations are replay metadata; their pending work is
            // represented by the outbox or unresolved candidate below.
            // Eventless observations remain fail-closed review evidence until
            // replay-metadata retention removes them; they never become queued money.
            observations.asSequence()
                .filter { it.eventId == null }
                .forEach { observation -> identities += "observation:${observation.observationId}" }
            candidates.asSequence()
                .filter { it.status == CaptureCandidateStatus.REVIEW }
                .forEach { candidate -> identities += "event:${candidate.eventId}" }
            outbox.asSequence()
                .filterNot(QueuedAlert::acknowledged)
                .forEach { item -> identities += "event:${item.eventId}" }
            return identities.size.toLong()
        }

        fun toSnapshot() = CaptureIntakeSnapshot(activatedAtMillis, observations, candidates, outbox)
    }

    private companion object {
        const val PERSONAL_LEDGER = "personal"
        const val MAX_DIAGNOSTIC_CHARS = 512
    }

    private object CaptureIntakeStateCodec {
        private const val FORMAT_VERSION = 3
        // Keep the persisted intake cap below decoder budgets so malformed or
        // stale records cannot request unbounded collection allocation. The
        // total budget allows up to three physical rows per event identity.
        private const val MAX_DECODE_COLLECTION_ITEMS = CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS + 512
        private const val MAX_DECODE_TOTAL_ITEMS = CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS * 3 + 1_024

        fun encode(state: PersistedCaptureState): ByteArray {
            val decodedRows = state.observations.size.toLong() +
                state.candidates.size.toLong() +
                state.outbox.size.toLong()
            require(state.storedIntakeIdentityCount() <= CaptureIntakeLimits.MAX_STORED_INTAKE_ITEMS.toLong())
            require(state.observations.size <= MAX_DECODE_COLLECTION_ITEMS)
            require(state.candidates.size <= MAX_DECODE_COLLECTION_ITEMS)
            require(state.outbox.size <= MAX_DECODE_COLLECTION_ITEMS)
            require(decodedRows <= MAX_DECODE_TOTAL_ITEMS.toLong())
            return ByteArrayOutputStream().use { bytes ->
                DataOutputStream(bytes).use { output ->
                    output.writeInt(FORMAT_VERSION)
                    writeNullableLong(output, state.activatedAtMillis)
                    output.writeInt(state.observations.size)
                    state.observations.forEach { observation ->
                        output.writeUTF(observation.observationId)
                        writeNullable(output, observation.logicalMessageKey)
                        output.writeUTF(observation.contentFingerprint)
                        writeNullable(output, observation.eventId)
                        writeNullableLong(output, observation.notificationPostedAtMillis)
                        output.writeLong(observation.firstSeenAtMillis)
                        output.writeUTF(observation.origin.name)
                        writeNullableLong(output, observation.acknowledgedAtMillis)
                    }
                    output.writeInt(state.candidates.size)
                    state.candidates.forEach { candidate ->
                        output.writeUTF(candidate.eventId)
                        output.writeUTF(candidate.observationId)
                        output.writeUTF(candidate.status.name)
                        output.writeLong(candidate.createdAtMillis)
                        writeNullableLong(output, candidate.acknowledgedAtMillis)
                        writeNullable(output, candidate.acknowledgementCode)
                        writeNullable(output, candidate.acknowledgementReceiptId)
                        writeNullableInt(output, candidate.acknowledgementRevision)
                        writeNullable(output, candidate.acknowledgementErrorCode)
                        writeNullable(output, candidate.rawDiagnostic)
                        writeNullableLong(output, candidate.rawDiagnosticExpiresAtMillis)
                        output.writeInt(candidate.payload.size)
                        output.write(candidate.payload)
                    }
                    output.writeInt(state.outbox.size)
                    state.outbox.forEach { item ->
                        output.writeUTF(item.localId)
                        output.writeUTF(item.ownerLedgerId)
                        output.writeUTF(item.eventId)
                        output.writeLong(item.createdAtMillis)
                        output.writeBoolean(item.acknowledged)
                        writeNullable(output, item.acknowledgementCode)
                        writeNullable(output, item.receiptId)
                        writeNullableInt(output, item.acknowledgementRevision)
                        writeNullable(output, item.acknowledgementErrorCode)
                        output.writeInt(item.payload.size)
                        output.write(item.payload)
                    }
                }
                bytes.toByteArray()
            }
        }

        fun decode(bytes: ByteArray): PersistedCaptureState = try {
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                val version = input.readInt()
                if (version !in 1..FORMAT_VERSION) throw SecureStorageException("Encrypted capture intake format is not supported.")
                val activation = readNullableLong(input)
                val budget = DecodeBudget()
                val observations = List(budget.readCount(input)) {
                    CaptureObservationRecord(
                        observationId = input.readUTF(),
                        logicalMessageKey = readNullable(input),
                        contentFingerprint = input.readUTF(),
                        eventId = readNullable(input),
                        notificationPostedAtMillis = readNullableLong(input),
                        firstSeenAtMillis = input.readLong(),
                        origin = enumValue(input.readUTF(), ObservationOrigin.values()),
                        acknowledgedAtMillis = readNullableLong(input),
                    )
                }
                val candidates = List(budget.readCount(input)) {
                    val eventId = input.readUTF()
                    val observationId = input.readUTF()
                    val status = enumValue(input.readUTF(), CaptureCandidateStatus.values())
                    val createdAt = input.readLong()
                    val acknowledgedAt = readNullableLong(input)
                    val acknowledgementCode = if (version >= 2) readNullable(input) else null
                    val acknowledgementReceiptId = if (version >= 3) readNullable(input) else null
                    val acknowledgementRevision = if (version >= 3) readNullableInt(input) else null
                    val acknowledgementErrorCode = if (version >= 3) readNullable(input) else null
                    val diagnostic = readNullable(input)
                    val diagnosticExpiry = readNullableLong(input)
                    val payload = readPayload(input)
                    CaptureCandidateRecord(
                        eventId, observationId, payload, status, createdAt, acknowledgedAt,
                        acknowledgementCode, acknowledgementReceiptId, acknowledgementRevision,
                        acknowledgementErrorCode, diagnostic, diagnosticExpiry,
                    )
                }
                val outbox = List(budget.readCount(input)) {
                    val localId = input.readUTF()
                    val ownerLedgerId = input.readUTF()
                    val eventId = input.readUTF()
                    val createdAt = input.readLong()
                    val acknowledged = input.readBoolean()
                    val code = readNullable(input)
                    val receiptId = if (version >= 3) readNullable(input) else null
                    val acknowledgementRevision = if (version >= 3) readNullableInt(input) else null
                    val acknowledgementErrorCode = if (version >= 3) readNullable(input) else null
                    val payload = readPayload(input)
                    QueuedAlert(localId, ownerLedgerId, eventId, payload, createdAt, acknowledged, code, receiptId, acknowledgementRevision, acknowledgementErrorCode)
                }
                PersistedCaptureState(activation, observations, candidates, outbox)
            }
        } catch (error: SecureStorageException) {
            throw error
        } catch (error: Exception) {
            throw SecureStorageException("Encrypted capture intake could not be opened.", error)
        }

        private class DecodeBudget {
            private var decodedItems = 0

            fun readCount(input: DataInputStream): Int = input.readInt().also { count ->
                if (count !in 0..MAX_DECODE_COLLECTION_ITEMS ||
                    decodedItems.toLong() + count > MAX_DECODE_TOTAL_ITEMS.toLong()
                ) {
                    throw SecureStorageException("Encrypted capture intake item count is not valid.")
                }
                decodedItems += count
            }
        }

        private fun readPayload(input: DataInputStream): ByteArray {
            val size = input.readInt()
            if (size !in 1..CaptureIntakeLimits.MAX_BATCH_BYTES) throw SecureStorageException("Encrypted capture payload is not valid.")
            return ByteArray(size).also(input::readFully)
        }

        private fun writeNullable(output: DataOutputStream, value: String?) {
            output.writeBoolean(value != null)
            if (value != null) output.writeUTF(value)
        }

        private fun readNullable(input: DataInputStream): String? = if (input.readBoolean()) input.readUTF() else null

        private fun writeNullableLong(output: DataOutputStream, value: Long?) {
            output.writeBoolean(value != null)
            if (value != null) output.writeLong(value)
        }

        private fun readNullableLong(input: DataInputStream): Long? = if (input.readBoolean()) input.readLong() else null

        private fun writeNullableInt(output: DataOutputStream, value: Int?) {
            output.writeBoolean(value != null)
            if (value != null) output.writeInt(value)
        }

        private fun readNullableInt(input: DataInputStream): Int? = if (input.readBoolean()) input.readInt() else null

        private inline fun <reified T : Enum<T>> enumValue(value: String, values: Array<T>): T =
            values.firstOrNull { it.name == value } ?: throw SecureStorageException("Encrypted capture intake enum is not valid.")
    }
}

/** Stable, bounded wire bytes for the normalized event kept in the local outbox. */
object BankAlertEventCodec {
    private const val FORMAT_VERSION = 1
    private const val CANONICAL_OBSERVATION_ID = "canonical-observation"
    private const val CANONICAL_CAPTURED_AT = "1970-01-01T00:00:00Z"

    /** Compare event content across observations without replay-local identity/time. */
    fun canonicalPayload(event: BankAlertEventInput): ByteArray = encode(
        event.copy(
            observationId = CANONICAL_OBSERVATION_ID,
            capturedAt = CANONICAL_CAPTURED_AT,
        ),
    )

    fun encode(event: BankAlertEventInput): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeInt(event.schemaVersion)
            output.writeUTF(event.eventId)
            output.writeUTF(event.observationId)
            output.writeUTF(event.sourceProfileId)
            output.writeUTF(event.parserVersion)
            writeNullable(output, event.notificationPostedAt)
            output.writeUTF(event.capturedAt)
            output.writeUTF(event.eventTimeBasis.wireValue)
            output.writeUTF(event.eventType.wireValue)
            output.writeUTF(event.direction.wireValue)
            writeHint(output, event.instrumentHint)
            writeMoney(output, event.eventMoney)
            writeNullable(output, event.primaryMoneyRole?.wireValue)
            output.writeInt(event.amounts.size)
            event.amounts.forEach { amount ->
                output.writeUTF(amount.role.wireValue)
                output.writeUTF(amount.currency)
                output.writeLong(amount.amountMinor)
            }
            output.writeUTF(event.feeTreatment.wireValue)
            writeNullable(output, event.bankReference)
            writeBankTime(output, event.bankDisplayedTime)
            writeNullable(output, event.merchant)
            output.writeBoolean(event.completeness.individualTimestamp)
            output.writeBoolean(event.completeness.supportedSource)
            output.writeBoolean(event.completeness.labeledMoney)
        }
        bytes.toByteArray().also { require(it.size <= CaptureIntakeLimits.MAX_BATCH_BYTES) }
    }

    fun decode(bytes: ByteArray): BankAlertEventInput = try {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            if (input.readInt() != FORMAT_VERSION) throw SecureStorageException("Capture event format is not supported.")
            val schemaVersion = input.readInt()
            val eventId = input.readUTF()
            val observationId = input.readUTF()
            val sourceProfileId = input.readUTF()
            val parserVersion = input.readUTF()
            val notificationPostedAt = readNullable(input)
            val capturedAt = input.readUTF()
            val eventTimeBasis = enumByWire(input.readUTF(), EventTimeBasis.values()) { it.wireValue }
            val eventType = enumByWire(input.readUTF(), BankAlertEventType.values()) { it.wireValue }
            val direction = enumByWire(input.readUTF(), MoneyDirection.values()) { it.wireValue }
            val hint = readHint(input)
            val eventMoney = readMoney(input)
            val primaryRole = readNullable(input)?.let { value -> enumByWire(value, MoneyRole.values()) { it.wireValue } }
            val amountCount = input.readInt()
            if (amountCount !in 0..CaptureIntakeLimits.MAX_BATCH_EVENTS) throw SecureStorageException("Capture event amount count is not valid.")
            val amounts = List(amountCount) {
                MoneyComponent(
                    role = enumByWire(input.readUTF(), MoneyRole.values()) { it.wireValue },
                    currency = input.readUTF(),
                    amountMinor = input.readLong(),
                )
            }
            val fee = enumByWire(input.readUTF(), FeeTreatment.values()) { it.wireValue }
            val reference = readNullable(input)
            val bankTime = readBankTime(input)
            val merchant = readNullable(input)
            val completeness = EventCompleteness(input.readBoolean(), input.readBoolean(), input.readBoolean())
            BankAlertEventInput(
                schemaVersion, eventId, observationId, sourceProfileId, parserVersion,
                notificationPostedAt, capturedAt, eventTimeBasis, eventType, direction,
                hint, eventMoney, primaryRole, amounts, fee, reference, bankTime, merchant, completeness,
            )
        }
    } catch (error: SecureStorageException) {
        throw error
    } catch (error: Exception) {
        throw SecureStorageException("Capture event could not be opened.", error)
    }

    private fun writeHint(output: DataOutputStream, value: InstrumentHint?) {
        output.writeBoolean(value != null)
        if (value != null) {
            output.writeUTF(value.kind.wireValue)
            output.writeUTF(value.value)
        }
    }

    private fun readHint(input: DataInputStream): InstrumentHint? = if (input.readBoolean()) {
        InstrumentHint(
            enumByWire(input.readUTF(), InstrumentHintKind.values()) { it.wireValue },
            input.readUTF(),
        )
    } else {
        null
    }

    private fun writeMoney(output: DataOutputStream, value: Money?) {
        output.writeBoolean(value != null)
        if (value != null) {
            output.writeUTF(value.currency)
            output.writeLong(value.amountMinor)
        }
    }

    private fun readMoney(input: DataInputStream): Money? = if (input.readBoolean()) Money(input.readUTF(), input.readLong()) else null

    private fun writeBankTime(output: DataOutputStream, value: BankDisplayedTime?) {
        output.writeBoolean(value != null)
        if (value != null) {
            writeNullable(output, value.localDateTime)
            writeNullable(output, value.zone)
            output.writeUTF(value.precision.wireValue)
            output.writeUTF(value.yearProvenance.wireValue)
        }
    }

    private fun readBankTime(input: DataInputStream): BankDisplayedTime? = if (input.readBoolean()) {
        BankDisplayedTime(
            readNullable(input),
            readNullable(input),
            enumByWire(input.readUTF(), BankTimePrecision.values()) { it.wireValue },
            enumByWire(input.readUTF(), BankYearProvenance.values()) { it.wireValue },
        )
    } else {
        null
    }

    private fun writeNullable(output: DataOutputStream, value: String?) {
        output.writeBoolean(value != null)
        if (value != null) output.writeUTF(value)
    }

    private fun readNullable(input: DataInputStream): String? = if (input.readBoolean()) input.readUTF() else null

    private fun <T> enumByWire(value: String, values: Array<T>, wire: (T) -> String): T =
        values.firstOrNull { wire(it) == value } ?: throw SecureStorageException("Capture event enum is not valid.")
}
