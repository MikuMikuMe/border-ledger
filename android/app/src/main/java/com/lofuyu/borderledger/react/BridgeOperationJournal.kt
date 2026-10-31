package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

data class BridgeOperation(val operationId: String, val kind: String, val status: String, val updatedAt: String, val resultId: String? = null)

/** Stable identity and idempotency inputs for one journal operation. */
data class BridgeOperationRequest(
    val id: String,
    val kind: String,
    val fingerprint: String,
    val owner: String,
)

data class BridgeOperationKey(val id: String, val owner: String)

data class BridgeOperationPage(val owner: String, val offset: Int, val limit: Int)

@JvmInline
private value class JournalOperationId(val raw: String)

@JvmInline
private value class JournalOwnerId(val raw: String)

@JvmInline
private value class JournalOperationKind(val raw: String)

@JvmInline
private value class JournalFingerprint(val raw: String)

@JvmInline
private value class JournalStatus(val raw: String)

@JvmInline
private value class DigestMaterial(val raw: String)

private data class JournalRequest(
    val id: JournalOperationId,
    val kind: JournalOperationKind,
    val fingerprint: JournalFingerprint,
    val owner: JournalOwnerId,
)

private data class JournalKey(
    val id: JournalOperationId,
    val owner: JournalOwnerId,
)

private data class JournalPage(
    val owner: JournalOwnerId,
    val offset: Int,
    val limit: Int,
)

private data class JournalCompletion(
    val status: JournalStatus,
    val receipt: String?,
)

private object JournalStatuses {
    val Running = JournalStatus("running")
    val AwaitingResult = JournalStatus("awaiting_result")
    val Completed = JournalStatus("completed")
    val Canceled = JournalStatus("canceled")
    val FailedLocal = JournalStatus("failed_local")
    val ReconciliationRequired = JournalStatus("reconciliation_required")
    val RevisionConflict = JournalStatus("revision_conflict")
    val Rejected = JournalStatus("rejected")
}

private fun BridgeOperationRequest.domain() = JournalRequest(
    id = JournalOperationId(id),
    kind = JournalOperationKind(kind),
    fingerprint = JournalFingerprint(fingerprint),
    owner = JournalOwnerId(owner),
)

private fun BridgeOperationKey.domain() = JournalKey(
    id = JournalOperationId(id),
    owner = JournalOwnerId(owner),
)

/** Separate v1 encrypted records. Persist BEFORE submission, never resume a write from disk. */
class BridgeOperationJournal(private val records: SecureRecordPort) {
    private val mutex = Mutex()
    private val active = mutableSetOf<JournalOperationId>()

    suspend fun start(request: BridgeOperationRequest, write: suspend () -> String?): BridgeOperation =
        startValidated(request, {}, write)

    internal suspend fun startValidated(
        request: BridgeOperationRequest,
        validate: () -> Unit,
        write: suspend () -> String?,
    ): BridgeOperation = startValidated(request.domain(), validate, write)

    private suspend fun startValidated(
        request: JournalRequest,
        validate: () -> Unit,
        write: suspend () -> String?,
    ): BridgeOperation {
        requireValidId(request.id)
        val existing = prepare(request, validate)
        return existing ?: execute(request, write)
    }

    private suspend fun prepare(request: JournalRequest, validate: () -> Unit): BridgeOperation? = mutex.withLock {
        read(request.id)?.let { stored ->
            requireMatches(stored, request)
            return@withLock decode(stored, request.id)
        }
        unresolved(request)?.let { return@withLock it }
        // Validation is local and runs before any running/submitted record.
        // Persist its terminal result so a lost JS promise can discover it.
        val rejected = isRejected(validate)
        val pending = operationRecord(request, if (rejected) JournalStatuses.FailedLocal else JournalStatuses.Running)
        val index = prepareIndex(request)
        records.write(key(request.id), pending.toString().encodeToByteArray())
        persistIndex(request, index)
        if (rejected) return@withLock decode(pending, request.id)
        active.add(request.id)
        null
    }

    private suspend fun execute(request: JournalRequest, write: suspend () -> String?): BridgeOperation {
        return try {
            finish(request.id, JournalCompletion(JournalStatuses.Completed, write()))
        } catch (error: CancellationException) {
            // Durable running state is deliberately left ambiguous if the process/coroutine dies.
            mutex.withLock { active.remove(request.id) }
            throw error
        } catch (error: Exception) {
            finish(request.id, JournalCompletion(failureStatus(error), (error as? com.lofuyu.borderledger.accounts.LunchFlowRequestFailure)?.let { "lunchflow_error:${it.code}" }))
        }
    }

    private fun isRejected(validate: () -> Unit): Boolean = try {
        validate()
        false
    } catch (_: BridgeLocalFailure) {
        true
    }

    private fun operationRecord(request: JournalRequest, status: JournalStatus) = JSONObject()
        .put("version", 1)
        .put("owner", request.owner.raw)
        .put("kind", request.kind.raw)
        .put("fingerprint", digest(DigestMaterial(request.fingerprint.raw)))
        .put("status", status.raw)
        .put("updatedAt", Instant.now().toString())

    private fun requireValidId(id: JournalOperationId) {
        require(id.raw.matches(OPERATION_ID_PATTERN))
    }

    private fun requireMatches(stored: JSONObject, request: JournalRequest) {
        require(
            stored.getString("owner") == request.owner.raw &&
                stored.getString("kind") == request.kind.raw &&
                stored.getString("fingerprint") == digest(DigestMaterial(request.fingerprint.raw)),
        )
    }

    suspend fun query(key: BridgeOperationKey): BridgeOperation? = query(key.domain())

    private suspend fun query(key: JournalKey): BridgeOperation? = mutex.withLock {
        val value = read(key.id)?.takeIf { it.getString("owner") == key.owner.raw } ?: return@withLock null
        decode(value, key.id)
    }

    /** Initial recovery page for a JS runtime that lost every in-memory request ID. */
    suspend fun list(page: BridgeOperationPage): List<BridgeOperation> = list(
        JournalPage(JournalOwnerId(page.owner), page.offset, page.limit),
    )

    private suspend fun list(page: JournalPage): List<BridgeOperation> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        require(page.offset >= 0 && page.limit in 1..100)
        mutex.withLock {
            val index=records.read(indexKey(page.owner))?.let { JSONObject(it.decodeToString()) } ?: return@withLock emptyList()
            val ids=index.keys().asSequence().map { index.getString(it) }.distinct().toList()
            ids.mapNotNull { id -> read(JournalOperationId(id))?.takeIf { it.getString("owner")==page.owner.raw }?.let { decode(it,JournalOperationId(id)) } }
                .sortedByDescending { Instant.parse(it.updatedAt) }.drop(page.offset).take(page.limit)
        }
    }

    suspend fun awaitExternal(request: BridgeOperationRequest): BridgeOperation = awaitExternal(request.domain())

    private suspend fun awaitExternal(request: JournalRequest): BridgeOperation = mutex.withLock {
        requireValidId(request.id)
        read(request.id)?.let {
            requireMatches(it, request)
            return@withLock decode(it,request.id)
        }
        unresolved(request)?.let { return@withLock it }
        val value=operationRecord(request, JournalStatuses.AwaitingResult)
        val index = prepareIndex(request)
        records.write(key(request.id),value.toString().encodeToByteArray())
        persistIndex(request, index)
        decode(value,request.id)
    }

    suspend fun completeExternal(operationKey: BridgeOperationKey, write: suspend () -> String?): BridgeOperation =
        completeExternal(operationKey.domain(), write)

    private suspend fun completeExternal(operationKey: JournalKey, write: suspend () -> String?): BridgeOperation {
        val existing=mutex.withLock {
            val value=requireNotNull(read(operationKey.id)); require(value.getString("owner")==operationKey.owner.raw)
            if(value.getString("status")!=JournalStatuses.AwaitingResult.raw) return@withLock decode(value,operationKey.id)
            value.put("status","running").put("updatedAt",Instant.now().toString())
            records.write(key(operationKey.id),value.toString().encodeToByteArray()); active.add(operationKey.id)
            null
        }
        if(existing!=null) return existing
        return try { finish(operationKey.id,JournalCompletion(JournalStatuses.Completed,write())) }
        catch(error: CancellationException) { mutex.withLock { active.remove(operationKey.id) }; throw error }
        catch(error: Exception) { finish(operationKey.id,JournalCompletion(failureStatus(error),null)) }
    }

    /**
     * Reconcile a callback whose remote endpoint supports the same stable
     * idempotency key. Callers must reuse the exact original request payload;
     * this is not a general retry path for ambiguous writes.
     */
    internal suspend fun retryExternalWithSameIdempotency(
        operationKey: BridgeOperationKey,
        write: suspend () -> String?,
    ): BridgeOperation = retryExternalWithSameIdempotency(operationKey.domain(), write)

    private suspend fun retryExternalWithSameIdempotency(
        operationKey: JournalKey,
        write: suspend () -> String?,
    ): BridgeOperation {
        val existing = mutex.withLock {
            val value = requireNotNull(read(operationKey.id))
            require(value.getString("owner") == operationKey.owner.raw)
            val stored = value.getString("status")
            if (stored == JournalStatuses.Running.raw && operationKey.id in active) return@withLock decode(value, operationKey.id)
            require(stored == JournalStatuses.Running.raw || stored == JournalStatuses.ReconciliationRequired.raw) {
                "Only an unresolved external operation can be reconciled."
            }
            value.put("status", "running").put("updatedAt", Instant.now().toString())
            records.write(key(operationKey.id), value.toString().encodeToByteArray())
            active.add(operationKey.id)
            null
        }
        if (existing != null) return existing
        return try {
            finish(operationKey.id, JournalCompletion(JournalStatuses.Completed, write()))
        } catch (error: CancellationException) {
            mutex.withLock { active.remove(operationKey.id) }
            throw error
        } catch (error: Exception) {
            finish(operationKey.id, JournalCompletion(failureStatus(error), (error as? com.lofuyu.borderledger.accounts.LunchFlowRequestFailure)?.let { "lunchflow_error:${it.code}" }))
        }
    }

    /** Only an external action that has not submitted work can be canceled. */
    suspend fun cancel(operationKey: BridgeOperationKey): BridgeOperation? = cancel(operationKey.domain())

    private suspend fun cancel(operationKey: JournalKey): BridgeOperation? = mutex.withLock {
        val value=read(operationKey.id)?.takeIf { it.getString("owner")==operationKey.owner.raw } ?: return@withLock null
        if(value.getString("status")==JournalStatuses.AwaitingResult.raw) {
            value.put("status",JournalStatuses.Canceled.raw).put("updatedAt",Instant.now().toString())
            records.write(key(operationKey.id),value.toString().encodeToByteArray())
        }
        decode(value,operationKey.id)
    }

    private suspend fun finish(id: JournalOperationId, completion: JournalCompletion): BridgeOperation = mutex.withLock {
        val value = requireNotNull(read(id)).put("status", completion.status.raw).put("updatedAt", Instant.now().toString())
        value.put("resultId", completion.receipt ?: JSONObject.NULL)
        records.write(key(id), value.toString().encodeToByteArray())
        active.remove(id)
        decode(value, id)
    }

    private fun decode(value: JSONObject, id: JournalOperationId): BridgeOperation {
        require(value.getInt("version") == 1)
        val stored = value.getString("status")
        val status = JournalStatus(stored)
        return BridgeOperation(id.raw, value.getString("kind"), if (status == JournalStatuses.Running && id !in active) JournalStatuses.ReconciliationRequired.raw else status.raw,
            value.getString("updatedAt"), value.optString("resultId").takeUnless { it.isNullOrBlank() || it == "null" })
    }

    private suspend fun read(id: JournalOperationId): JSONObject? = records.read(key(id))?.let { JSONObject(it.decodeToString()) }
    private fun failureStatus(error: Exception): JournalStatus = when(error) {
        is BridgeLocalFailure -> JournalStatuses.FailedLocal
        is com.lofuyu.borderledger.accounts.LunchFlowRequestFailure -> JournalStatuses.Rejected
        is com.lofuyu.borderledger.accounts.AccountRequestRejected,
        is com.lofuyu.borderledger.recurring.RecurringPlanRejected -> JournalStatuses.Rejected
        is com.lofuyu.borderledger.recurring.RecurringRevisionConflict,
        is com.lofuyu.borderledger.review.ReviewRevisionConflict,
        is com.lofuyu.borderledger.ui.accounts.devices.DeviceRevisionConflict,
        is com.lofuyu.borderledger.ui.settings.ReportingPreferencesRepository.RevisionConflict -> JournalStatuses.RevisionConflict
        else -> JournalStatuses.ReconciliationRequired
    }
    private suspend fun unresolved(request: JournalRequest): BridgeOperation? {
        val index=records.read(indexKey(request.owner))?.let { JSONObject(it.decodeToString()) } ?: return null
        val id=index.optString(operationFingerprint(request)).takeIf { it.isNotBlank() }?.let(::JournalOperationId) ?: return null
        val value=read(id) ?: error("Missing operation")
        return decode(value,id).takeIf { it.status in setOf(JournalStatuses.Running.raw,JournalStatuses.AwaitingResult.raw,JournalStatuses.ReconciliationRequired.raw) }
    }
    private suspend fun prepareIndex(request: JournalRequest): JSONObject {
        val value=records.read(indexKey(request.owner))?.let { JSONObject(it.decodeToString()) } ?: JSONObject()
        val fingerprints = value.keys().asSequence().toList()
        fingerprints.forEach { fingerprint ->
            val id = value.getString(fingerprint)
            val operation = read(JournalOperationId(id))
            if (operation?.getString("owner") == request.owner.raw && isTerminalForIndex(operation.getString("status"))) {
                value.remove(fingerprint)
            }
        }
        val fingerprint = operationFingerprint(request)
        check(value.has(fingerprint) || value.length() < MAX_INDEXED_FINGERPRINTS) {
            "The owner operation index is full of unresolved operations. Reconcile them before starting another write."
        }
        return value
    }

    private suspend fun persistIndex(request: JournalRequest, value: JSONObject) {
        value.put(operationFingerprint(request),request.id.raw)
        records.write(indexKey(request.owner),value.toString().encodeToByteArray())
    }

    private fun isTerminalForIndex(status: String) = status == JournalStatuses.Completed.raw ||
        status == JournalStatuses.Canceled.raw ||
        status == JournalStatuses.FailedLocal.raw ||
        status == JournalStatuses.RevisionConflict.raw ||
        status == JournalStatuses.Rejected.raw
    private fun operationFingerprint(request: JournalRequest) = DigestMaterial(
        listOf(request.owner.raw,request.kind.raw,request.fingerprint.raw).toString(),
    ).let(::digest)
    private fun indexKey(owner: JournalOwnerId)="rn_op_index_v1_${digest(DigestMaterial(owner.raw))}"
    private fun key(id: JournalOperationId) = "rn_operation_v1_${digest(DigestMaterial(id.raw))}"
    private fun digest(value: DigestMaterial) = MessageDigest.getInstance("SHA-256").digest(value.raw.encodeToByteArray()).joinToString("") { "%02x".format(it) }

    private companion object {
        const val MAX_INDEXED_FINGERPRINTS = 10_000
        val OPERATION_ID_PATTERN = Regex("[A-Za-z0-9_-]{8,96}")
    }
}
