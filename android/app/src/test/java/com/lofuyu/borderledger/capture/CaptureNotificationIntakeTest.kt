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

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class CaptureNotificationIntakeTest {
    @Test
    fun listenerBeforeConsentQueuesFirstPostConsentNotification() = runTest {
        val identity = com.lofuyu.borderledger.IdentityFixture()
        val consent = identity.credential
        identity.credential = null
        val health = CaptureHealthStore()
        val records = CaptureMemoryStore()
        val store = EncryptedCaptureIntakeStore(com.lofuyu.borderledger.auth.CaptureIdentityRecords(records, identity.boundary))
        var now = 1_791_800_000_000L
        fun newIntake() = BankNotificationIntake(MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }, store, health,
            parserFor = { BocCreditCardParser(eventIdProvider = EventIdProvider { UUID.nameUUIDFromBytes(it.observationId.toByteArray()).toString() }) }, clock = { now }, boundary = identity.boundary)
        val intake = newIntake()
        intake.onListenerConnected()
        identity.credential = consent
        intake.activateCurrentConsent()
        health.resumeAfterConsent()
        now += 2_000
        val result = intake.process(SyntheticNotificationFixtures.snapshot(postTime = now - 1_000, capturedAt = now))
        assertEquals(CaptureItemStatus.QUEUED, result.items.single().status)
        val historical = intake.process(SyntheticNotificationFixtures.snapshot(key = "old", postTime = now - 5_000, capturedAt = now))
        assertEquals(CaptureItemStatus.REVIEW, historical.items.single().status)
        val activation = identity.boundary.run<Long?>(null) { store.snapshot().activatedAtMillis }
        now += 3_000
        val restarted = newIntake()
        restarted.onListenerConnected()
        assertEquals(CaptureItemStatus.QUEUED, restarted.process(SyntheticNotificationFixtures.snapshot(key = "restart", body = "交易提醒\n消费\n交易金额: CAD 23.45\n商户名称: Restart Market", postTime = now - 1_000, capturedAt = now)).items.single().status)
        assertEquals(activation, identity.boundary.run<Long?>(null) { store.snapshot().activatedAtMillis })
        identity.credential = consent!!.copy(generation = 2)
        intake.activateCurrentConsent()
        now += 2_000
        val freshPartition = intake.process(SyntheticNotificationFixtures.snapshot(postTime = now - 1_000, capturedAt = now))
        assertEquals(CaptureItemStatus.QUEUED, freshPartition.items.single().status)
    }

    @Test
    fun logoutClearsOwnerCountsAndActivityBeforeAnotherConsent() {
        val health = CaptureHealthStore()
        health.listenerConnected()
        health.pendingCount(7)
        health.storedIntakeCount(9)
        health.uploadSucceeded(1000)
        health.cacheSnapshotRecorded(2000)
        health.pauseMonitoring()
        assertEquals(0, health.state.value.pendingCount)
        assertEquals(0, health.state.value.storedIntakeCount)
        assertEquals(null, health.state.value.lastSuccessfulUploadAtMillis)
        assertEquals(null, health.state.value.lastCacheSnapshotAtMillis)
        assertTrue(health.state.value.listenerConnected)
    }

    @Test
    fun replacementOwnerCannotSeeOrReceiveLatePreviousOwnerHealth() = runTest {
        val first = com.lofuyu.borderledger.IdentityFixture().binding!!
        val second = com.lofuyu.borderledger.IdentityFixture("b", "b-ledger", "b-session").binding!!
        var current: com.lofuyu.borderledger.auth.SessionBinding? = first
        val health = CaptureHealthStore(owner = { current })
        health.listenerConnected()
        kotlinx.coroutines.withContext(health.context(first)) {
            health.pendingCount(7); health.storedIntakeCount(9)
            health.uploadSucceeded(1000); health.cacheSnapshotRecorded(2000)
            health.uploadRetryPending(2, 3, 3000)
        }
        current = null; health.pauseMonitoring(); current = second
        val beforeConsent = health.snapshot(second)
        assertEquals(0, beforeConsent.pendingCount)
        assertEquals(0, beforeConsent.storedIntakeCount)
        assertEquals(null, beforeConsent.lastSuccessfulUploadAtMillis)
        assertEquals(null, beforeConsent.lastCacheSnapshotAtMillis)
        assertEquals(null, beforeConsent.uploadRetryAtMillis)
        kotlinx.coroutines.withContext(health.context(second)) { health.pendingCount(2) }
        kotlinx.coroutines.withContext(health.context(first)) {
            health.pendingCount(99); health.uploadSucceeded(9000); health.cacheSnapshotRecorded(9000)
            health.storageFailed("late-a-failure")
        }
        val afterLateA = health.snapshot(second)
        assertEquals(2, afterLateA.pendingCount)
        assertEquals(null, afterLateA.lastSuccessfulUploadAtMillis)
        assertEquals(null, afterLateA.lastFailureCode)
        assertTrue(afterLateA.listenerConnected)
    }

    @Test
    fun notificationAndUploadCompleteFromNativeStoresWithoutReactRuntimeOrActivity() = runTest {
        val records=CaptureMemoryStore()
        val health=CaptureHealthStore()
        val store=EncryptedCaptureIntakeStore(records)
        val profiles=MutableSourceProfileRegistry().apply { register(SyntheticNotificationFixtures.bocProfile()) }
        val intake=syntheticIntake(profiles,store,health)
        intake.onListenerConnected()
        val queued=intake.process(SyntheticNotificationFixtures.snapshot())
        assertEquals(1,queued.queuedEventIds.size)
        // Reopen the durable store as a background worker would. No AppContainer,
        // Activity, bridge module, JS host or React runtime is constructed.
        val reopened=EncryptedCaptureIntakeStore(records)
        var uploaded=emptyList<String>()
        val client=object: com.lofuyu.borderledger.api.CaptureUploadClient {
            override suspend fun upload(batch: List<com.lofuyu.borderledger.api.CaptureUploadEvent>): com.lofuyu.borderledger.api.CaptureUploadResult {
                uploaded=batch.map { it.eventId }
                return com.lofuyu.borderledger.api.CaptureUploadResult.Success(batch.map { com.lofuyu.borderledger.api.CaptureEventAcknowledgement(it.eventId,"accepted","provisional",listOf("accepted")) })
            }
        }
        val coordinator=com.lofuyu.borderledger.sync.CaptureUploadCoordinator(reopened,client,health,batchEncoder={byteArrayOf(1)}, boundary = com.lofuyu.borderledger.IdentityFixture().boundary)
        assertTrue(coordinator.sync() is com.lofuyu.borderledger.sync.UploadSyncResult.Completed)
        assertEquals(queued.queuedEventIds,uploaded)
        assertEquals(0,reopened.pendingCount())
    }
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
         boundary = com.lofuyu.borderledger.IdentityFixture().boundary)
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
     boundary = com.lofuyu.borderledger.IdentityFixture().boundary)
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
