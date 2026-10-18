package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

data class BridgeOperation(val operationId: String, val kind: String, val status: String, val updatedAt: String, val resultId: String? = null)

/** Separate v1 encrypted records. Persist BEFORE submission, never resume a write from disk. */
class BridgeOperationJournal(private val records: SecureRecordPort) {
    private val mutex = Mutex()
    private val active = mutableSetOf<String>()

    suspend fun start(id: String, kind: String, fingerprint: String, owner: String, write: suspend () -> String?): BridgeOperation =
        startValidated(id,kind,fingerprint,owner,{},write)

    internal suspend fun startValidated(id: String, kind: String, fingerprint: String, owner: String, validate: () -> Unit, write: suspend () -> String?): BridgeOperation {
        require(id.matches(Regex("[A-Za-z0-9_-]{8,96}")))
        val existing = mutex.withLock {
            read(id)?.let { stored ->
                require(stored.getString("owner") == owner && stored.getString("kind") == kind && stored.getString("fingerprint") == digest(fingerprint))
                return@withLock decode(stored, id)
            }
            unresolved(kind,fingerprint,owner)?.let { return@withLock it }
            // Validation is local and runs before any running/submitted record.
            // Persist its terminal result so a lost JS promise can discover it.
            val rejected=try { validate(); false } catch(_: BridgeLocalFailure) { true }
            val pending = JSONObject().put("version", 1).put("owner", owner).put("kind", kind)
                .put("fingerprint", digest(fingerprint)).put("status", if(rejected) "failed_local" else "running").put("updatedAt", Instant.now().toString())
            records.write(key(id), pending.toString().encodeToByteArray())
            index(id,kind,fingerprint,owner)
            if(rejected) return@withLock decode(pending,id)
            active.add(id)
            null
        }
        if (existing != null) return existing
        try {
            val receipt = write()
            return finish(id, "completed", receipt)
        } catch (error: CancellationException) {
            // Durable running state is deliberately left ambiguous if the process/coroutine dies.
            mutex.withLock { active.remove(id) }
            throw error
        } catch (error: Exception) {
            return finish(id, failureStatus(error), null)
        }
    }

    suspend fun query(id: String, owner: String): BridgeOperation? = mutex.withLock {
        val value = read(id)?.takeIf { it.getString("owner") == owner } ?: return@withLock null
        decode(value, id)
    }

    /** Initial recovery page for a JS runtime that lost every in-memory request ID. */
    suspend fun list(owner: String, offset: Int, limit: Int): List<BridgeOperation> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        require(offset>=0 && limit in 1..100)
        mutex.withLock {
            val index=records.read(indexKey(owner))?.let { JSONObject(it.decodeToString()) } ?: return@withLock emptyList()
            val ids=index.keys().asSequence().map { index.getString(it) }.distinct().toList()
            ids.mapNotNull { id -> read(id)?.takeIf { it.getString("owner")==owner }?.let { decode(it,id) } }
                .sortedByDescending { Instant.parse(it.updatedAt) }.drop(offset).take(limit)
        }
    }

    suspend fun awaitExternal(id: String, kind: String, fingerprint: String, owner: String): BridgeOperation = mutex.withLock {
        require(id.matches(Regex("[A-Za-z0-9_-]{8,96}")))
        read(id)?.let {
            require(it.getString("owner") == owner && it.getString("kind") == kind && it.getString("fingerprint") == digest(fingerprint))
            return@withLock decode(it,id)
        }
        unresolved(kind,fingerprint,owner)?.let { return@withLock it }
        val value=JSONObject().put("version",1).put("owner",owner).put("kind",kind).put("fingerprint",digest(fingerprint))
            .put("status","awaiting_result").put("updatedAt",Instant.now().toString())
        records.write(key(id),value.toString().encodeToByteArray())
        index(id,kind,fingerprint,owner)
        decode(value,id)
    }

    suspend fun completeExternal(id: String, owner: String, write: suspend () -> String?): BridgeOperation {
        val existing=mutex.withLock {
            val value=requireNotNull(read(id)); require(value.getString("owner")==owner)
            if(value.getString("status")!="awaiting_result") return@withLock decode(value,id)
            value.put("status","running").put("updatedAt",Instant.now().toString())
            records.write(key(id),value.toString().encodeToByteArray()); active.add(id)
            null
        }
        if(existing!=null) return existing
        return try { finish(id,"completed",write()) }
        catch(error: CancellationException) { mutex.withLock { active.remove(id) }; throw error }
        catch(error: Exception) { finish(id,failureStatus(error),null) }
    }

    /** Only an external action that has not submitted work can be canceled. */
    suspend fun cancel(id: String, owner: String): BridgeOperation? = mutex.withLock {
        val value=read(id)?.takeIf { it.getString("owner")==owner } ?: return@withLock null
        if(value.getString("status")=="awaiting_result") {
            value.put("status","canceled").put("updatedAt",Instant.now().toString())
            records.write(key(id),value.toString().encodeToByteArray())
        }
        decode(value,id)
    }

    private suspend fun finish(id: String, status: String, receipt: String?): BridgeOperation = mutex.withLock {
        val value = requireNotNull(read(id)).put("status", status).put("updatedAt", Instant.now().toString())
        value.put("resultId", receipt ?: JSONObject.NULL)
        records.write(key(id), value.toString().encodeToByteArray())
        active.remove(id)
        decode(value, id)
    }

    private fun decode(value: JSONObject, id: String): BridgeOperation {
        require(value.getInt("version") == 1)
        val stored = value.getString("status")
        return BridgeOperation(id, value.getString("kind"), if (stored == "running" && id !in active) "reconciliation_required" else stored,
            value.getString("updatedAt"), value.optString("resultId").takeUnless { it.isNullOrBlank() || it == "null" })
    }

    private suspend fun read(id: String): JSONObject? = records.read(key(id))?.let { JSONObject(it.decodeToString()) }
    private fun failureStatus(error: Exception): String = when(error) {
        is BridgeLocalFailure -> "failed_local"
        is com.lofuyu.borderledger.recurring.RecurringRevisionConflict,
        is com.lofuyu.borderledger.review.ReviewRevisionConflict,
        is com.lofuyu.borderledger.ui.accounts.devices.DeviceRevisionConflict,
        is com.lofuyu.borderledger.ui.settings.ReportingPreferencesRepository.RevisionConflict -> "revision_conflict"
        else -> "reconciliation_required"
    }
    private suspend fun unresolved(kind: String, fingerprint: String, owner: String): BridgeOperation? {
        val index=records.read(indexKey(owner))?.let { JSONObject(it.decodeToString()) } ?: return null
        val id=index.optString(digest(listOf(owner,kind,fingerprint).toString())).takeIf { it.isNotBlank() } ?: return null
        val value=read(id) ?: error("Missing operation")
        return decode(value,id).takeIf { it.status in setOf("running","awaiting_result","reconciliation_required") }
    }
    private suspend fun index(id: String, kind: String, fingerprint: String, owner: String) {
        val value=records.read(indexKey(owner))?.let { JSONObject(it.decodeToString()) } ?: JSONObject()
        require(value.length()<10000)
        value.put(digest(listOf(owner,kind,fingerprint).toString()),id)
        records.write(indexKey(owner),value.toString().encodeToByteArray())
    }
    private fun indexKey(owner: String)="rn_op_index_v1_${digest(owner)}"
    private fun key(id: String) = "rn_operation_v1_${digest(id)}"
    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.encodeToByteArray()).joinToString("") { "%02x".format(it) }
}
