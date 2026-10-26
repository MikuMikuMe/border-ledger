package com.lofuyu.borderledger.sync

import com.lofuyu.borderledger.auth.CaptureCredentialProvider
import com.lofuyu.borderledger.auth.CaptureCredentialRecord
import com.lofuyu.borderledger.capture.CaptureItemResult
import com.lofuyu.borderledger.capture.CaptureItemStatus
import com.lofuyu.borderledger.capture.CaptureHealthState
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.capture.NotificationProcessResult
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class UploadSchedulerPolicyTest {
    @Test
    fun detachedSchedulingAttemptGetsCurrentIdentityAndStopsAfterLogout() = runTest {
        val identity = com.lofuyu.borderledger.IdentityFixture()
        var calls = 0
        val scheduler = IdentityCaptureUploadScheduler(object : CaptureUploadScheduler {
            override suspend fun schedule(): UploadScheduleResult {
                org.junit.Assert.assertEquals(identity.credential, kotlin.coroutines.coroutineContext[com.lofuyu.borderledger.auth.CaptureWork]?.credential)
                calls++
                return UploadScheduleResult.ENQUEUED
            }
        }, identity.boundary)
        assertEquals(UploadScheduleResult.ENQUEUED, scheduler.schedule())
        identity.binding = null
        assertEquals(UploadScheduleResult.PAUSED_CAPTURE_CREDENTIAL, scheduler.schedule())
        assertEquals(1, calls)
    }

    @Test
    fun expiredCaptureCredentialPausesUploadWithoutPausingLocalIntake() {
        assertEquals(
            UploadScheduleDecision.PAUSED_CAPTURE_CREDENTIAL,
            UploadSchedulerPolicy.decide(
                pendingCount = 3,
                credentialExpiresAtMillis = 1_000L,
                nowMillis = 1_001L,
            ),
        )
    }

    @Test
    fun pendingEligibleCaptureSchedulesOnlyWhenThereIsWork() {
        assertEquals(
            UploadScheduleDecision.NO_PENDING_EVENTS,
            UploadSchedulerPolicy.decide(0, credentialExpiresAtMillis = 2_000L, nowMillis = 1_000L),
        )
        assertEquals(
            UploadScheduleDecision.ELIGIBLE,
            UploadSchedulerPolicy.decide(3, credentialExpiresAtMillis = 2_000L, nowMillis = 1_000L),
        )
    }

    @Test
    fun recoveryAndAlreadyProcessedObservationRetryAfterTransientSchedulingFailure() = runTest {
        val scheduler = RecordingScheduler(
            mutableListOf(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, UploadScheduleResult.ENQUEUED),
        )
        val reconciler = CaptureUploadReconciler(scheduler)

        assertEquals(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, reconciler.onListenerConnected())
        val replay = NotificationProcessResult(
            listOf(CaptureItemResult(CaptureItemStatus.ALREADY_PROCESSED, observationId = "obs-1", eventId = "event-1")),
        )
        assertTrue(UploadReconciliationPolicy.requiresScheduling(replay))
        assertEquals(UploadScheduleResult.ENQUEUED, reconciler.afterIntake(replay))
        assertEquals(2, scheduler.calls)
    }

    @Test
    fun usableCredentialTransitionTriggersReconciliationEvenWhenFirstAttemptFails() = runTest {
        val scheduler = RecordingScheduler(
            mutableListOf(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE),
        )
        val credentials = SchedulingCaptureCredentialProvider(
            delegate = MemoryCaptureCredentialProvider(),
            onCredentialUsable = scheduler::schedule,
            clock = { 1_000L },
        )

        credentials.save(
            CaptureCredentialRecord(
                credential = "synthetic",
                deviceId = "device",
                generation = 1,
                expiresAt = "1970-01-01T00:16:40Z",
                revocationCapability = "revoke",
            identity = com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), sessionEpoch = "test-session"),
        )

        assertEquals(1, scheduler.calls)
        assertEquals(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, scheduler.resultsSeen.single())
    }

    @Test
    fun listenerReconciliationFailureIsRetriedWithVisibleHealthState() = runTest {
        val health = CaptureHealthStore()
        val delegate = RecordingScheduler(
            mutableListOf(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, UploadScheduleResult.ENQUEUED),
        )
        val scheduler = RetryingCaptureUploadScheduler(
            delegate = delegate,
            health = health,
            retryScope = this,
            clock = { testScheduler.currentTime },
            backoffMillis = { 1L },
        )
        val reconciler = CaptureUploadReconciler(scheduler)
        val queued = NotificationProcessResult(
            listOf(CaptureItemResult(CaptureItemStatus.QUEUED, eventId = "event-1")),
        )

        assertEquals(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, reconciler.afterIntake(queued))
        assertEquals(CaptureHealthState.Upload.RETRY_PENDING, health.state.value.upload)
        assertEquals(1, health.state.value.uploadRetryAttempt)
        assertEquals("work_manager_unavailable", health.state.value.uploadFailureCode)
        assertEquals(1, delegate.calls)

        advanceTimeBy(1L)
        runCurrent()

        assertEquals(2, delegate.calls)
        assertEquals(CaptureHealthState.Upload.SCHEDULED, health.state.value.upload)
        assertEquals(null, health.state.value.uploadRetryAtMillis)
    }

    @Test
    fun thrownSchedulerFailureIsRetriedAutomatically() = runTest {
        val health = CaptureHealthStore()
        val delegate = ThrowingThenRecordingScheduler()
        val scheduler = RetryingCaptureUploadScheduler(
            delegate = delegate,
            health = health,
            retryScope = this,
            clock = { testScheduler.currentTime },
            backoffMillis = { 1L },
            maxAutomaticRetries = 2,
        )

        assertEquals(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, scheduler.schedule())
        assertEquals(CaptureHealthState.Upload.RETRY_PENDING, health.state.value.upload)

        advanceTimeBy(1L)
        runCurrent()

        assertEquals(2, delegate.calls)
        assertEquals(CaptureHealthState.Upload.SCHEDULED, health.state.value.upload)
    }

    @Test
    fun automaticRetryStopsAtTheConfiguredBoundAndLeavesExplicitHealthState() = runTest {
        val health = CaptureHealthStore()
        val delegate = AlwaysFailingScheduler()
        val scheduler = RetryingCaptureUploadScheduler(
            delegate = delegate,
            health = health,
            retryScope = this,
            clock = { testScheduler.currentTime },
            backoffMillis = { 1L },
            maxAutomaticRetries = 2,
        )

        assertEquals(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, scheduler.schedule())
        advanceTimeBy(1L)
        runCurrent()
        advanceTimeBy(1L)
        runCurrent()

        assertEquals(3, delegate.calls)
        assertEquals(CaptureHealthState.Upload.RETRY_EXHAUSTED, health.state.value.upload)
        assertEquals(null, health.state.value.uploadRetryAtMillis)
        assertEquals("work_manager_unavailable", health.state.value.uploadFailureCode)

        advanceTimeBy(100L)
        runCurrent()
        assertEquals(3, delegate.calls)
    }
}

private class RecordingScheduler(
    private val outcomes: MutableList<UploadScheduleResult>,
) : CaptureUploadScheduler {
    var calls: Int = 0
        private set
    val resultsSeen = mutableListOf<UploadScheduleResult>()

    override suspend fun schedule(): UploadScheduleResult {
        calls += 1
        return outcomes.removeAt(0).also(resultsSeen::add)
    }
}

private class ThrowingThenRecordingScheduler : CaptureUploadScheduler {
    var calls: Int = 0
        private set

    override suspend fun schedule(): UploadScheduleResult {
        calls += 1
        if (calls == 1) throw IllegalStateException("synthetic WorkManager failure")
        return UploadScheduleResult.ENQUEUED
    }
}

private class AlwaysFailingScheduler : CaptureUploadScheduler {
    var calls: Int = 0
        private set

    override suspend fun schedule(): UploadScheduleResult {
        calls += 1
        return UploadScheduleResult.WORK_MANAGER_UNAVAILABLE
    }
}

private class MemoryCaptureCredentialProvider : CaptureCredentialProvider {
    private var value: CaptureCredentialRecord? = null

    override suspend fun current(): CaptureCredentialRecord? = value
    override suspend fun save(value: CaptureCredentialRecord) { this.value = value }
    override suspend fun clear() { value = null }
}
