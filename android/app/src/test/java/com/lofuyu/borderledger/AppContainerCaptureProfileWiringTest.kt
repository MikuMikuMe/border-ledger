package com.lofuyu.borderledger

import com.lofuyu.borderledger.capture.BankNotificationIntake
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.capture.CaptureItemStatus
import com.lofuyu.borderledger.capture.MutableSourceProfileRegistry
import com.lofuyu.borderledger.capture.SyntheticNotificationFixtures
import com.lofuyu.borderledger.local.EncryptedCaptureIntakeStore
import com.lofuyu.borderledger.local.EncryptedRecordStore
import com.lofuyu.borderledger.parser.BocCreditCardParser
import com.lofuyu.borderledger.parser.EventIdProvider
import com.lofuyu.borderledger.sync.CaptureUploadScheduler
import com.lofuyu.borderledger.sync.UploadScheduleResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import java.nio.charset.StandardCharsets
import java.util.UUID

class AppContainerCaptureProfileWiringTest {
    @Test
    fun configuredApprovedProfileIsSharedWithTheListenerRuntime() = runTest {
        val profile = SyntheticNotificationFixtures.bocProfile()
        val profiles = MutableSourceProfileRegistry().apply { register(profile) }
        val health = CaptureHealthStore()
        val intake = testIntake(profiles, health)
        val runtime = createCaptureNotificationListenerRuntime(
            profiles = profiles,
            health = health,
            intake = intake,
            uploadScheduler = NoOpUploadScheduler,
        )

        val result = runtime.intake.process(SyntheticNotificationFixtures.snapshot())

        assertSame(profiles, runtime.profiles)
        assertEquals(listOf(CaptureItemStatus.QUEUED), result.items.map { it.status })
    }

    @Test
    fun listenerRuntimeRemainsDisabledWhenNoProfileIsApproved() = runTest {
        val profiles = MutableSourceProfileRegistry().apply {
            register(SyntheticNotificationFixtures.bocProfile().copy(approved = false))
        }
        val health = CaptureHealthStore()
        val intake = testIntake(profiles, health)
        val runtime = createCaptureNotificationListenerRuntime(
            profiles = profiles,
            health = health,
            intake = intake,
            uploadScheduler = NoOpUploadScheduler,
        )

        val result = runtime.intake.process(SyntheticNotificationFixtures.snapshot())

        assertEquals(listOf(CaptureItemStatus.IGNORED), result.items.map { it.status })
    }

    private fun testIntake(
        profiles: MutableSourceProfileRegistry,
        health: CaptureHealthStore,
    ) = BankNotificationIntake(
        profiles = profiles,
        store = EncryptedCaptureIntakeStore(InMemoryRecordStore()),
        health = health,
        parserFor = { BocCreditCardParser(eventIdProvider = EventIdProvider { message -> UUID.nameUUIDFromBytes(message.observationId.toByteArray(StandardCharsets.UTF_8)).toString() }) },
        clock = { 1_791_800_000_000L },
    )
}

private object NoOpUploadScheduler : CaptureUploadScheduler {
    override suspend fun schedule(): UploadScheduleResult = UploadScheduleResult.ENQUEUED
}

private class InMemoryRecordStore : EncryptedRecordStore {
    private val values = mutableMapOf<String, ByteArray>()

    override suspend fun read(record: String): ByteArray? = values[record]?.copyOf()
    override suspend fun write(record: String, value: ByteArray) { values[record] = value.copyOf() }
    override suspend fun delete(record: String) { values.remove(record) }
}
