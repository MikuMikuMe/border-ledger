package com.lofuyu.borderledger.react

import android.net.Uri
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.bank.ConnectionCoordinatorState
import com.lofuyu.borderledger.bank.PlaidLinkResult
import com.lofuyu.borderledger.exports.*
import com.lofuyu.borderledger.imports.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

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
    private val plaidCallbackMutex=Mutex()
    private val plaidPreProviderLaunchGate=PlaidPreProviderLaunchGate()
    private val plaidCallbacksInProgress=ConcurrentHashMap.newKeySet<String>()
    private val plaidReturnedFromProvider=ConcurrentHashMap.newKeySet<String>()
    private val activeDocumentPickerOperations=ConcurrentHashMap.newKeySet<String>()
    private val documentResultDelivered=AtomicBoolean(false)
    private val records get()=r.container.bridgeRecords
    private val plaidResultStore get()=PendingPlaidResultStore(records)
    private val plaidLaunchState get()=PlaidProviderLaunchState(records)
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
                require(kind in setOf("import_picker","export_picker","plaid"))
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
                val requestCode=nextRequestCode()
                val value=JSONObject().put("version",1).put("operationId",id).put("kind",kind).put("owner",owner).put("requestCode",requestCode).put("arguments",arguments)
                // Persist the recovery source before opening the operation journal:
                // process recreation can reconstruct an awaiting picker from here.
                records.write(PENDING,value.toString().encodeToByteArray())
                val op=try {
                    r.container.bridgeOperations.awaitExternal(id,kind,arguments.toString(),owner)
                } catch(error: Exception) {
                    clearPendingIf(id,owner)
                    throw error
                }
                if(op.operationId!=id) {
                    clearPendingIf(id,owner)
                    return@withLock BridgePayloads.operation(op)
                }
                if(kind=="plaid") persistLinkOutcome(owner,ConnectionCoordinatorState.Linking,id)
                var response=op
                when(kind) {
                    "import_picker", "export_picker" -> response=launchDocumentPicker(value,host) ?: op
                    "plaid" -> {
                        lateinit var job: Job
                        job=r.scope.launch(start=CoroutineStart.LAZY) {
                            try {
                                val result = r.withOwner(owner) {
                                    val link=r.container.accountRepository.createLinkToken(arguments.bridgeNullableString("reconnectConnectionId"))
                                    val linkToken=requireNotNull(link.linkToken)
                                    requireNotNull(r.host).launchPlaid(linkToken,id) {
                                        val mayOpen=plaidPreProviderLaunchGate.beginProviderLaunch(id,job) {
                                            plaidLaunchState.markStarted(owner,id)
                                        }
                                        if(!mayOpen) throw CancellationException("Plaid preparation was canceled before Link opened.")
                                    }
                                }
                                handlePlaid(result,id)
                            } catch(error: CancellationException) { throw error }
                            catch(_: Exception) {
                                runCatching {
                                    r.withOwner(owner) {
                                        settlePlaidLaunchFailure(owner,id)
                                    }
                                }
                            } finally {
                                plaidPreProviderLaunchGate.remove(id,job)
                            }
                        }
                        plaidPreProviderLaunchGate.register(id,job)
                        job.start()
                    }
                }
                BridgePayloads.operation(response)
            }
        }
    }

    suspend fun requestCode(id: String): Int = requireNotNull(pending()?.takeIf { it.getString("operationId")==id }).getInt("requestCode")

    fun noteDocumentResultReceived() { documentResultDelivered.set(true) }

    fun notePlaidCallbackReceived(operationId: String?) { operationId?.let(plaidCallbacksInProgress::add) }

    suspend fun noteActivityResumed() {
        val resultWasDelivered=documentResultDelivered.getAndSet(false)
        val original=pending() ?: return
        val owner=original.getString("owner")
        if(!restoredOwnerFence.matches(owner)) return
        var accountsChanged=false
        r.withOwner(owner) {
            mutex.withLock {
                val value=pending()?.takeIf {
                    it.getString("operationId")==original.getString("operationId") && it.getString("owner")==owner
                } ?: return@withLock
                when(value.getString("kind")) {
                    "import_picker", "export_picker" -> {
                        val id=value.getString("operationId")
                        val operation=r.container.bridgeOperations.query(id,owner)
                            ?: r.container.bridgeOperations.awaitExternal(id,value.getString("kind"),value.getJSONObject("arguments").toString(),owner)
                        if(operation.operationId!=id) {
                            clearPendingIf(id,owner)
                        } else if(DocumentPickerRecovery.shouldRelaunch(
                                value.getString("kind"),operation.status,
                                activeInProcess=id in activeDocumentPickerOperations,
                                resultDelivered=resultWasDelivered,
                            )) {
                            r.host?.let { launchDocumentPicker(value,it) }
                        }
                    }
                    "plaid" -> {
                        val id=value.getString("operationId")
                        if(plaidLaunchState.wasStarted(owner,id) &&
                            !plaidPreProviderLaunchGate.isPreparing(id) &&
                            id !in plaidCallbacksInProgress && plaidReturnedFromProvider.add(id)) {
                            accountsChanged=true
                        }
                    }
                }
            }
        }
        if(accountsChanged) r.changes.emit("accounts")
    }

    private suspend fun launchDocumentPicker(value: JSONObject, host: NativeServiceHost): BridgeOperation? {
        val id=value.getString("operationId")
        val owner=value.getString("owner")
        val kind=value.getString("kind")
        if(!activeDocumentPickerOperations.add(id)) return r.container.bridgeOperations.query(id,owner)
        try {
            when(kind) {
                "import_picker" -> host.launchImport(id)
                "export_picker" -> host.launchExport(id)
                else -> error("Unknown document picker")
            }
            return null
        } catch(error: CancellationException) {
            activeDocumentPickerOperations.remove(id)
            throw error
        } catch(_: Exception) {
            activeDocumentPickerOperations.remove(id)
            val operation=r.container.bridgeOperations.query(id,owner)
            if(operation?.status=="awaiting_result") {
                r.container.bridgeOperations.cancel(id,owner)
                markDrained(owner,id)
                clearPendingIf(id,owner)
                r.changes.emit("files")
            }
            return r.container.bridgeOperations.query(id,owner)
        }
    }

    suspend fun handleDocumentResult(uri: Uri?, accepted: Boolean) {
        val value=pending()?.takeIf { it.getString("kind")!="plaid" } ?: return
        val id=value.getString("operationId")
        activeDocumentPickerOperations.remove(id)
        try {
            if(!ownerMatches(value)) return
            val owner=value.getString("owner")
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
                                BridgeImportOperations.preview(r.container.importRepository,r.container.statementDocumentReader.read(requireNotNull(uri)),args.getString("accountId"),id)
                            }
                            "export_picker" -> {
                                val destination=requireNotNull(uri)
                                val request=LedgerExportRequest(ExportSelection.entries.first { it.wireValue==args.getString("selection") },
                                    LedgerExportFilters(args.bridgeNullableString("currency"),args.bridgeNullableString("startDate"),args.bridgeNullableString("endDate")))
                                val result=r.container.exportCoordinator.export(request, ContentResolverExportDestination(r.applicationContext.contentResolver,destination), if(args.getBoolean("share")) ExportHandoff.Share else ExportHandoff.Save)
                                check(result is ExportState.Completed)
                                if(args.getBoolean("share") && ownerMatches(value)) r.applicationContext.startActivity(r.container.exportCoordinator.createShareIntent(destination).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
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
        } finally {
            activeDocumentPickerOperations.remove(id)
            documentResultDelivered.set(false)
        }
    }

    suspend fun handlePlaid(result: PlaidLinkResult, operationId: String?=null) {
        // A callback without an Activity-restored identity is orphaned. Never
        // bind it to the currently pending operation: that operation may be a
        // newer flow created after cancellation or process recreation.
        if (operationId == null) return
        try {
        val persisted = plaidCallbackClaim.claim(operationId) ?: return
        val owner=persisted.getString("owner")
        // A recreated Activity can deliver the SDK result before onResume.
        // Restore the native session before entering the generation fence. If
        // restoration cannot validate the persisted owner, leave the handoff
        // pending for conservative recovery rather than canceling or rebinding it.
        plaidCallbackMutex.withLock {
            r.withOwner(owner) {
                val value=pending()?.takeIf {
                    it.getString("kind")=="plaid" &&
                        it.getString("owner")==owner &&
                        it.getString("operationId")==operationId
                } ?: return@withOwner
                val id=value.getString("operationId")
                if (hasFinalPlaidOutcome(owner,id)) {
                    markDrained(owner,id)
                    clearPendingIf(id,owner)
                    plaidResultStore.clear(owner,id)
                    plaidLaunchState.clear(owner,id)
                    return@withOwner
                }
                when(result) {
                    PlaidLinkResult.Canceled, PlaidLinkResult.Unsupported, is PlaidLinkResult.Failed -> {
                        when (r.container.bridgeOperations.query(id,owner)?.status) {
                            "awaiting_result" -> {
                                r.container.bridgeOperations.cancel(id,owner)
                                markDrained(owner,id)
                                clearPendingIf(id,owner)
                                plaidResultStore.clear(owner,id)
                                plaidLaunchState.clear(owner,id)
                                val outcome=when(result) {
                                    PlaidLinkResult.Canceled -> ConnectionCoordinatorState.Canceled
                                    PlaidLinkResult.Unsupported -> ConnectionCoordinatorState.Unsupported("unsupported")
                                    is PlaidLinkResult.Failed -> ConnectionCoordinatorState.Failed("failed")
                                }
                                persistLinkOutcome(owner,outcome,id)
                            }
                            "canceled" -> {
                                markDrained(owner,id)
                                clearPendingIf(id,owner)
                                plaidResultStore.clear(owner,id)
                                plaidLaunchState.clear(owner,id)
                                persistLinkOutcome(owner,ConnectionCoordinatorState.Canceled,id)
                            }
                            "failed_local" -> {
                                markDrained(owner,id)
                                clearPendingIf(id,owner)
                                plaidResultStore.clear(owner,id)
                                plaidLaunchState.clear(owner,id)
                                persistLinkOutcome(owner,ConnectionCoordinatorState.Failed("failed"),id)
                            }
                            "running" -> return@withOwner // The original exchange still owns the operation.
                            else -> {
                                val token=plaidResultStore.read(owner,id)
                                if (token!=null) processPlaidSuccess(value,owner,id,token)
                                else persistLinkOutcome(owner,ConnectionCoordinatorState.ReconciliationRequired,id)
                            }
                        }
                    }
                    is PlaidLinkResult.Success -> processPlaidSuccess(value,owner,id,result.publicToken)
                }
            }
        }
        r.changes.emit("accounts")
        } finally {
            plaidCallbacksInProgress.remove(operationId)
            plaidReturnedFromProvider.remove(operationId)
        }
    }

    /** Reconcile a token saved before exchange, after the Activity/session is restored. */
    suspend fun recoverPendingPlaidResult() {
        val value=pending()?.takeIf { it.getString("kind")=="plaid" } ?: return
        val id=value.getString("operationId")
        val owner=value.getString("owner")
        if (!restoredOwnerFence.matches(owner)) return
        val token=plaidResultStore.read(owner,id)
        if (token!=null) {
            handlePlaid(PlaidLinkResult.Success(token),id)
            return
        }
        val operation=r.container.bridgeOperations.query(id,owner)
        if (operation?.status=="reconciliation_required") {
            persistLinkOutcome(owner,ConnectionCoordinatorState.ReconciliationRequired,id)
            r.changes.emit("accounts")
        }
    }

    /** Cancel only a Plaid handoff whose provider exchange has not started. */
    suspend fun cancelPlaidConnect(operationId: String): Map<String, Any?> {
        val initial=pending()?.takeIf { it.getString("kind")=="plaid" && it.getString("operationId")==operationId }
            ?: throw BridgeFailure("not_found")
        val owner=initial.getString("owner")
        if(!ownerMatches(initial)) throw BridgeFailure("not_found")

        // This lock is the serialization point with the final callback immediately
        // before LinkKit opens. If cancellation wins, the canceled Job cannot open it.
        plaidPreProviderLaunchGate.cancelBeforeProviderLaunch(operationId)
        return plaidCallbackMutex.withLock {
            r.withOwner(owner) {
                mutex.withLock {
                    val value=pending()?.takeIf {
                        it.getString("kind")=="plaid" && it.getString("operationId")==operationId && it.getString("owner")==owner
                    } ?: throw BridgeFailure("not_found")
                    val journal=r.container.bridgeOperations
                    val current=journal.query(operationId,owner) ?: throw BridgeFailure("not_found")
                    val providerStarted=plaidLaunchState.wasStarted(owner,operationId)
                    val providerReturned=operationId in plaidReturnedFromProvider
                    val callbackInProgress=operationId in plaidCallbacksInProgress
                    val linkState=records.read(LINK)?.let { JSONObject(it.decodeToString()) }?.takeIf {
                        it.optString("owner")==owner && it.optString("operationId")==operationId
                    }?.optString("state").orEmpty()
                    if(!PlaidHandoffAvailability.canCancel(
                            linkState,current.status,providerStarted,providerReturned,callbackInProgress,
                        )) return@withLock BridgePayloads.operation(current)

                    val decision=PlaidHandoffCancellation(journal,plaidLaunchState)
                        .cancelBeforeSubmission(operationId,owner,providerHasReturned=providerReturned) ?: throw BridgeFailure("not_found")
                    when(decision) {
                        is PlaidCancellationDecision.Canceled -> {
                            markDrained(owner,operationId)
                            clearPendingIf(operationId,owner)
                            plaidResultStore.clear(owner,operationId)
                            plaidLaunchState.clear(owner,operationId)
                            plaidReturnedFromProvider.remove(operationId)
                            val outcome=if(decision.operation.status=="canceled") ConnectionCoordinatorState.Canceled
                                else ConnectionCoordinatorState.Failed("failed")
                            persistLinkOutcome(owner,outcome,operationId)
                        }
                        is PlaidCancellationDecision.Retained -> {
                            if(decision.operation.status in setOf("running","reconciliation_required","completed")) {
                                persistLinkOutcome(owner,ConnectionCoordinatorState.ReconciliationRequired,operationId)
                            }
                        }
                    }
                    r.changes.emit("accounts")
                    BridgePayloads.operation(decision.operation)
                }
            }
        }
    }

    private suspend fun processPlaidSuccess(value: JSONObject, owner: String, id: String, publicToken: String) {
        val marker="rn_plaid_result_v1_${digest(publicToken)}"
        val existingMarker=records.read(marker)?.decodeToString()
        if (existingMarker!=null && existingMarker!=id) {
            // Never bind a provider result already claimed by another operation
            // to this flow. If this operation provably has not submitted work,
            // terminate it locally; otherwise preserve the ambiguity.
            val operation=r.container.bridgeOperations.query(id,owner)
            if (operation?.status in setOf("awaiting_result","failed_local")) {
                r.container.bridgeOperations.cancel(id,owner)
                markDrained(owner,id)
                clearPendingIf(id,owner)
                plaidResultStore.clear(owner,id)
                plaidLaunchState.clear(owner,id)
                persistLinkOutcome(owner,ConnectionCoordinatorState.Failed("failed"),id)
            } else {
                persistLinkOutcome(owner,ConnectionCoordinatorState.ReconciliationRequired,id)
            }
            return
        }
        // Persist the encrypted callback result first. A crash between these
        // writes must leave enough information to resume the same operation.
        plaidResultStore.save(owner,id,publicToken)
        records.write(marker,id.encodeToByteArray())

        var staged: com.lofuyu.borderledger.accounts.ConnectionOperation? = null
        val reconnectId=value.getJSONObject("arguments").bridgeNullableString("reconnectConnectionId")
        suspend fun exchangeWithStableKey(): String {
            check(ownerMatches(value))
            val pending=r.container.accountRepository.exchange(publicToken,id,reconnectId)
            check(pending.state=="pending" && pending.pendingConnectionId!=null)
            staged=pending
            return pending.operationId
        }

        val previous=r.container.bridgeOperations.query(id,owner) ?: return
        val outcome=try {
            when(previous.status) {
                "awaiting_result" -> r.container.bridgeOperations.completeExternal(id,owner) { exchangeWithStableKey() }
                "running", "reconciliation_required" -> r.container.bridgeOperations.retryExternalWithSameIdempotency(id,owner) { exchangeWithStableKey() }
                // A process may stop after the durable local receipt but before the account snapshot.
                // The Worker returns its stored exchange receipt for this same owner/key without re-exchanging Plaid.
                "completed" -> {
                    exchangeWithStableKey()
                    previous
                }
                else -> previous
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            r.container.bridgeOperations.query(id,owner)
        } ?: return

        if (outcome.status=="running" && staged==null) return
        if (outcome.status=="completed" && staged!=null) {
            val pending=requireNotNull(staged)
            persistLinkOutcome(owner,ConnectionCoordinatorState.Pending(pending,pending.accounts),id)
            markDrained(owner,id)
            clearPendingIf(id,owner)
            plaidResultStore.clear(owner,id)
            plaidLaunchState.clear(owner,id)
        } else if (outcome.status=="failed_local") {
            markDrained(owner,id)
            clearPendingIf(id,owner)
            plaidResultStore.clear(owner,id)
            plaidLaunchState.clear(owner,id)
            persistLinkOutcome(owner,ConnectionCoordinatorState.Failed("failed"),id)
        } else {
            // Keep the encrypted provider result and pending operation so the same backend
            // idempotency key can be reconciled on the next native resume. Never mint a new key.
            persistLinkOutcome(owner,ConnectionCoordinatorState.ReconciliationRequired,id)
        }
    }

    /**
     * A failed LinkKit handoff may happen after the exchange has already been
     * submitted. Only an operation that the journal proves is still awaiting
     * its callback can be canceled and drained; ambiguous work stays recoverable.
     */
    private suspend fun settlePlaidLaunchFailure(owner: String, id: String) {
        if (hasFinalPlaidOutcome(owner,id)) {
            markDrained(owner,id)
            clearPendingIf(id,owner)
            plaidResultStore.clear(owner,id)
            plaidLaunchState.clear(owner,id)
            return
        }
        val operation=r.container.bridgeOperations.cancel(id,owner)
        when (operation?.status) {
            "canceled", "failed_local" -> {
                markDrained(owner,id)
                clearPendingIf(id,owner)
                plaidResultStore.clear(owner,id)
                plaidLaunchState.clear(owner,id)
                persistLinkOutcome(owner,ConnectionCoordinatorState.Failed("failed"),id)
            }
            "running", "reconciliation_required", "completed" -> {
                // Never erase a submitted exchange because a later Activity or
                // callback step threw. The encrypted result and original key are
                // retained for resume reconciliation.
                persistLinkOutcome(owner,ConnectionCoordinatorState.ReconciliationRequired,id)
            }
            else -> return
        }
        r.changes.emit("accounts")
    }

    private suspend fun hasFinalPlaidOutcome(owner: String, operationId: String): Boolean =
        records.read(LINK)?.let { JSONObject(it.decodeToString()) }?.let { value ->
            value.optString("owner")==owner && value.optString("operationId")==operationId &&
                value.optString("state") !in setOf("linking","reconciliation_required")
        } == true

    suspend fun linkSnapshot(): Map<String,Any?> {
        val owner=r.ownerGeneration()
        val stored=records.read(LINK)?.let { JSONObject(it.decodeToString()) }?.takeIf { it.getString("owner")==owner }
        if(stored==null) return BridgePayloads.link(ConnectionCoordinatorState.Idle)
        val operationId=stored.bridgeNullableString("operationId")
        val operation=operationId?.let { r.container.bridgeOperations.query(it,owner) }
        val providerLaunchStarted=operationId?.let { plaidLaunchState.wasStarted(owner,it) } ?: false
        val canCancel=operation?.kind=="plaid" && PlaidHandoffAvailability.canCancel(
            stored.getString("state"),operation.status,providerLaunchStarted,
            operationId?.let(plaidReturnedFromProvider::contains) ?: false,
            operationId?.let(plaidCallbacksInProgress::contains) ?: false,
        )
        return mapOf("state" to stored.getString("state"),"pendingConnectionId" to stored.bridgeNullableString("pendingConnectionId"),"connectionId" to stored.bridgeNullableString("connectionId"),
            "operationId" to operationId,"canCancel" to canCancel,
            "outcomeCode" to stored.bridgeNullableString("outcomeCode"),
            "accounts" to stored.getJSONArray("accounts").let { a -> (0 until a.length()).map { index -> val v=a.getJSONObject(index); mapOf("providerAccountId" to v.getString("providerAccountId"),"name" to v.getString("name"),"mask" to v.bridgeNullableString("mask"),"subtype" to v.bridgeNullableString("subtype"),"currency" to v.getString("currency"),"kind" to v.getString("kind")) } })
    }
    suspend fun clearLink() { records.delete(LINK) }

    suspend fun clearPlaidResultForOwner(owner: String) {
        val value=pending()?.takeIf { it.getString("kind")=="plaid" && it.getString("owner")==owner } ?: return
        val id=value.getString("operationId")
        plaidResultStore.clear(owner,id)
        plaidLaunchState.clear(owner,id)
    }

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
    private suspend fun persistLinkOutcome(owner: String, state: ConnectionCoordinatorState, operationId: String?=null) {
        val safe=BridgePayloads.link(state)
        val stored=JSONObject(safe).put("owner",owner).put("version",1)
        operationId?.let { stored.put("operationId",it) }
        records.write(LINK,stored.toString().encodeToByteArray())
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
