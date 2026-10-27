package com.lofuyu.borderledger.local

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.time.Duration
import java.time.Instant
import com.lofuyu.borderledger.auth.SessionBinding

data class OwnerReadCacheEntry(
    val ownerLedgerId: String,
    val snapshotAt: String,
    val lastAuthenticatedAt: String,
    val refreshExpiresAt: String,
    val payload: ByteArray,
    val ownerUserId: String? = null,
    val sessionEpoch: String? = null,
)

interface OwnerReadCache {
    suspend fun write(entry: OwnerReadCacheEntry)
    suspend fun readIfUsable(now: Instant, expected: SessionBinding? = null): OwnerReadCacheEntry?
    suspend fun clear()
}

/** Encrypted offline snapshot with the spec's same-ledger/24-hour/refresh lease. */
class EncryptedOwnerReadCache(private val records: EncryptedRecordStore) : OwnerReadCache {
    override suspend fun write(entry: OwnerReadCacheEntry) {
        require(entry.ownerLedgerId.isNotBlank() && !entry.ownerUserId.isNullOrBlank() && !entry.sessionEpoch.isNullOrBlank())
        records.write(LedgerRecord.FINANCIAL_READ_CACHE, encode(entry))
    }

    override suspend fun readIfUsable(now: Instant, expected: SessionBinding?): OwnerReadCacheEntry? {
        if (expected == null) return null
        val bytes = records.read(LedgerRecord.FINANCIAL_READ_CACHE) ?: return null
        val entry = decode(bytes) ?: return null
        val authenticated = runCatching { Instant.parse(entry.lastAuthenticatedAt) }.getOrNull()
        val refreshExpiry = runCatching { Instant.parse(entry.refreshExpiresAt) }.getOrNull()
        if (!entry.belongsTo(expected) || authenticated == null || refreshExpiry == null) return null
        val leaseExpiry = minOf(refreshExpiry, authenticated.plus(Duration.ofHours(24)))
        if (!now.isBefore(leaseExpiry)) {
            records.delete(LedgerRecord.FINANCIAL_READ_CACHE)
            return null
        }
        return entry
    }

    private fun OwnerReadCacheEntry.belongsTo(expected: SessionBinding): Boolean =
        ownerLedgerId == expected.identity.ledgerId && ownerUserId == expected.identity.userId && sessionEpoch == expected.epoch

    override suspend fun clear() = records.delete(LedgerRecord.FINANCIAL_READ_CACHE)

    private fun encode(entry: OwnerReadCacheEntry): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(entry.ownerLedgerId)
            output.writeUTF(requireNotNull(entry.ownerUserId))
            output.writeUTF(requireNotNull(entry.sessionEpoch))
            output.writeUTF(entry.snapshotAt)
            output.writeUTF(entry.lastAuthenticatedAt)
            output.writeUTF(entry.refreshExpiresAt)
            output.writeInt(entry.payload.size)
            output.write(entry.payload)
        }
        bytes.toByteArray()
    }

    private fun decode(bytes: ByteArray): OwnerReadCacheEntry? = try {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            val version = input.readInt()
            if (version == 1) return null
            if (version != FORMAT_VERSION) throw SecureStorageException("Encrypted cache format is not supported.")
            val ledgerId = input.readUTF()
            val userId = input.readUTF()
            val epoch = input.readUTF()
            val snapshotAt = input.readUTF()
            val authenticatedAt = input.readUTF()
            val refreshExpiry = input.readUTF()
            val size = input.readInt()
            if (size < 0 || size > MAX_CACHE_BYTES) throw SecureStorageException("Encrypted cache payload is not valid.")
            val payload = ByteArray(size).also(input::readFully)
            OwnerReadCacheEntry(ledgerId, snapshotAt, authenticatedAt, refreshExpiry, payload, userId, epoch)
        }
    } catch (error: SecureStorageException) {
        throw error
    } catch (error: Exception) {
        throw SecureStorageException("Encrypted cache could not be opened.", error)
    }

    private companion object {
        const val FORMAT_VERSION = 2
        const val MAX_CACHE_BYTES = 2 * 1024 * 1024
    }
}
