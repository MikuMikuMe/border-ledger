package com.lofuyu.borderledger.local

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.time.Duration
import java.time.Instant

data class OwnerReadCacheEntry(
    val ownerLedgerId: String,
    val snapshotAt: String,
    val lastAuthenticatedAt: String,
    val refreshExpiresAt: String,
    val payload: ByteArray,
)

interface OwnerReadCache {
    suspend fun write(entry: OwnerReadCacheEntry)
    suspend fun readIfUsable(now: Instant): OwnerReadCacheEntry?
    suspend fun clear()
}

/** Encrypted offline snapshot with the spec's same-ledger/24-hour/refresh lease. */
class EncryptedOwnerReadCache(private val records: EncryptedRecordStore) : OwnerReadCache {
    override suspend fun write(entry: OwnerReadCacheEntry) {
        require(entry.ownerLedgerId == "personal")
        records.write(LedgerRecord.FINANCIAL_READ_CACHE, encode(entry))
    }

    override suspend fun readIfUsable(now: Instant): OwnerReadCacheEntry? {
        val bytes = records.read(LedgerRecord.FINANCIAL_READ_CACHE) ?: return null
        val entry = decode(bytes)
        val authenticated = runCatching { Instant.parse(entry.lastAuthenticatedAt) }.getOrNull()
        val refreshExpiry = runCatching { Instant.parse(entry.refreshExpiresAt) }.getOrNull()
        if (entry.ownerLedgerId != "personal" || authenticated == null || refreshExpiry == null) return null
        val leaseExpiry = minOf(refreshExpiry, authenticated.plus(Duration.ofHours(24)))
        if (!now.isBefore(leaseExpiry)) {
            records.delete(LedgerRecord.FINANCIAL_READ_CACHE)
            return null
        }
        return entry
    }

    override suspend fun clear() = records.delete(LedgerRecord.FINANCIAL_READ_CACHE)

    private fun encode(entry: OwnerReadCacheEntry): ByteArray = ByteArrayOutputStream().use { bytes ->
        DataOutputStream(bytes).use { output ->
            output.writeInt(FORMAT_VERSION)
            output.writeUTF(entry.ownerLedgerId)
            output.writeUTF(entry.snapshotAt)
            output.writeUTF(entry.lastAuthenticatedAt)
            output.writeUTF(entry.refreshExpiresAt)
            output.writeInt(entry.payload.size)
            output.write(entry.payload)
        }
        bytes.toByteArray()
    }

    private fun decode(bytes: ByteArray): OwnerReadCacheEntry = try {
        DataInputStream(ByteArrayInputStream(bytes)).use { input ->
            if (input.readInt() != FORMAT_VERSION) throw SecureStorageException("Encrypted cache format is not supported.")
            val ledgerId = input.readUTF()
            val snapshotAt = input.readUTF()
            val authenticatedAt = input.readUTF()
            val refreshExpiry = input.readUTF()
            val size = input.readInt()
            if (size < 0 || size > MAX_CACHE_BYTES) throw SecureStorageException("Encrypted cache payload is not valid.")
            val payload = ByteArray(size).also(input::readFully)
            OwnerReadCacheEntry(ledgerId, snapshotAt, authenticatedAt, refreshExpiry, payload)
        }
    } catch (error: SecureStorageException) {
        throw error
    } catch (error: Exception) {
        throw SecureStorageException("Encrypted cache could not be opened.", error)
    }

    private companion object {
        const val FORMAT_VERSION = 1
        const val MAX_CACHE_BYTES = 2 * 1024 * 1024
    }
}
