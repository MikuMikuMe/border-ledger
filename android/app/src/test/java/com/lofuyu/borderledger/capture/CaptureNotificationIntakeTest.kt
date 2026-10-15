package com.lofuyu.borderledger.capture

import com.lofuyu.borderledger.local.CaptureCandidateStatus
import com.lofuyu.borderledger.local.CaptureCommitResult
import com.lofuyu.borderledger.local.CaptureCandidateDisposition
import com.lofuyu.borderledger.local.EncryptedCaptureIntakeStore
import com.lofuyu.borderledger.local.EncryptedRecordStore
import com.lofuyu.borderledger.local.BankAlertEventCodec
import com.lofuyu.borderledger.parser.BocCreditCardParser
import com.lofuyu.borderledger.parser.EventIdProvider
import com.lofuyu.borderledger.sync.CaptureUploadReconciler
import com.lofuyu.borderledger.sync.CaptureUploadScheduler
import com.lofuyu.borderledger.sync.RetryingCaptureUploadScheduler
import com.lofuyu.borderledger.sync.UploadScheduleResult
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.util.UUID

class CaptureNotificationIntakeTest {
    @Test
    fun approvedNotificationIsParsedAndQueuedBeforeHealthReportsQueued() = runTest {
        val health = CaptureHealthStore()
        val store = EncryptedCaptureIntakeStore(CaptureMemoryStore())
        val profiles = MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }
        val intake = syntheticIntake(profiles, store, health)

        intake.onListenerConnected()
        val result = intake.process(SyntheticNotificationFixtures.snapshot())

        assertEquals(listOf(CaptureItemStatus.QUEUED), result.items.map { it.status })
        assertEquals(1, store.pendingCount())
        assertEquals(1, store.storedIntakeCount())
        assertEquals(1, health.state.value.pendingCount)
        assertEquals(1, health.state.value.storedIntakeCount)
        assertEquals(CaptureHealthState.Intake.ACTIVE, health.state.value.intake)
        assertEquals(
            SyntheticNotificationFixtures.snapshot().notificationPostedAtMillis,
            BankAlertEventCodec.decode(store.nextBatch(1).single().payload).notificationPostedAt?.let { java.time.Instant.parse(it).toEpochMilli() },
        )
    }

    @Test
    fun unrelatedPackageAndGenericContentNeverEnterFinancialStorage() = runTest {
        val health = CaptureHealthStore()
        val store = EncryptedCaptureIntakeStore(CaptureMemoryStore())
        val profiles = MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }
        val intake = syntheticIntake(profiles, store, health)
        intake.onListenerConnected()

        val unrelated = intake.process(SyntheticNotificationFixtures.snapshot(packageName = "com.example.unrelated"))
        val generic = intake.process(
            SyntheticNotificationFixtures.snapshot(contentCapability = NotificationContentCapability.GENERIC_OS_NOTIFICATION, body = null),
        )

        assertTrue(unrelated.items.single().status == CaptureItemStatus.IGNORED)
        assertTrue(generic.items.single().status == CaptureItemStatus.IGNORED)
        assertEquals(0, store.pendingCount())
        assertTrue(store.snapshot().candidates.isEmpty())
        assertEquals(CaptureHealthState.Source.GENERIC_OR_MUTED, health.state.value.source)
    }

    @Test
    fun unknownConversationContextNeverReachesFinancialParser() = runTest {
        val health = CaptureHealthStore()
        val store = EncryptedCaptureIntakeStore(CaptureMemoryStore())
        val profiles = MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }
        var parserCalls = 0
        val intake = BankNotificationIntake(
            profiles = profiles,
            store = store,
            health = health,
            parserFor = {
                parserCalls += 1
                BocCreditCardParser(eventIdProvider = EventIdProvider { message ->
                    UUID.nameUUIDFromBytes(message.observationId.toByteArray(StandardCharsets.UTF_8)).toString()
                })
            },
            clock = { 1_791_800_000_000L },
        )
        intake.onListenerConnected()

        val result = intake.process(SyntheticNotificationFixtures.snapshot(isPrivate = null))

        assertEquals(CaptureItemStatus.REVIEW, result.items.single().status)
        assertEquals(0, parserCalls)
        assertEquals(0, store.storedIntakeCount())
    }

    @Test
    fun pausedCommitCanBeRetriedAfterCapacityIsReached() = runTest {
        val health = CaptureHealthStore()
        val store = EncryptedCaptureIntakeStore(CaptureMemoryStore(), pendingLimit = 1)
        val profiles = MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }
        val intake = syntheticIntake(profiles, store, health)
        intake.onListenerConnected()

        assertEquals(CaptureItemStatus.QUEUED, intake.process(SyntheticNotificationFixtures.snapshot(key = "first-key")).items.single().status)
        val pausedSnapshot = SyntheticNotificationFixtures.snapshot(key = "paused-key")
        assertEquals(CaptureItemStatus.INTAKE_PAUSED, intake.process(pausedSnapshot).items.single().status)
        assertEquals(CaptureItemStatus.INTAKE_PAUSED, intake.process(pausedSnapshot).items.single().status)
    }

    @Test
    fun listenerCallbacksAreDispatchedThroughBackgroundBoundary() = runTest {
        val calls = mutableListOf<String>()
        val dispatcher = NotificationWorkDispatcher(this) {
            calls += Thread.currentThread().name
        }

        dispatcher.dispatch()
        assertTrue(calls.isEmpty())
        testScheduler.runCurrent()
        assertEquals(1, calls.size)
    }

    @Test
    fun queuedIntakeReconciliationRetriesAfterTransientSchedulerFailure() = runTest {
        val health = CaptureHealthStore()
        val store = EncryptedCaptureIntakeStore(CaptureMemoryStore())
        val profiles = MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }
        val intake = syntheticIntake(profiles, store, health)
        val delegate = IntakeScheduler(
            mutableListOf(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, UploadScheduleResult.ENQUEUED),
        )
        val scheduler = RetryingCaptureUploadScheduler(
            delegate = delegate,
            health = health,
            retryScope = this,
            clock = { testScheduler.currentTime },
            backoffMillis = { 1L },
        )

        intake.onListenerConnected()
        val result = intake.process(SyntheticNotificationFixtures.snapshot())

        assertTrue(result.requiresUploadScheduling)
        assertEquals(UploadScheduleResult.WORK_MANAGER_UNAVAILABLE, CaptureUploadReconciler(scheduler).afterIntake(result))
        assertEquals(CaptureHealthState.Upload.RETRY_PENDING, health.state.value.upload)

        advanceTimeBy(1L)
        runCurrent()

        assertEquals(2, delegate.calls)
        assertEquals(CaptureHealthState.Upload.SCHEDULED, health.state.value.upload)
    }

    private fun syntheticIntake(
        profiles: MutableSourceProfileRegistry,
        store: EncryptedCaptureIntakeStore,
        health: CaptureHealthStore,
    ) = BankNotificationIntake(
        profiles = profiles,
        store = store,
        health = health,
        parserFor = { BocCreditCardParser(eventIdProvider = EventIdProvider { message -> UUID.nameUUIDFromBytes(message.observationId.toByteArray(StandardCharsets.UTF_8)).toString() }) },
        clock = { 1_791_800_000_000L },
    )
}

private class CaptureMemoryStore : EncryptedRecordStore {
    private val values = mutableMapOf<String, ByteArray>()
    override suspend fun read(record: String): ByteArray? = values[record]?.copyOf()
    override suspend fun write(record: String, value: ByteArray) { values[record] = value.copyOf() }
    override suspend fun delete(record: String) { values.remove(record) }
}

private class IntakeScheduler(
    private val outcomes: MutableList<UploadScheduleResult>,
) : CaptureUploadScheduler {
    var calls: Int = 0
        private set

    override suspend fun schedule(): UploadScheduleResult {
        calls += 1
        return outcomes.removeAt(0)
    }
}
