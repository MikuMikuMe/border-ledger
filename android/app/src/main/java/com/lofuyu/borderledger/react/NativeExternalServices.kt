package com.lofuyu.borderledger.react

import android.net.Uri
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.bank.ConnectionCoordinatorState
import com.lofuyu.borderledger.bank.PlaidLinkResult
import com.lofuyu.borderledger.exports.*
import com.lofuyu.borderledger.imports.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.security.MessageDigest

internal class RestoredOwnerFence(
    private val restore: suspend () -> Unit,
    private val currentGeneration: suspend () -> String?,
    private val signedIn: () -> Boolean,
) {
    suspend fun matches(expectedOwner: String): Boolean {
        try {
            restore()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return false
        }
        return signedIn() && currentGeneration() == expectedOwner
    }
}

internal class RestoredPlaidCallbackClaim(
    private val pending: suspend () -> JSONObject?,
    private val ownerFence: RestoredOwnerFence,
) {
    suspend fun claim(operationId: String): JSONObject? {
        val persisted = pending()?.takeIf {
            it.getString("kind") == "plaid" && it.getString("operationId") == operationId
        } ?: return null
        return persisted.takeIf { ownerFence.matches(it.getString("owner")) }
    }
}

/** Native-only persisted handoff arguments. SAF URIs, file bytes and provider tokens never enter JS. */
class NativeExternalServices(private val r: NativeServiceRuntime) {
    private val mutex=Mutex()
    private val records get()=r.container.bridgeRecords
    private val restoredOwnerFence = RestoredOwnerFence(
        restore = { r.container.ownerSessionManager.restore() },
        currentGeneration = { r.currentGeneration() },
        signedIn = { r.container.ownerSessionManager.state.value is OwnerSessionState.SignedIn },
    )
    private val plaidCallbackClaim = RestoredPlaidCallbackClaim(
        pending = { pending() },
        ownerFence = restoredOwnerFence,
    )

    suspend fun start(id: String, kind: String, arguments: JSONObject): Map<String,Any?> {
        val owner=r.ownerGeneration()
        return r.withOwner(owner) {
            mutex.withLock {
                val existing=r.container.bridgeOperations.query(id,owner)
                if(existing!=null) return@withLock BridgePayloads.operation(r.container.bridgeOperations.awaitExternal(id,kind,arguments.toString(),owner))
                val host=requireNotNull(r.host)
                val previous=pending()
                if(previous!=null) {
                    val previousOwner=previous.getString("owner")
                    val previousId=previous.getString("operationId")
                    if(previousOwner==owner) {
                        // Submitted handoffs require a drained callback. A proven
                        // local import rejection sent nothing and can be replaced even
                        // if the process died before writing its drained marker.
                        val localRejection=BridgeImportOperations.canReplaceUndrainedPicker(previous.getString("kind"),r.container.bridgeOperations.query(previousId,owner)?.status)
                        check(localRejection || isDrained(owner,previousId)) { "external handoff is still owned by a prior callback" }
                    }
                    records.delete(PENDING)
                }
                val op=r.container.bridgeOperations.awaitExternal(id,kind,arguments.toString(),owner)
                if(op.operationId!=id) return@withLock BridgePayloads.operation(op)
                val requestCode=nextRequestCode()
                val value=JSONObject().put("version",1).put("operationId",id).put("kind",kind).put("owner",owner).put("requestCode",requestCode).put("arguments",arguments)
                records.write(PENDING,value.toString().encodeToByteArray())
                if(kind=="plaid") persistLinkOutcome(owner,ConnectionCoordinatorState.Linking)
                when(kind) {
                    "import_picker" -> host.launchImport(id)
                    "export_picker" -> host.launchExport(id)
                    "plaid" -> r.scope.launch {
                        try {
                            val result = r.withOwner(owner) {
                                val link=r.container.accountRepository.createLinkToken(arguments.bridgeNullableString("reconnectConnectionId"))
                                requireNotNull(r.host).launchPlaid(requireNotNull(link.linkToken),id)
                            }
                            handlePlaid(result,id)
                        } catch(error: CancellationException) { throw error }
                        catch(_: Exception) {
                            runCatching {
                                r.withOwner(owner) {
                                    r.container.bridgeOperations.cancel(id,owner)
                                    markDrained(owner,id)
                                    clearPendingIf(id,owner)
                                    persistLinkOutcome(owner,ConnectionCoordinatorState.Failed("failed"))
                                    r.changes.emit("accounts")
                                }
                            }
                        }
                    }
                }
                BridgePayloads.operation(op)
            }
        }
    }

    suspend fun requestCode(id: String): Int = requireNotNull(pending()?.takeIf { it.getString("operationId")==id }).getInt("requestCode")

    suspend fun handleDocumentResult(code: Int, uri: Uri?, accepted: Boolean) {
        val value=pending()?.takeIf { it.getInt("requestCode")==code && it.getString("kind")!="plaid" } ?: return
        if(!ownerMatches(value)) return
        val id=value.getString("operationId"); val owner=value.getString("owner")
        r.withOwner(owner) {
            if(!accepted || uri==null) {
                r.container.bridgeOperations.cancel(id,owner)
                markDrained(owner,id)
                clearPendingIf(id,owner)
                r.changes.emit("files")
                return@withOwner
            }
            r.container.bridgeOperations.completeExternal(id,owner) {
                check(ownerMatches(value))
                r.withFiles(owner) {
                    val args=value.getJSONObject("arguments")
                    when(value.getString("kind")) {
                        "import_picker" -> {
                            BridgeImportOperations.preview(r.container.importRepository,r.container.statementDocumentReader.read(uri),args.getString("accountId"),id)
                        }
                        "export_picker" -> {
                            val request=LedgerExportRequest(ExportSelection.entries.first { it.wireValue==args.getString("selection") },
                                LedgerExportFilters(args.bridgeNullableString("currency"),args.bridgeNullableString("startDate"),args.bridgeNullableString("endDate")))
                            val result=r.container.exportCoordinator.export(request, ContentResolverExportDestination(r.applicationContext.contentResolver,uri), if(args.getBoolean("share")) ExportHandoff.Share else ExportHandoff.Save)
                            check(result is ExportState.Completed)
                            if(args.getBoolean("share") && ownerMatches(value)) r.applicationContext.startActivity(r.container.exportCoordinator.createShareIntent(uri).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                            result.receipt.receiptId
                        }
                        else -> error("Unknown handoff")
                    }
                }
            }
            markDrained(owner,id)
            clearPendingIf(id,owner)
        }
        r.changes.emit("files")
    }

    suspend fun handlePlaid(result: PlaidLinkResult, operationId: String?=null) {
        // A callback without an Activity-restored identity is orphaned. Never
        // bind it to the currently pending operation: that operation may be a
        // newer flow created after cancellation or process recreation.
        if (operationId == null) return
        val persisted = plaidCallbackClaim.claim(operationId) ?: return
        val owner=persisted.getString("owner")
        // A recreated Activity can deliver the SDK result before onResume.
        // Restore the native session before entering the generation fence. If
        // restoration cannot validate the persisted owner, leave the handoff
        // pending for conservative recovery rather than canceling or rebinding it.
        r.withOwner(owner) {
            val value=pending()?.takeIf {
                it.getString("kind")=="plaid" &&
                    it.getString("owner")==owner &&
                    it.getString("operationId")==operationId
            } ?: return@withOwner
            val id=value.getString("operationId")
            if(result is PlaidLinkResult.Canceled || result is PlaidLinkResult.Unsupported || result is PlaidLinkResult.Failed) {
                r.container.bridgeOperations.cancel(id,owner)
                markDrained(owner,id)
                clearPendingIf(id,owner)
                persistLinkOutcome(owner, when(result) {
                    PlaidLinkResult.Canceled -> ConnectionCoordinatorState.Canceled
                    PlaidLinkResult.Unsupported -> ConnectionCoordinatorState.Unsupported("unsupported")
                    is PlaidLinkResult.Failed -> ConnectionCoordinatorState.Failed("failed")
                    else -> error("unreachable")
                })
                r.changes.emit("accounts")
                return@withOwner
            }
            val success=result as PlaidLinkResult.Success
            val marker="rn_plaid_result_v1_${digest(success.publicToken)}"
            if(records.read(marker)!=null) return@withOwner // Ignore an old success without claiming a newer flow.
            var staged: com.lofuyu.borderledger.accounts.ConnectionOperation? = null
            val completed=r.container.bridgeOperations.completeExternal(id,owner) {
                check(ownerMatches(value))
                // Duplicate delivery to another native waiter must not mint a new exchange key.
                check(records.read(marker)==null)
                records.write(marker,id.encodeToByteArray())
                val pending=r.container.accountRepository.exchange(success.publicToken,id,value.getJSONObject("arguments").bridgeNullableString("reconnectConnectionId"))
                check(pending.state=="pending" && pending.pendingConnectionId!=null)
                staged=pending
                pending.operationId
            }
            markDrained(owner,id)
            clearPendingIf(id,owner)
            if (completed.status=="completed" && staged!=null) persistLinkOutcome(owner,ConnectionCoordinatorState.Pending(staged!!,staged!!.accounts))
            else persistLinkOutcome(owner,ConnectionCoordinatorState.Failed("failed"))
        }
        r.changes.emit("accounts")
    }

    suspend fun linkSnapshot(): Map<String,Any?> {
        val owner=r.ownerGeneration()
        val stored=records.read(LINK)?.let { JSONObject(it.decodeToString()) }?.takeIf { it.getString("owner")==owner }
        if(stored==null) return BridgePayloads.link(ConnectionCoordinatorState.Idle)
        return mapOf("state" to stored.getString("state"),"pendingConnectionId" to stored.bridgeNullableString("pendingConnectionId"),"connectionId" to stored.bridgeNullableString("connectionId"),
            "outcomeCode" to stored.bridgeNullableString("outcomeCode"),
            "accounts" to stored.getJSONArray("accounts").let { a -> (0 until a.length()).map { index -> val v=a.getJSONObject(index); mapOf("providerAccountId" to v.getString("providerAccountId"),"name" to v.getString("name"),"mask" to v.bridgeNullableString("mask"),"subtype" to v.bridgeNullableString("subtype"),"currency" to v.getString("currency"),"kind" to v.getString("kind")) } })
    }
    suspend fun clearLink() { records.delete(LINK) }

    private suspend fun ownerMatches(value: JSONObject): Boolean {
        return restoredOwnerFence.matches(value.getString("owner"))
    }
    private suspend fun pending()=records.read(PENDING)?.let { JSONObject(it.decodeToString()).also { v -> require(v.getInt("version")==1) } }
    private suspend fun clearPendingIf(id: String, owner: String) {
        val current=pending()
        if(current?.getString("operationId")==id && current.getString("owner")==owner) records.delete(PENDING)
    }
    private suspend fun markDrained(owner: String, id: String) {
        val key=drainedKey(owner)
        val value=records.read(key)?.let { JSONObject(it.decodeToString()) } ?: JSONObject()
        value.put(id, java.time.Instant.now().toString())
        records.write(key,value.toString().encodeToByteArray())
    }
    private suspend fun isDrained(owner: String, id: String): Boolean = records.read(drainedKey(owner))?.let { JSONObject(it.decodeToString()).has(id) } == true
    private suspend fun persistLinkOutcome(owner: String, state: ConnectionCoordinatorState) {
        val safe=BridgePayloads.link(state)
        records.write(LINK,JSONObject(safe).put("owner",owner).put("version",1).toString().encodeToByteArray())
    }
    private suspend fun nextRequestCode(): Int {
        val old=records.read(COUNTER)?.decodeToString()?.toInt() ?: 4096
        check(old < 65000) // Never reuse a callback identity, including after process recreation.
        val next=old+1; records.write(COUNTER,next.toString().encodeToByteArray()); return next
    }
    private fun digest(value: String)=MessageDigest.getInstance("SHA-256").digest(value.encodeToByteArray()).joinToString("") { "%02x".format(it) }
    companion object {
        private const val PENDING="rn_external_pending_v1"
        private const val LINK="rn_link_snapshot_v1"
        private const val COUNTER="rn_external_counter_v1"
        private fun drainedKey(owner: String)="rn_external_drained_v1_${MessageDigest.getInstance("SHA-256").digest(owner.encodeToByteArray()).joinToString("") { "%02x".format(it) }}"
    }
}

/** Android JSONObject represents JSON null as JSONObject.NULL, not Kotlin null. */
internal fun JSONObject.bridgeNullableString(key: String): String? =
    if (!has(key) || isNull(key) || opt(key) === JSONObject.NULL) null else optString(key).takeIf { it.isNotBlank() }
