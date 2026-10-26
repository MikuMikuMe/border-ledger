package com.lofuyu.borderledger.local

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.IOException

/** Named encrypted records; the interface can be replaced by Room/SQLCipher without changing callers. */
interface EncryptedRecordStore : com.lofuyu.borderledger.core.SecureRecordPort

object LedgerRecord {
    const val OWNER_SESSION = "owner_session"
    const val OWNER_LOGIN_PENDING = "owner_login_pending"
    const val OWNER_ROTATION_PENDING = "owner_rotation_pending"
    const val OWNER_CALLBACK_MARKER = "owner_callback_marker"
    const val OWNER_REVOCATIONS = "owner_revocations"
    const val CAPTURE_CREDENTIAL = "capture_credential"
    const val FINANCIAL_READ_CACHE = "financial_read_cache"
    const val NORMALIZED_EVIDENCE = "normalized_evidence"
    const val OUTBOX_QUEUE = "outbox_queue"
    const val CAPTURE_INTAKE = "capture_intake"
    const val MONITORING_STATE = "monitoring_state"
}

/** Stores encrypted records below noBackupFilesDir; it never falls back to plaintext or deletes bad data. */
class FileEncryptedRecordStore(
    context: Context,
    private val vault: KeyStoreVault,
    directoryName: String = "border-ledger-secure",
) : EncryptedRecordStore {
    private val directory = File(context.noBackupFilesDir, directoryName)

    override suspend fun read(record: String): ByteArray? = synchronized(this) {
        val file = fileFor(record)
        if (!file.exists()) return@synchronized null
        try {
            vault.decrypt(aliasFor(record), file.readBytes(), record.encodeToByteArray())
        } catch (error: SecureStorageException) {
            throw error
        } catch (error: IOException) {
            throw SecureStorageException("Encrypted storage could not be read.", error)
        }
    }

    override suspend fun write(record: String, value: ByteArray) = synchronized(this) {
        val maximum = if (record == LedgerRecord.CAPTURE_INTAKE || record.startsWith("${LedgerRecord.CAPTURE_INTAKE}_")) MAX_CAPTURE_INTAKE_RECORD_BYTES else MAX_RECORD_BYTES
        if (value.size > maximum) throw SecureStorageException("Encrypted storage record is too large.")
        ensureDirectory()
        val encrypted = vault.encrypt(aliasFor(record), value, record.encodeToByteArray())
        val atomic = AtomicFile(fileFor(record))
        var stream: java.io.FileOutputStream? = null
        try {
            val output = atomic.startWrite()
            stream = output
            output.write(encrypted)
            output.flush()
            atomic.finishWrite(output)
            stream = null
        } catch (error: Exception) {
            stream?.let { atomic.failWrite(it) }
            throw SecureStorageException("Encrypted storage could not be committed.", error)
        }
    }

    override suspend fun delete(record: String) = synchronized(this) {
        val file = fileFor(record)
        if (!file.exists()) return@synchronized
        if (!file.delete()) throw SecureStorageException("Encrypted storage could not be cleared.")
    }

    private fun ensureDirectory() {
        if (!directory.exists() && !directory.mkdirs()) throw SecureStorageException("Encrypted storage directory is unavailable.")
    }

    private fun fileFor(record: String): File {
        if (!SAFE_RECORD.matches(record)) throw SecureStorageException("Encrypted storage record name is not valid.")
        return File(directory, "$record.bin")
    }

    private fun aliasFor(record: String): String = "border_ledger_v1_$record"

    private companion object {
        const val MAX_RECORD_BYTES = 2 * 1024 * 1024
        // The bounded 5,000-event capture cap is stored as one encrypted
        // atomic record so observation/event/queue state cannot diverge.
        const val MAX_CAPTURE_INTAKE_RECORD_BYTES = 16 * 1024 * 1024
        val SAFE_RECORD = Regex("[A-Za-z0-9._-]{1,96}")
    }
}
