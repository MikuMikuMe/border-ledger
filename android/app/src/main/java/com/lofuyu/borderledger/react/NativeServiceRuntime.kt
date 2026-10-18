package com.lofuyu.borderledger.react

import android.content.Intent
import android.net.Uri
import com.lofuyu.borderledger.AppContainer
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.ui.ledger.LedgerSnapshotDecoder
import com.lofuyu.borderledger.ui.ledger.LedgerSnapshotDecodeResult
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

interface NativeServiceHost {
    fun openBrowser(uri: Uri)
    fun launchImport(operationId: String)
    fun launchExport(operationId: String)
    suspend fun launchPlaid(linkToken: String, operationId: String): com.lofuyu.borderledger.bank.PlaidLinkResult
    fun openNotificationSettings()
    fun openAppNotificationSettings()
}

/**
 * Serializes the in-memory file repositories and binds their contents to one
 * owner generation. A late completion may only run against the generation it
 * captured; binding a new generation resets the repositories before any new
 * snapshot or row can be observed.
 */
internal class OwnerScopedFileState(
    private val onReset: () -> Unit = {},
) {
    private val mutex = Mutex()
    private var owner: String? = null

    suspend fun bindCurrent(ownerId: String) = mutex.withLock {
        if (owner != ownerId) {
            onReset()
            owner = ownerId
        }
    }

    suspend fun <R> runCurrent(
        ownerId: String,
        isCurrent: suspend () -> Boolean = { true },
        block: suspend () -> R,
    ): R = mutex.withLock {
        // A caller can capture an owner generation before waiting for this
        // mutex. Validate that capture before resetting a repository already
        // bound to a newer owner.
        check(isCurrent()) { "file state owner generation is stale" }
        if (owner != ownerId) {
            onReset()
            owner = ownerId
        }
        block()
    }

    suspend fun <R> runBound(ownerId: String, block: suspend () -> R): R = mutex.withLock {
        check(owner == ownerId) { "file state belongs to a different owner generation" }
        block()
    }

    suspend fun invalidate() = mutex.withLock {
        owner = null
        onReset()
    }
}

/** Application lifetime: destroying a JS runtime/Activity never cancels submitted financial work. */
class NativeServiceRuntime(val container: AppContainer, val applicationContext: android.content.Context) {
    val external = NativeExternalServices(this)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val changes = MutableSharedFlow<String>(extraBufferCapacity = 32)
    var host: NativeServiceHost? = null
    private val generationMutex = Mutex()
    private val ownerWorkMutex = Mutex()
    private var signingOut=false
    private val fileState = OwnerScopedFileState {
            container.importRepository.reset()
            container.exportCoordinator.reset()
    }
    val session = BridgeSessionLifecycle(container.ownerSessionManager) {
        signingOut=true
        generationMutex.withLock { container.bridgeRecords.delete(GENERATION) }
    }
    private var sequence = 0L

    suspend fun ownerGeneration(): String = generationMutex.withLock {
        if(signingOut || container.ownerSessionManager.state.value !is OwnerSessionState.SignedIn) throw BridgeFailure("not_signed_in")
        container.bridgeRecords.read(GENERATION)?.decodeToString() ?: UUID.randomUUID().toString().also {
            container.bridgeRecords.write(GENERATION, it.encodeToByteArray())
        }
    }
    suspend fun currentGeneration(): String? = generationMutex.withLock { if(signingOut) null else container.bridgeRecords.read(GENERATION)?.decodeToString() }
    suspend fun beginLogin(staySignedIn: Boolean, destination: String?): com.lofuyu.borderledger.auth.LoginLaunch = ownerWorkMutex.withLock {
        if(container.ownerSessionManager.state.value !is OwnerSessionState.SignedIn) generationMutex.withLock {
            container.bridgeRecords.delete(GENERATION)
        }
        container.ownerSessionManager.beginLogin(staySignedIn,destination)
    }
    suspend fun signOut() = ownerWorkMutex.withLock {
        // Fence queued UI results before the existing native sign-out clears credentials/cache.
        try {
            session.signOut()
            fileState.invalidate()
        } finally { signingOut=false }
        container.captureOnboarding.syncOwnerSessionState()
        changes.emit("all")
    }
    suspend fun resume() = ownerWorkMutex.withLock {
        session.resume()
        if(container.ownerSessionManager.state.value is OwnerSessionState.SignedOut || container.ownerSessionManager.state.value is OwnerSessionState.Expired) {
            generationMutex.withLock { container.bridgeRecords.delete(GENERATION) }
            fileState.invalidate()
        } else if (container.ownerSessionManager.state.value is OwnerSessionState.SignedIn) {
            fileState.bindCurrent(ownerGeneration())
        }
        container.captureOnboarding.syncOwnerSessionState()
        changes.emit("all")
    }
    suspend fun cachedSnapshot(): Map<String, Any?>? {
        val entry = container.ledgerRepository.readCachedOwnerSnapshot(Instant.now()) ?: return null
        return (LedgerSnapshotDecoder.decode(entry.payload) as? LedgerSnapshotDecodeResult.Ready)?.snapshot?.let(BridgePayloads::snapshot)
    }
    fun changePayload() = mapOf("sequence" to (++sequence).toDouble(), "observedAt" to Instant.now().toString())
    suspend fun fileSnapshot(): Map<String,Any?> {
        val owner=ownerGeneration()
        return fileState.runCurrent(owner, isCurrent = { isCurrentOwner(owner) }) {
            check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            BridgePayloads.files(container.importRepository.state.value,container.exportCoordinator.state.value)
        }
    }
    suspend fun fileDraft(expectedOwner: String? = null): com.lofuyu.borderledger.imports.ImportDraft? {
        val owner=expectedOwner ?: ownerGeneration()
        return if (expectedOwner == null) fileState.runCurrent(owner, isCurrent = { isCurrentOwner(owner) }) {
            check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            BridgePayloads.importDraft(container.importRepository.state.value)
        } else fileState.runBound(owner) {
            check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            BridgePayloads.importDraft(container.importRepository.state.value)
        }
    }
    suspend fun <T> withFiles(block: suspend () -> T): T {
        val owner=ownerGeneration()
        return fileState.runCurrent(owner, isCurrent = { isCurrentOwner(owner) }) {
            check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            val result=block()
            check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            result
        }
    }
    suspend fun <T> withFiles(expectedOwner: String, block: suspend () -> T): T {
        check(currentGeneration()==expectedOwner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
        return fileState.runCurrent(expectedOwner, isCurrent = { isCurrentOwner(expectedOwner) }) {
            check(currentGeneration()==expectedOwner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            val result=block()
            check(currentGeneration()==expectedOwner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            result
        }
    }
    suspend fun <T> withOwner(expectedOwner: String, block: suspend () -> T): T = ownerWorkMutex.withLock {
        check(currentGeneration()==expectedOwner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
        val result=block()
        check(currentGeneration()==expectedOwner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
        result
    }

    private suspend fun isCurrentOwner(owner: String): Boolean =
        currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn

    /** Keep the validated selection/fingerprint stable through journal submission. */
    internal suspend fun writeFiles(id: String, kind: String, fingerprint: (com.lofuyu.borderledger.imports.ImportDraft?) -> String,
        validate: (com.lofuyu.borderledger.imports.ImportDraft?) -> Unit, block: suspend () -> String?): Map<String,Any?> {
        val owner=ownerGeneration()
        return ownerWorkMutex.withLock {
            val result=withFiles(owner) {
                val draft=BridgePayloads.importDraft(container.importRepository.state.value)
                val result=container.bridgeOperations.startValidated(id,kind,fingerprint(draft),owner,{validate(draft)}) {
                    check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
                    block()
                }
                BridgePayloads.operation(result)
            }
            changes.emit("all")
            check(currentGeneration()==owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            result
        }
    }
    suspend fun write(id: String, kind: String, fingerprint: String, block: suspend () -> String?): Map<String, Any?> =
        writeInternal(id, kind, fingerprint, null, block)

    suspend fun write(id: String, kind: String, fingerprint: String, expectedOwner: String, block: suspend () -> String?): Map<String, Any?> =
        writeInternal(id, kind, fingerprint, expectedOwner, block)

    private suspend fun writeInternal(id: String, kind: String, fingerprint: String, expectedOwner: String?, block: suspend () -> String?): Map<String, Any?> {
        val owner = ownerGeneration()
        require(expectedOwner == null || expectedOwner == owner)
        return ownerWorkMutex.withLock {
            check(currentGeneration() == owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            val result = container.bridgeOperations.start(id, kind, fingerprint, owner) {
                check(currentGeneration() == owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
                block()
            }
            changes.emit("all")
            check(currentGeneration() == owner && container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
            BridgePayloads.operation(result)
        }
    }
    companion object { private const val GENERATION = "rn_owner_generation_v1" }
}
