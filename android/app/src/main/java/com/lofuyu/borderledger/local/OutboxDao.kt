package com.lofuyu.borderledger.local

import com.lofuyu.borderledger.capture.CaptureIntakeLimits
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import com.lofuyu.borderledger.auth.SessionBinding
import java.security.MessageDigest
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class QueuedAlert(
    val localId: String,
    val ownerLedgerId: String,
    val eventId: String,
    val payload: ByteArray,
    val createdAtMillis: Long,
    val acknowledged: Boolean = false,
    val acknowledgementCode: String? = null,
    val receiptId: String? = null,
    val acknowledgementRevision: Int? = null,
    val acknowledgementErrorCode: String? = null,
)

enum class EnqueueResult {
    Inserted,
    AlreadyQueued,
    Conflict,
}

data class AlertAcknowledgement(
    val eventId: String,
    val code: String,
    val disposition: CaptureAcknowledgementDisposition = CaptureAcknowledgementDisposition.ACKNOWLEDGED,
    val receiptId: String? = null,
    val revision: Int? = null,
    val errorCode: String? = null,
)

/** Room/SQLCipher-compatible DAO boundary for later parser/ingest work. */
interface OutboxDao {
    suspend fun enqueue(event: QueuedAlert): EnqueueResult
    suspend fun nextBatch(limit: Int): List<QueuedAlert>
    suspend fun applyAcknowledgements(acknowledgements: List<AlertAcknowledgement>)
    suspend fun purgeAcknowledged()
    suspend fun pendingCount(): Int
}

/** Encrypted collection implementation used until the production Room driver is pinned. */
class EncryptedOutboxDao(private val records: EncryptedRecordStore, private val binding: SessionBinding? = null) : OutboxDao {
    private val mutex = Mutex()

    override suspend fun enqueue(event: QueuedAlert): EnqueueResult = mutex.withLock {
        require(binding != null && event.ownerLedgerId == binding.identity.ledgerId) { "An authenticated ledger binding is required." }
        val current = readItems()
        val same = current.firstOrNull { it.ownerLedgerId == event.ownerLedgerId && it.eventId == event.eventId }
        if (same != null) {
            return@withLock if (same.payload.contentEquals(event.payload)) EnqueueResult.AlreadyQueued else EnqueueResult.Conflict
        }
        writeItems(current + event.copy(payload = event.payload.copyOf()))
        EnqueueResult.Inserted
    }

    override suspend fun nextBatch(limit: Int): List<QueuedAlert> = mutex.withLock {
        require(limit in 1..CaptureIntakeLimits.MAX_BATCH_EVENTS) {
            "Outbox batches must be between 1 and ${CaptureIntakeLimits.MAX_BATCH_EVENTS} events."
        }
        readItems().asSequence().filterNot { it.acknowledged }.sortedBy { it.createdAtMillis }.take(limit).toList()
    }

    override suspend fun applyAcknowledgements(acknowledgements: List<AlertAcknowledgement>) = mutex.withLock {
        if (acknowledgements.isEmpty()) return@withLock
        val byEvent = acknowledgements.associateBy { it.eventId }
        val updated = readItems().map { item ->
            val ack = byEvent[item.eventId] ?: return@map item
            item.copy(acknowledged = true, acknowledgementCode = ack.code)
        }
        // Acknowledgements are durable before the separate purge operation may remove rows.
        writeItems(updated)
    }

    override suspend fun purgeAcknowledged() = mutex.withLock {
        writeItems(readItems().filterNot { it.acknowledged })
    }

    override suspend fun pendingCount(): Int = mutex.withLock { readItems().count { !it.acknowledged } }

    private fun recordName(): String? {
        val bound = binding ?: return null
        val identity = listOf(bound.identity.userId, bound.identity.ledgerId, bound.epoch).joinToString("") { "${it.length}:$it" }
        val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString("") { "%02x".format(it) }
        return "${LedgerRecord.OUTBOX_QUEUE}_$digest"
    }

    private suspend fun readItems(): List<QueuedAlert> {
        val bytes = records.read(recordName() ?: return emptyList()) ?: return emptyList()
        return decode(bytes)
    }

    private suspend fun writeItems(items: List<QueuedAlert>) {
        if (binding == null) return
        if (items.isEmpty()) {
            records.delete(requireNotNull(recordName()))
        } else {
            records.write(requireNotNull(recordName()), encode(items))
        }
    }

    private fun encode(items: List<QueuedAlert>): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeInt(items.size)
            items.forEach { item ->
                output.writeUTF(item.localId)
                output.writeUTF(item.ownerLedgerId)
                output.writeUTF(item.eventId)
                output.writeLong(item.createdAtMillis)
                output.writeBoolean(item.acknowledged)
                writeNullable(output, item.acknowledgementCode)
                output.writeInt(item.payload.size)
                output.write(item.payload)
            }
        }
        bytes.toByteArray()
    }

    private fun decode(bytes: ByteArray): List<QueuedAlert> = try {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            if (input.readInt() != FORMAT_VERSION) throw SecureStorageException("Encrypted outbox format is not supported.")
            val count = input.readInt()
            if (count !in 0..MAX_ITEMS) throw SecureStorageException("Encrypted outbox item count is not valid.")
            List(count) {
                val localId = input.readUTF()
                val ownerLedgerId = input.readUTF()
                val eventId = input.readUTF()
                val createdAt = input.readLong()
                val acknowledged = input.readBoolean()
                val ackCode = readNullable(input)
                val size = input.readInt()
                if (size < 0 || size > MAX_PAYLOAD_BYTES) throw SecureStorageException("Encrypted outbox payload is not valid.")
                val payload = ByteArray(size).also(input::readFully)
                QueuedAlert(localId, ownerLedgerId, eventId, payload, createdAt, acknowledged, ackCode)
            }
        }
    } catch (error: SecureStorageException) {
        throw error
    } catch (error: Exception) {
        throw SecureStorageException("Encrypted outbox could not be opened.", error)
    }

    private companion object {
        const val FORMAT_VERSION = 1
        const val MAX_ITEMS = 5_000
        const val MAX_PAYLOAD_BYTES = 128 * 1024

        fun writeNullable(output: DataOutputStream, value: String?) {
            output.writeBoolean(value != null)
            if (value != null) output.writeUTF(value)
        }

        fun readNullable(input: DataInputStream): String? = if (input.readBoolean()) input.readUTF() else null
    }
}
