package com.lofuyu.borderledger.auth

import com.lofuyu.borderledger.local.EncryptedRecordStore
import com.lofuyu.borderledger.local.SecureStorageException
import java.security.MessageDigest
import java.time.Instant
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.withContext

/** Pins intake, network attachment and acknowledgements to one consented credential. */
class CaptureWork(val credential: CaptureCredentialRecord) : AbstractCoroutineContextElement(Key) {
    val binding: SessionBinding get() = SessionBinding(requireNotNull(credential.identity), requireNotNull(credential.sessionEpoch))
    val partition: String get() {
        val parts = listOf(binding.identity.userId, binding.identity.ledgerId, binding.epoch, credential.deviceId, credential.generation.toString())
        val serialized = parts.joinToString("") { "${it.length}:$it" }
        return MessageDigest.getInstance("SHA-256").digest(serialized.toByteArray()).joinToString("") { "%02x".format(it) }
    }
    companion object Key : CoroutineContext.Key<CaptureWork>
}
class CaptureWorkBoundary(
    private val credentials: CaptureCredentialProvider,
    private val owner: () -> SessionBinding?,
    private val commit: (suspend (SessionBinding, suspend () -> Unit) -> Boolean)? = null,
    private val prepareOwner: suspend () -> Unit = {},
    private val workContext: (SessionBinding) -> CoroutineContext = { kotlin.coroutines.EmptyCoroutineContext },
) {
    suspend fun capture(): CaptureWork? {
        prepareOwner()
        return acquire()
    }
    private suspend fun acquire(): CaptureWork? {
        val binding = owner() ?: return null
        val credential = credentials.current() ?: return null
        if (credential.identity != binding.identity || credential.sessionEpoch != binding.epoch) return null
        if (!runCatching { Instant.parse(credential.expiresAt).isAfter(Instant.now()) }.getOrDefault(false)) return null
        return CaptureWork(credential).takeIf { owner() == binding }
    }
    suspend fun requireCurrent(work: CaptureWork) {
        if (acquire()?.credential != work.credential) throw SecureStorageException("Capture is paused. Authorize it again for this account.")
    }
    suspend fun commit(work: CaptureWork, block: suspend () -> Unit) {
        requireCurrent(work)
        val expected = SessionBinding(requireNotNull(work.credential.identity), requireNotNull(work.credential.sessionEpoch))
        val action: suspend () -> Unit = { requireCurrent(work); block() }
        if (commit != null) {
            if (!commit.invoke(expected, action)) throw SecureStorageException("Capture session changed.")
        } else action()
    }
    suspend fun <T> run(fallback: T, block: suspend () -> T): T {
        val work = capture() ?: return fallback
        return withContext(work + workContext(work.binding)) {
            requireCurrent(work)
            val result = block()
            requireCurrent(work)
            result
        }
    }
}

/** Original unbound records remain encrypted quarantine. No migration relabels or deletes them. */
class CaptureIdentityRecords(
    private val records: EncryptedRecordStore,
    private val boundary: CaptureWorkBoundary,
) : EncryptedRecordStore {
    private suspend fun name(record: String): String {
        val work = coroutineContext[CaptureWork] ?: throw SecureStorageException("Capture identity is required.")
        boundary.requireCurrent(work)
        return "${record}_${work.partition}"
    }
    override suspend fun read(record: String): ByteArray? = records.read(name(record))
    override suspend fun write(record: String, value: ByteArray) = records.write(name(record), value)
    override suspend fun delete(record: String) = records.delete(name(record))
}
