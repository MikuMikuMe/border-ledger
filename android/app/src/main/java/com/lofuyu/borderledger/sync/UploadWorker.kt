package com.lofuyu.borderledger.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.lofuyu.borderledger.BorderLedgerApplication
import com.lofuyu.borderledger.api.CaptureEventAcknowledgement
import com.lofuyu.borderledger.api.CaptureUploadClient
import com.lofuyu.borderledger.api.CaptureUploadEvent
import com.lofuyu.borderledger.api.CaptureUploadJson
import com.lofuyu.borderledger.api.CaptureUploadResult
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.capture.CaptureIntakeLimits
import com.lofuyu.borderledger.local.AlertAcknowledgement
import com.lofuyu.borderledger.local.CaptureAcknowledgementDisposition
import com.lofuyu.borderledger.local.CaptureUploadStore
import com.lofuyu.borderledger.local.QueuedAlert
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

sealed interface UploadSyncResult {
    data object NoPendingEvents : UploadSyncResult
    data class Completed(val acknowledgementCount: Int) : UploadSyncResult
    data class Partial(val acknowledgementCount: Int) : UploadSyncResult
    data class Retry(val code: String, val retryAfterSeconds: Long?) : UploadSyncResult
    data class PairingRequired(val code: String) : UploadSyncResult
    data class Quarantined(val eventIds: List<String>, val code: String) : UploadSyncResult
}

/** One serialized foreground/background upload boundary for the encrypted intake. */
class CaptureUploadCoordinator(
    private val store: CaptureUploadStore,
    private val client: CaptureUploadClient,
    private val health: CaptureHealthStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val batchEncoder: (List<CaptureUploadEvent>) -> ByteArray = CaptureUploadJson::encode,
) {
    private val mutex = Mutex()

    suspend fun sync(): UploadSyncResult = mutex.withLock {
        val pending = store.nextBatch(CaptureIntakeLimits.MAX_BATCH_EVENTS)
        if (pending.isEmpty()) {
            health.uploadReady()
            return@withLock UploadSyncResult.NoPendingEvents
        }
        val batch = boundedBatch(pending)
        if (batch == null) {
            val invalid = pending.first()
            return@withLock quarantine(listOf(invalid), "payload_invalid_or_too_large")
        }
        when (val outcome = client.upload(batch.map { CaptureUploadEvent(it.eventId, it.payload.copyOf()) })) {
            is CaptureUploadResult.Success -> persistAcknowledgements(batch, outcome.acknowledgements)
            is CaptureUploadResult.Retryable -> {
                val attempt = (health.state.value.uploadRetryAttempt + 1).coerceAtLeast(1)
                val delayMillis = UploadRetryPolicy.delayMillis(attempt, outcome.retryAfterSeconds)
                health.uploadRetryPending(
                    attempt = attempt,
                    maxAttempts = UploadRetryPolicy.MAX_ATTEMPTS,
                    nextRetryAtMillis = clock() + delayMillis,
                    code = outcome.code,
                )
                UploadSyncResult.Retry(outcome.code, outcome.retryAfterSeconds)
            }
            is CaptureUploadResult.PairingRequired -> {
                health.uploadPausedForCredential()
                UploadSyncResult.PairingRequired(outcome.code)
            }
            is CaptureUploadResult.Permanent -> quarantine(outcome.eventIds.mapNotNull { id -> pending.firstOrNull { it.eventId == id } }, outcome.code)
        }
    }

    private suspend fun persistAcknowledgements(
        batch: List<QueuedAlert>,
        acknowledgements: List<CaptureEventAcknowledgement>,
    ): UploadSyncResult {
        val batchIds = batch.map(QueuedAlert::eventId).toSet()
        val unique = acknowledgements.distinctBy(CaptureEventAcknowledgement::eventId)
            .filter { it.eventId in batchIds }
        val localAcks = unique.map { acknowledgement ->
            AlertAcknowledgement(
                eventId = acknowledgement.eventId,
                code = acknowledgement.reasonCodes.firstOrNull()?.takeIf(String::isNotBlank)
                    ?: acknowledgement.errorCode
                    ?: acknowledgement.projectionState
                    ?: acknowledgement.status,
                disposition = if (acknowledgement.status == "rejected" ||
                    acknowledgement.status == "conflict" ||
                    acknowledgement.projectionState == "needs_review"
                ) CaptureAcknowledgementDisposition.REVIEW else CaptureAcknowledgementDisposition.ACKNOWLEDGED,
                receiptId = acknowledgement.receiptId,
                revision = acknowledgement.revision,
                errorCode = acknowledgement.errorCode,
            )
        }
        // The encrypted state write completes before this separate purge. A lost
        // response therefore leaves the exact batch replayable until the next run.
        if (localAcks.isNotEmpty()) {
            store.applyAcknowledgements(localAcks)
            store.purgeAcknowledged()
            health.uploadSucceeded(clock())
        }
        return if (unique.size == batch.size) {
            UploadSyncResult.Completed(unique.size)
        } else {
            val attempt = (health.state.value.uploadRetryAttempt + 1).coerceAtLeast(1)
            health.uploadRetryPending(
                attempt = attempt,
                maxAttempts = UploadRetryPolicy.MAX_ATTEMPTS,
                nextRetryAtMillis = clock() + UploadRetryPolicy.delayMillis(attempt, null),
                code = "partial_ack",
            )
            UploadSyncResult.Partial(unique.size)
        }
    }

    private suspend fun quarantine(items: List<QueuedAlert>, code: String): UploadSyncResult {
        if (items.isEmpty()) return UploadSyncResult.Quarantined(emptyList(), code)
        store.applyAcknowledgements(items.map {
            AlertAcknowledgement(it.eventId, code, CaptureAcknowledgementDisposition.REVIEW)
        })
        store.purgeAcknowledged()
        health.uploadSucceeded(clock())
        return UploadSyncResult.Quarantined(items.map(QueuedAlert::eventId), code)
    }

    private fun boundedBatch(pending: List<QueuedAlert>): List<QueuedAlert>? {
        var size = pending.size.coerceAtMost(CaptureIntakeLimits.MAX_BATCH_EVENTS)
        while (size > 0) {
            val candidate = pending.take(size)
            try {
                batchEncoder(candidate.map { CaptureUploadEvent(it.eventId, it.payload) })
                return candidate
            } catch (_: Exception) {
                size -= 1
            }
        }
        return null
    }
}

object UploadRetryPolicy {
    const val MAX_ATTEMPTS = 5
    const val MAX_RETRY_AFTER_SECONDS = 3_600L
    private const val INITIAL_BACKOFF_MILLIS = 5_000L

    fun delayMillis(attempt: Int, retryAfterSeconds: Long?): Long {
        retryAfterSeconds?.let { return it.coerceIn(1L, MAX_RETRY_AFTER_SECONDS) * 1_000L }
        val exponent = (attempt.coerceAtLeast(1) - 1).coerceAtMost(4)
        return (INITIAL_BACKOFF_MILLIS * (1L shl exponent)).coerceAtMost(60_000L)
    }
}

/** WorkManager is the only OS upload boundary; no listener callback reaches this class. */
class CaptureUploadWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val application = applicationContext as? BorderLedgerApplication ?: return Result.failure()
        return when (application.container.uploadCoordinator.sync()) {
            UploadSyncResult.NoPendingEvents,
            is UploadSyncResult.Completed,
            is UploadSyncResult.Quarantined -> Result.success()
            is UploadSyncResult.Partial -> Result.retry()
            is UploadSyncResult.Retry -> Result.retry()
            is UploadSyncResult.PairingRequired -> Result.failure()
        }
    }
}
