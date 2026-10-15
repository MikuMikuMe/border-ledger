package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.capture.CaptureIntakeLimits
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OutboxConcurrencyTest {
    @Test
    fun concurrentEnqueuesPreserveEveryEvent() = runTest {
        val records = YieldingRecordStore()
        val outbox = EncryptedOutboxDao(records)
        val events = (0 until 101).map { index ->
            QueuedAlert(
                localId = "local-$index",
                ownerLedgerId = "personal",
                eventId = "event-$index",
                payload = "payload-$index".encodeToByteArray(),
                createdAtMillis = index.toLong(),
            )
        }

        events.map { event ->
            async(Dispatchers.Default) { outbox.enqueue(event) }
        }.awaitAll()

        assertEquals(events.size, outbox.pendingCount())
        val observed = mutableListOf<String>()
        while (observed.size < events.size) {
            val batch = outbox.nextBatch(CaptureIntakeLimits.MAX_BATCH_EVENTS)
            assertTrue(batch.size <= CaptureIntakeLimits.MAX_BATCH_EVENTS)
            observed += batch.map(QueuedAlert::eventId)
            outbox.applyAcknowledgements(batch.map { AlertAcknowledgement(it.eventId, "test") })
        }
        assertEquals(events.map { it.eventId }.toSet(), observed.toSet())
        assertEquals(0, outbox.pendingCount())
    }

    @Test
    fun nextBatchRejectsMoreThanApiBatchCeiling() = runTest {
        val outbox = EncryptedOutboxDao(YieldingRecordStore())

        val error = runCatching {
            outbox.nextBatch(CaptureIntakeLimits.MAX_BATCH_EVENTS + 1)
        }.exceptionOrNull()

        assertTrue(error is IllegalArgumentException)
    }
}

private class YieldingRecordStore : EncryptedRecordStore {
    @Volatile
    private var value: ByteArray? = null

    override suspend fun read(record: String): ByteArray? {
        delay(1)
        return value?.copyOf()
    }

    override suspend fun write(record: String, value: ByteArray) {
        delay(1)
        this.value = value.copyOf()
    }

    override suspend fun delete(record: String) {
        delay(1)
        value = null
    }
}
