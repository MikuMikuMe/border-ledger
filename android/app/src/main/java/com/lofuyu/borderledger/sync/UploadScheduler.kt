package com.lofuyu.borderledger.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.lofuyu.borderledger.auth.CaptureCredentialProvider
import com.lofuyu.borderledger.auth.CaptureCredentialRecord
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.capture.CaptureItemStatus
import com.lofuyu.borderledger.capture.NotificationProcessResult
import com.lofuyu.borderledger.local.EncryptedCaptureIntakeStore
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay as coroutineDelay
import kotlinx.coroutines.launch

enum class UploadScheduleDecision { NO_PENDING_EVENTS, PAUSED_CAPTURE_CREDENTIAL, ELIGIBLE }

object UploadSchedulerPolicy {
    fun decide(pendingCount: Int, credentialExpiresAtMillis: Long?, nowMillis: Long): UploadScheduleDecision = when {
        pendingCount <= 0 -> UploadScheduleDecision.NO_PENDING_EVENTS
        credentialExpiresAtMillis == null || credentialExpiresAtMillis <= nowMillis -> UploadScheduleDecision.PAUSED_CAPTURE_CREDENTIAL
        else -> UploadScheduleDecision.ELIGIBLE
    }
}

enum class UploadScheduleResult {
    ENQUEUED,
    ALREADY_SCHEDULED,
    NO_PENDING_EVENTS,
    PAUSED_CAPTURE_CREDENTIAL,
    WORK_MANAGER_UNAVAILABLE,
}

interface CaptureUploadScheduler {
    suspend fun schedule(): UploadScheduleResult
}

object UploadReconciliationPolicy {
    /** Queued or replayed observations may point at an existing unsent outbox row. */
    fun requiresScheduling(result: NotificationProcessResult): Boolean = result.items.any {
        it.status == CaptureItemStatus.QUEUED || it.status == CaptureItemStatus.ALREADY_PROCESSED
    }
}

/** Re-runs the same unique-work attempt at durable lifecycle boundaries. */
class CaptureUploadReconciler(
    private val scheduler: CaptureUploadScheduler,
) {
    suspend fun onListenerConnected(): UploadScheduleResult = scheduler.schedule()

    suspend fun afterIntake(result: NotificationProcessResult): UploadScheduleResult? =
        if (UploadReconciliationPolicy.requiresScheduling(result)) scheduler.schedule() else null
}

/**
 * Wires credential activation to the existing scheduler without moving upload
 * or network behavior into the credential store. A scheduling failure never
 * makes a successfully persisted credential look like a failed grant.
 */
class SchedulingCaptureCredentialProvider(
    private val delegate: CaptureCredentialProvider,
    private val onCredentialUsable: suspend () -> UploadScheduleResult,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : CaptureCredentialProvider {
    override suspend fun current(): CaptureCredentialRecord? = delegate.current()

    override suspend fun save(value: CaptureCredentialRecord) {
        val wasUsable = runCatching { delegate.current()?.isUsable(clock()) == true }.getOrDefault(false)
        delegate.save(value)
        if (!wasUsable && value.isUsable(clock())) {
            runCatching { onCredentialUsable() }
        }
    }

    override suspend fun clear() = delegate.clear()

    private fun CaptureCredentialRecord.isUsable(nowMillis: Long): Boolean =
        runCatching { Instant.parse(expiresAt).toEpochMilli() > nowMillis }.getOrDefault(false)
}

/**
 * Re-attempts a failed scheduler boundary a bounded number of times. The
 * delayed coroutine is intentionally not a foreground service or an exact
 * alarm; WorkManager remains the durable upload boundary once it is usable.
 */
class RetryingCaptureUploadScheduler(
    private val delegate: CaptureUploadScheduler,
    private val health: CaptureHealthStore,
    retryScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val backoffMillis: (Int) -> Long = UploadScheduleRetryPolicy::backoffMillis,
    private val maxAutomaticRetries: Int = UploadScheduleRetryPolicy.MAX_AUTOMATIC_RETRIES,
    private val delay: suspend (Long) -> Unit = { coroutineDelay(it) },
) : CaptureUploadScheduler {
    private val retryCoordinator = UploadScheduleRetryCoordinator(
        scope = retryScope,
        health = health,
        attempt = ::scheduleDelegate,
        clock = clock,
        backoffMillis = backoffMillis,
        maxAttempts = maxAutomaticRetries,
        delay = delay,
    )

    override suspend fun schedule(): UploadScheduleResult {
        val result = scheduleDelegate()
        if (result == UploadScheduleResult.WORK_MANAGER_UNAVAILABLE) {
            retryCoordinator.request(code = "work_manager_unavailable")
        } else {
            retryCoordinator.cancel()
        }
        return result
    }

    private suspend fun scheduleDelegate(): UploadScheduleResult {
        val result = try {
            delegate.schedule()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (_: Exception) {
            health.uploadSchedulingFailed("work_manager_unavailable")
            UploadScheduleResult.WORK_MANAGER_UNAVAILABLE
        }
        when (result) {
            UploadScheduleResult.ENQUEUED,
            UploadScheduleResult.ALREADY_SCHEDULED -> health.uploadScheduled()
            UploadScheduleResult.NO_PENDING_EVENTS -> health.uploadReady()
            UploadScheduleResult.PAUSED_CAPTURE_CREDENTIAL -> health.uploadPausedForCredential()
            UploadScheduleResult.WORK_MANAGER_UNAVAILABLE -> Unit
        }
        return result
    }
}

object UploadScheduleRetryPolicy {
    const val MAX_AUTOMATIC_RETRIES = 3
    const val INITIAL_BACKOFF_MILLIS = 5_000L
    const val MAX_BACKOFF_MILLIS = 60_000L

    fun backoffMillis(attempt: Int): Long {
        val exponent = (attempt.coerceAtLeast(1) - 1).coerceAtMost(4)
        val multiplier = 1L shl exponent
        return (INITIAL_BACKOFF_MILLIS * multiplier).coerceAtMost(MAX_BACKOFF_MILLIS)
    }
}

private class UploadScheduleRetryCoordinator(
    private val scope: CoroutineScope,
    private val health: CaptureHealthStore,
    private val attempt: suspend () -> UploadScheduleResult,
    private val clock: () -> Long,
    private val backoffMillis: (Int) -> Long,
    private val maxAttempts: Int,
    private val delay: suspend (Long) -> Unit,
) {
    private var retryJob: Job? = null

    init {
        require(maxAttempts > 0) { "maxAttempts must be positive" }
    }

    @Synchronized
    fun request(code: String = "retryable_upload_failure") {
        if (retryJob?.isActive == true) return
        val firstDelay = backoffMillis(1).coerceAtLeast(0L)
        health.uploadRetryPending(
            attempt = 1,
            maxAttempts = maxAttempts,
            nextRetryAtMillis = clock() + firstDelay,
            code = code,
        )
        retryJob = scope.launch {
            var attemptNumber = 1
            var waitMillis = firstDelay
            while (true) {
                delay(waitMillis)
                val result = try {
                    attempt()
                } catch (cancellation: CancellationException) {
                    throw cancellation
                } catch (_: Exception) {
                    UploadScheduleResult.WORK_MANAGER_UNAVAILABLE
                }
                if (result != UploadScheduleResult.WORK_MANAGER_UNAVAILABLE) return@launch
                if (attemptNumber >= maxAttempts) {
                    health.uploadRetryExhausted(attemptNumber, maxAttempts)
                    return@launch
                }
                attemptNumber += 1
                waitMillis = backoffMillis(attemptNumber).coerceAtLeast(0L)
                health.uploadRetryPending(
                    attempt = attemptNumber,
                    maxAttempts = maxAttempts,
                    nextRetryAtMillis = clock() + waitMillis,
                )
            }
        }
    }

    @Synchronized
    fun cancel() {
        retryJob?.cancel()
        retryJob = null
    }

}

class WorkManagerCaptureUploadScheduler(
    context: Context,
    private val intake: EncryptedCaptureIntakeStore,
    private val credentials: CaptureCredentialProvider,
    private val health: CaptureHealthStore,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : CaptureUploadScheduler {
    private val retryingScheduler = RetryingCaptureUploadScheduler(
        delegate = WorkManagerEnqueueScheduler(
            context = context,
            intake = intake,
            credentials = credentials,
            health = health,
            clock = clock,
        ),
        health = health,
        clock = clock,
    )

    override suspend fun schedule(): UploadScheduleResult = retryingScheduler.schedule()

    companion object {
        const val UNIQUE_WORK_NAME = "border-ledger-capture-upload"
    }
}

private class WorkManagerEnqueueScheduler(
    context: Context,
    private val intake: EncryptedCaptureIntakeStore,
    private val credentials: CaptureCredentialProvider,
    private val health: CaptureHealthStore,
    private val clock: () -> Long,
) : CaptureUploadScheduler {
    private val appContext = context.applicationContext

    override suspend fun schedule(): UploadScheduleResult {
        val pending = intake.pendingCount()
        val credentialExpiry = credentials.current()?.let { value ->
            runCatching { Instant.parse(value.expiresAt).toEpochMilli() }.getOrNull()
        }
        return when (UploadSchedulerPolicy.decide(pending, credentialExpiry, clock())) {
            UploadScheduleDecision.NO_PENDING_EVENTS -> {
                health.uploadReady()
                UploadScheduleResult.NO_PENDING_EVENTS
            }
            UploadScheduleDecision.PAUSED_CAPTURE_CREDENTIAL -> {
                // Local intake stays active; only the upload boundary pauses.
                health.uploadPausedForCredential()
                UploadScheduleResult.PAUSED_CAPTURE_CREDENTIAL
            }
            UploadScheduleDecision.ELIGIBLE -> enqueueUniqueWork()
        }
    }

    private fun enqueueUniqueWork(): UploadScheduleResult = try {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val request = OneTimeWorkRequestBuilder<CaptureUploadWorker>()
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(appContext).enqueueUniqueWork(
            WorkManagerCaptureUploadScheduler.UNIQUE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
        health.uploadScheduled()
        UploadScheduleResult.ENQUEUED
    } catch (_: Exception) {
        health.uploadSchedulingFailed("work_manager_unavailable")
        UploadScheduleResult.WORK_MANAGER_UNAVAILABLE
    }
}

