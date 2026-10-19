package com.lofuyu.borderledger.react

import android.net.Uri
import com.lofuyu.borderledger.accounts.ConnectionId
import com.lofuyu.borderledger.accounts.ExchangeRequest
import com.lofuyu.borderledger.accounts.IdempotencyKey
import com.lofuyu.borderledger.accounts.LinkTokenRequest
import com.lofuyu.borderledger.accounts.ProviderPublicToken
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

/** JS-facing identity for an external handoff; owner and host are native-only. */
data class ExternalStartRequest(
    val id: String,
    val kind: String,
    val arguments: JSONObject,
)

private data class HandoffContext(
    val value: JSONObject,
    val key: BridgeOperationKey,
) {
    val id: String get() = key.id
    val owner: String get() = key.owner
}

private data class ImportPreviewRequest(
    val accountId: String,
    val operationKey: BridgeOperationKey,
    val uri: Uri,
)

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

    suspend fun start(request: ExternalStartRequest): Map<String,Any?> {
        val owner = r.ownerGeneration()
        return r.withOwner(owner) {
            mutex.withLock {
                startLocked(
                    OwnedExternalStartRequest(
                        request.id,
                        request.kind,
                        request.arguments,
                        owner,
                        requireNotNull(r.host),
                    ),
                )
            }
        }
    }

    private suspend fun startLocked(request: OwnedExternalStartRequest): Map<String, Any?> {
        val existing = r.container.bridgeOperations.query(BridgeOperationKey(request.id, request.owner))
        if (existing != null) {
            return BridgePayloads.operation(
                r.container.bridgeOperations.awaitExternal(
                    BridgeOperationRequest(
                        request.id,
                        request.kind,
                        request.arguments.toString(),
                        request.owner,
                    ),
                ),
            )
        }
        require(request.kind in EXTERNAL_KINDS)
        val value = persistPendingRequest(request)
        val operation = try {
            r.container.bridgeOperations.awaitExternal(
                BridgeOperationRequest(
                    request.id,
                    request.kind,
                    request.arguments.toString(),
                    request.owner,
                ),
            )
        } catch (error: Exception) {
            clearPendingIf(BridgeOperationKey(request.id, request.owner))
            throw error
        }
        if (operation.operationId != request.id) {
            clearPendingIf(BridgeOperationKey(request.id, request.owner))
            return BridgePayloads.operation(operation)
        }
        if (request.kind == "plaid") {
            persistLinkOutcome(request.owner, ConnectionCoordinatorState.Linking, request.id)
        }
        return BridgePayloads.operation(launchExternal(value, request.host, request.owner, operation))
    }

    private suspend fun persistPendingRequest(request: OwnedExternalStartRequest): JSONObject {
        pending()?.let { previous ->
            val previousOwner = previous.getString("owner")
            val previousId = previous.getString("operationId")
            if (previousOwner == request.owner) {
                // Submitted handoffs require a drained callback. A proven
                // local import rejection sent nothing and can be replaced even
                // if the process died before writing its drained marker.
                val previousKey = BridgeOperationKey(previousId, request.owner)
                val status = r.container.bridgeOperations.query(previousKey)?.status
                val localRejection = BridgeImportOperations.canReplaceUndrainedPicker(previous.getString("kind"), status)
                check(localRejection || isDrained(previousKey)) {
                    "external handoff is still owned by a prior callback"
                }
            }
            records.delete(PENDING)
        }
        val value = JSONObject()
            .put("version", 1)
            .put("operationId", request.id)
            .put("kind", request.kind)
            .put("owner", request.owner)
            .put("requestCode", nextRequestCode())
            .put("arguments", request.arguments)
        // Persist the recovery source before opening the operation journal:
        // process recreation can reconstruct an awaiting picker from here.
        records.write(PENDING, value.toString().encodeToByteArray())
        return value
    }

    private data class OwnedExternalStartRequest(
        val id: String,
        val kind: String,
        val arguments: JSONObject,
        val owner: String,
        val host: NativeServiceHost,
    )

    private suspend fun launchExternal(
        value: JSONObject,
        host: NativeServiceHost,
        owner: String,
        operation: BridgeOperation,
    ): BridgeOperation = when (value.getString("kind")) {
        "import_picker", "export_picker" -> launchDocumentPicker(value, host) ?: operation
        "plaid" -> {
            launchPlaid(value, BridgeOperationKey(value.getString("operationId"), owner))
            operation
        }
        else -> error("Unknown external handoff")
    }

    private suspend fun launchPlaid(value: JSONObject, key: BridgeOperationKey) {
        val id = key.id
        val arguments = value.getJSONObject("arguments")
        lateinit var job: Job
        job = r.scope.launch(start = CoroutineStart.LAZY) {
            try {
                val result = r.withOwner(key.owner) {
                    val reconnectId = arguments.bridgeNullableString("reconnectConnectionId")?.let(::ConnectionId)
                    val link = r.container.accountRepository.createLinkToken(LinkTokenRequest(reconnectId))
                    val linkToken = requireNotNull(link.linkToken)
                    requireNotNull(r.host).launchPlaid(linkToken, id) {
                        val mayOpen = plaidPreProviderLaunchGate.beginProviderLaunch(id, job) {
                            plaidLaunchState.markStarted(key.owner, id)
                        }
                        if (!mayOpen) throw CancellationException("Plaid preparation was canceled before Link opened.")
                    }
                }
                handlePlaid(result, id)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                runCatching { r.withOwner(key.owner) { settlePlaidLaunchFailure(key) } }
            } finally {
                plaidPreProviderLaunchGate.remove(id, job)
            }
        }
        plaidPreProviderLaunchGate.register(id, job)
        job.start()
    }

    suspend fun requestCode(id: String): Int = requireNotNull(pending()?.takeIf { it.getString("operationId")==id }).getInt("requestCode")

    fun noteDocumentResultReceived() { documentResultDelivered.set(true) }

    fun notePlaidCallbackReceived(operationId: String?) { operationId?.let(plaidCallbacksInProgress::add) }

    suspend fun noteActivityResumed() {
        val resultWasDelivered = documentResultDelivered.getAndSet(false)
        val original = pending() ?: return
        val owner = original.getString("owner")
        if (!restoredOwnerFence.matches(owner)) return
        val accountsChanged = r.withOwner(owner) {
            mutex.withLock { resumePending(original, owner, resultWasDelivered) }
        }
        if(accountsChanged) r.changes.emit("accounts")
    }

    private suspend fun resumePending(original: JSONObject, owner: String, resultDelivered: Boolean): Boolean {
        val value = pending()?.takeIf { isSamePending(it, original, owner) } ?: return false
        return when (value.getString("kind")) {
            "import_picker", "export_picker" -> {
                resumeDocumentPicker(value, resultDelivered)
                false
            }
            "plaid" -> markPlaidReturned(BridgeOperationKey(value.getString("operationId"), owner))
            else -> false
        }
    }

    private fun isSamePending(value: JSONObject, original: JSONObject, owner: String): Boolean =
        value.getString("operationId") == original.getString("operationId") && value.getString("owner") == owner

    private suspend fun resumeDocumentPicker(value: JSONObject, resultDelivered: Boolean) {
        val key = BridgeOperationKey(value.getString("operationId"), value.getString("owner"))
        val operation = r.container.bridgeOperations.query(key)
            ?: r.container.bridgeOperations.awaitExternal(
                BridgeOperationRequest(key.id, value.getString("kind"), value.getJSONObject("arguments").toString(), key.owner),
            )
        if (operation.operationId != key.id) {
            clearPendingIf(key)
            return
        }
        if (DocumentPickerRecovery.shouldRelaunch(
                value.getString("kind"), operation.status,
                activeInProcess = key.id in activeDocumentPickerOperations,
                resultDelivered = resultDelivered,
            )) {
            r.host?.let { launchDocumentPicker(value, it) }
        }
    }

    private suspend fun markPlaidReturned(key: BridgeOperationKey): Boolean {
        if (!plaidLaunchState.wasStarted(key.owner, key.id)) return false
        if (plaidPreProviderLaunchGate.isPreparing(key.id)) return false
        if (key.id in plaidCallbacksInProgress) return false
        return plaidReturnedFromProvider.add(key.id)
    }

    private suspend fun launchDocumentPicker(value: JSONObject, host: NativeServiceHost): BridgeOperation? {
        val key = BridgeOperationKey(value.getString("operationId"), value.getString("owner"))
        val kind=value.getString("kind")
        if(!activeDocumentPickerOperations.add(key.id)) return r.container.bridgeOperations.query(key)
        try {
            when(kind) {
                "import_picker" -> host.launchImport(key.id)
                "export_picker" -> host.launchExport(key.id)
                else -> error("Unknown document picker")
            }
            return null
        } catch(error: CancellationException) {
            activeDocumentPickerOperations.remove(key.id)
            throw error
        } catch(_: Exception) {
            activeDocumentPickerOperations.remove(key.id)
            val operation=r.container.bridgeOperations.query(key)
            if(operation?.status=="awaiting_result") {
                r.container.bridgeOperations.cancel(key)
                markDrained(key)
                clearPendingIf(key)
                r.changes.emit("files")
            }
            return r.container.bridgeOperations.query(key)
        }
    }

    suspend fun handleDocumentResult(uri: Uri?, accepted: Boolean) {
        val value = pending()?.takeIf { it.getString("kind") != "plaid" } ?: return
        val key = BridgeOperationKey(value.getString("operationId"), value.getString("owner"))
        activeDocumentPickerOperations.remove(key.id)
        try {
            if (!ownerMatches(value)) return
            r.withOwner(key.owner) {
                if (!accepted || uri == null) cancelDocument(key)
                else completeDocument(HandoffContext(value, key), uri)
            }
            r.changes.emit("files")
        } finally {
            activeDocumentPickerOperations.remove(key.id)
            documentResultDelivered.set(false)
        }
    }

    private suspend fun cancelDocument(key: BridgeOperationKey) {
        r.container.bridgeOperations.cancel(key)
        markDrained(key)
        clearPendingIf(key)
        r.changes.emit("files")
    }

    private suspend fun completeDocument(handoff: HandoffContext, uri: Uri) {
        r.container.bridgeOperations.completeExternal(handoff.key) {
            check(ownerMatches(handoff.value))
            r.withFiles(handoff.owner) { processDocument(handoff, uri) }
        }
        markDrained(handoff.key)
        clearPendingIf(handoff.key)
    }

    private suspend fun processDocument(handoff: HandoffContext, uri: Uri): String {
        val args = handoff.value.getJSONObject("arguments")
        return when (handoff.value.getString("kind")) {
            "import_picker" -> previewImport(ImportPreviewRequest(args.getString("accountId"), handoff.key, uri))
            "export_picker" -> exportLedger(handoff, args, uri)
            else -> error("Unknown handoff")
        }
    }

    private suspend fun previewImport(request: ImportPreviewRequest): String =
        BridgeImportOperations.preview(
            r.container.importRepository,
            r.container.statementDocumentReader.read(request.uri),
            request.accountId,
            request.operationKey.id,
        )

    private suspend fun exportLedger(handoff: HandoffContext, args: JSONObject, destination: Uri): String {
        val request = LedgerExportRequest(
            ExportSelection.entries.first { it.wireValue == args.getString("selection") },
            LedgerExportFilters(
                args.bridgeNullableString("currency"),
                args.bridgeNullableString("startDate"),
                args.bridgeNullableString("endDate"),
            ),
        )
        val share = args.getBoolean("share")
        val result = r.container.exportCoordinator.export(
            request,
            ContentResolverExportDestination(r.applicationContext.contentResolver, destination),
            if (share) ExportHandoff.Share else ExportHandoff.Save,
        )
        val receipt = BridgeExportOperations.requireReceipt(result)
        if (share && ownerMatches(handoff.value)) {
            r.applicationContext.startActivity(
                r.container.exportCoordinator.createShareIntent(destination)
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
        return receipt.receiptId
    }

    suspend fun handlePlaid(result: PlaidLinkResult, operationId: String?=null) {
        // A callback without an Activity-restored identity is orphaned. Never
        // bind it to the currently pending operation: that operation may be a
        // newer flow created after cancellation or process recreation.
        if (operationId == null) return
        try {
            val persisted = plaidCallbackClaim.claim(operationId) ?: return
            val owner = persisted.getString("owner")
            // A recreated Activity can deliver the SDK result before onResume.
            // Restore the native session before entering the generation fence. If
            // restoration cannot validate the persisted owner, leave the handoff
            // pending for conservative recovery rather than canceling or rebinding it.
            plaidCallbackMutex.withLock {
                r.withOwner(owner) {
                    val value = pending()?.takeIf { isPlaidPending(it, owner, operationId) } ?: return@withOwner
                    val key = BridgeOperationKey(value.getString("operationId"), owner)
                    val handoff = HandoffContext(value, key)
                    if (hasFinalPlaidOutcome(key)) {
                        clearPlaidHandoff(key)
                        return@withOwner
                    }
                    processPlaidCallback(handoff, result)
                }
            }
            r.changes.emit("accounts")
        } finally {
            plaidCallbacksInProgress.remove(operationId)
            plaidReturnedFromProvider.remove(operationId)
        }
    }

    private fun isPlaidPending(value: JSONObject, owner: String, operationId: String): Boolean =
        value.getString("kind") == "plaid" && value.getString("owner") == owner && value.getString("operationId") == operationId

    private suspend fun processPlaidCallback(handoff: HandoffContext, result: PlaidLinkResult) {
        when (result) {
            is PlaidLinkResult.Success -> processPlaidSuccess(handoff, ProviderPublicToken(result.publicToken))
            else -> processPlaidExit(handoff, result)
        }
    }

    private suspend fun processPlaidExit(handoff: HandoffContext, result: PlaidLinkResult) {
        when (r.container.bridgeOperations.query(handoff.key)?.status) {
            "awaiting_result" -> {
                r.container.bridgeOperations.cancel(handoff.key)
                clearPlaidHandoff(handoff.key)
                persistLinkOutcome(handoff.owner, plaidOutcome(result), handoff.id)
            }
            "canceled" -> {
                clearPlaidHandoff(handoff.key)
                persistLinkOutcome(handoff.owner, ConnectionCoordinatorState.Canceled, handoff.id)
            }
            "failed_local" -> {
                clearPlaidHandoff(handoff.key)
                persistLinkOutcome(handoff.owner, ConnectionCoordinatorState.Failed("failed"), handoff.id)
            }
            "running" -> Unit // The original exchange still owns the operation.
            else -> {
                val token = plaidResultStore.read(handoff.owner, handoff.id)
                if (token != null) processPlaidSuccess(handoff, ProviderPublicToken(token))
                else persistLinkOutcome(handoff.owner, ConnectionCoordinatorState.ReconciliationRequired, handoff.id)
            }
        }
    }

    private fun plaidOutcome(result: PlaidLinkResult): ConnectionCoordinatorState = when (result) {
        PlaidLinkResult.Canceled -> ConnectionCoordinatorState.Canceled
        PlaidLinkResult.Unsupported -> ConnectionCoordinatorState.Unsupported("unsupported")
        is PlaidLinkResult.Failed -> ConnectionCoordinatorState.Failed("failed")
        is PlaidLinkResult.Success -> error("Successful Plaid results are processed separately")
    }

    private suspend fun clearPlaidHandoff(key: BridgeOperationKey) {
        markDrained(key)
        clearPendingIf(key)
        plaidResultStore.clear(key.owner, key.id)
        plaidLaunchState.clear(key.owner, key.id)
    }

    /** Reconcile a token saved before exchange, after the Activity/session is restored. */
    suspend fun recoverPendingPlaidResult() {
        val value=pending()?.takeIf { it.getString("kind")=="plaid" } ?: return
        val key = BridgeOperationKey(value.getString("operationId"), value.getString("owner"))
        if (!restoredOwnerFence.matches(key.owner)) return
        val token=plaidResultStore.read(key.owner, key.id)
        if (token!=null) {
            handlePlaid(PlaidLinkResult.Success(token), key.id)
            return
        }
        val operation=r.container.bridgeOperations.query(key)
        if (operation?.status=="reconciliation_required") {
            persistLinkOutcome(key.owner,ConnectionCoordinatorState.ReconciliationRequired,key.id)
            r.changes.emit("accounts")
        }
    }

    /** Cancel only a Plaid handoff whose provider exchange has not started. */
    suspend fun cancelPlaidConnect(operationId: String): Map<String, Any?> {
        val initial = pending()?.takeIf { it.getString("kind") == "plaid" && it.getString("operationId") == operationId }
            ?: throw BridgeFailure("not_found")
        val key = BridgeOperationKey(operationId, initial.getString("owner"))
        if (!ownerMatches(initial)) throw BridgeFailure("not_found")

        // This lock is the serialization point with the final callback immediately
        // before LinkKit opens. If cancellation wins, the canceled Job cannot open it.
        plaidPreProviderLaunchGate.cancelBeforeProviderLaunch(key.id)
        return plaidCallbackMutex.withLock {
            r.withOwner(key.owner) { cancelPlaidLocked(key) }
        }
    }

    private suspend fun cancelPlaidLocked(key: BridgeOperationKey): Map<String, Any?> = mutex.withLock {
        val value = pending()?.takeIf { isPlaidPending(it, key.owner, key.id) } ?: throw BridgeFailure("not_found")
        val journal = r.container.bridgeOperations
        val current = journal.query(key) ?: throw BridgeFailure("not_found")
        val context = plaidCancelContext(key, current)
        if (!PlaidHandoffAvailability.canCancel(context)) return@withLock BridgePayloads.operation(current)
        val decision = PlaidHandoffCancellation(journal, plaidLaunchState)
            .cancelBeforeSubmission(key.id, key.owner, providerHasReturned = context.providerReturned)
            ?: throw BridgeFailure("not_found")
        applyCancellationDecision(decision, key)
        r.changes.emit("accounts")
        BridgePayloads.operation(decision.operation)
    }

    private suspend fun plaidCancelContext(key: BridgeOperationKey, operation: BridgeOperation): PlaidHandoffState {
        val stored = records.read(LINK)?.let { JSONObject(it.decodeToString()) }?.takeIf {
            it.optString("owner") == key.owner && it.optString("operationId") == key.id
        }
        return PlaidHandoffState(
            state = stored?.optString("state").orEmpty(),
            operationStatus = operation.status,
            providerMayBeOpen = plaidLaunchState.wasStarted(key.owner, key.id),
            providerReturned = key.id in plaidReturnedFromProvider,
            callbackInProgress = key.id in plaidCallbacksInProgress,
        )
    }

    private suspend fun applyCancellationDecision(
        decision: PlaidCancellationDecision,
        key: BridgeOperationKey,
    ) {
        when (decision) {
            is PlaidCancellationDecision.Canceled -> {
                clearPlaidHandoff(key)
                plaidReturnedFromProvider.remove(key.id)
                val outcome = if (decision.operation.status == "canceled") {
                    ConnectionCoordinatorState.Canceled
                } else {
                    ConnectionCoordinatorState.Failed("failed")
                }
                persistLinkOutcome(key.owner, outcome, key.id)
            }
            is PlaidCancellationDecision.Retained -> {
                if (decision.operation.status in SUBMITTED_STATUSES) {
                    persistLinkOutcome(key.owner, ConnectionCoordinatorState.ReconciliationRequired, key.id)
                }
            }
        }
    }

    private suspend fun processPlaidSuccess(handoff: HandoffContext, publicToken: ProviderPublicToken) {
        val marker = "rn_plaid_result_v1_${digest(publicToken.value)}"
        val existingMarker = records.read(marker)?.decodeToString()
        if (existingMarker != null && existingMarker != handoff.id) {
            resolveDuplicatePlaidToken(handoff.key)
            return
        }
        // Persist the encrypted callback result first. A crash between these
        // writes must leave enough information to resume the same operation.
        plaidResultStore.save(handoff.owner, handoff.id, publicToken.value)
        records.write(marker, handoff.id.encodeToByteArray())
        val exchange = exchangePlaid(handoff, publicToken) ?: return
        finalizePlaidExchange(handoff.key, exchange)
    }

    private suspend fun resolveDuplicatePlaidToken(key: BridgeOperationKey) {
        // Never bind a provider result already claimed by another operation
        // to this flow. If this operation provably has not submitted work,
        // terminate it locally; otherwise preserve the ambiguity.
        val operation = r.container.bridgeOperations.query(key)
        if (operation?.status in setOf("awaiting_result", "failed_local")) {
            r.container.bridgeOperations.cancel(key)
            clearPlaidHandoff(key)
            persistLinkOutcome(key.owner, ConnectionCoordinatorState.Failed("failed"), key.id)
        } else {
            persistLinkOutcome(key.owner, ConnectionCoordinatorState.ReconciliationRequired, key.id)
        }
    }

    private suspend fun exchangePlaid(
        handoff: HandoffContext,
        publicToken: ProviderPublicToken,
    ): PlaidExchangeResult? {
        var staged: com.lofuyu.borderledger.accounts.ConnectionOperation? = null
        val reconnectId = handoff.value.getJSONObject("arguments").bridgeNullableString("reconnectConnectionId")
        suspend fun exchangeWithStableKey(): String {
            check(ownerMatches(handoff.value))
            val pending = r.container.accountRepository.exchange(
                ExchangeRequest(
                    publicToken = publicToken,
                    idempotencyKey = IdempotencyKey(handoff.id),
                    reconnectConnectionId = reconnectId?.let(::ConnectionId),
                ),
            )
            check(pending.state == "pending" && pending.pendingConnectionId != null)
            staged = pending
            return pending.operationId
        }
        val previous = r.container.bridgeOperations.query(handoff.key) ?: return null
        val outcome = try {
            when (previous.status) {
                "awaiting_result" -> r.container.bridgeOperations.completeExternal(handoff.key) { exchangeWithStableKey() }
                "running", "reconciliation_required" -> r.container.bridgeOperations.retryExternalWithSameIdempotency(handoff.key) { exchangeWithStableKey() }
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
            r.container.bridgeOperations.query(handoff.key)
        } ?: return null
        return PlaidExchangeResult(outcome, staged)
    }

    private suspend fun finalizePlaidExchange(key: BridgeOperationKey, exchange: PlaidExchangeResult) {
        val outcome = exchange.operation
        val staged = exchange.staged
        when {
            outcome.status == "running" && staged == null -> Unit
            outcome.status == "completed" && staged != null -> {
                val pending = requireNotNull(staged)
                persistLinkOutcome(key.owner, ConnectionCoordinatorState.Pending(pending, pending.accounts), key.id)
                clearPlaidHandoff(key)
            }
            outcome.status == "failed_local" -> {
                clearPlaidHandoff(key)
                persistLinkOutcome(key.owner, ConnectionCoordinatorState.Failed("failed"), key.id)
            }
            else -> {
                // Keep the encrypted provider result and pending operation so the same backend
                // idempotency key can be reconciled on the next native resume. Never mint a new key.
                persistLinkOutcome(key.owner, ConnectionCoordinatorState.ReconciliationRequired, key.id)
            }
        }
    }

    private data class PlaidExchangeResult(
        val operation: BridgeOperation,
        val staged: com.lofuyu.borderledger.accounts.ConnectionOperation?,
    )

    /**
     * A failed LinkKit handoff may happen after the exchange has already been
     * submitted. Only an operation that the journal proves is still awaiting
     * its callback can be canceled and drained; ambiguous work stays recoverable.
     */
    private suspend fun settlePlaidLaunchFailure(key: BridgeOperationKey) {
        if (hasFinalPlaidOutcome(key)) {
            clearPlaidHandoff(key)
            return
        }
        val operation=r.container.bridgeOperations.cancel(key)
        when (operation?.status) {
            "canceled", "failed_local" -> {
                clearPlaidHandoff(key)
                persistLinkOutcome(key.owner,ConnectionCoordinatorState.Failed("failed"),key.id)
            }
            "running", "reconciliation_required", "completed" -> {
                // Never erase a submitted exchange because a later Activity or
                // callback step threw. The encrypted result and original key are
                // retained for resume reconciliation.
                persistLinkOutcome(key.owner,ConnectionCoordinatorState.ReconciliationRequired,key.id)
            }
            else -> return
        }
        r.changes.emit("accounts")
    }

    private suspend fun hasFinalPlaidOutcome(key: BridgeOperationKey): Boolean {
        val value = records.read(LINK)?.let { JSONObject(it.decodeToString()) } ?: return false
        return isFinalPlaidOutcome(value, key)
    }

    private fun isFinalPlaidOutcome(value: JSONObject, key: BridgeOperationKey): Boolean {
        if (value.optString("owner") != key.owner) return false
        if (value.optString("operationId") != key.id) return false
        return value.optString("state") !in setOf("linking", "reconciliation_required")
    }

    suspend fun linkSnapshot(): Map<String,Any?> {
        val owner=r.ownerGeneration()
        val stored=records.read(LINK)?.let { JSONObject(it.decodeToString()) }?.takeIf { it.getString("owner")==owner }
        if(stored==null) return BridgePayloads.link(ConnectionCoordinatorState.Idle)
        val operationId=stored.bridgeNullableString("operationId")
        val operation=operationId?.let { r.container.bridgeOperations.query(BridgeOperationKey(it, owner)) }
        val providerLaunchStarted=operationId?.let { plaidLaunchState.wasStarted(owner,it) } ?: false
        val canCancel = operation?.kind == "plaid" && PlaidHandoffAvailability.canCancel(
            PlaidHandoffState(
                state = stored.getString("state"),
                operationStatus = operation.status,
                providerMayBeOpen = providerLaunchStarted,
                providerReturned = operationId?.let(plaidReturnedFromProvider::contains) ?: false,
                callbackInProgress = operationId?.let(plaidCallbacksInProgress::contains) ?: false,
            ),
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
    private suspend fun clearPendingIf(key: BridgeOperationKey) {
        val current=pending()
        if(current?.getString("operationId")==key.id && current.getString("owner")==key.owner) records.delete(PENDING)
    }
    private suspend fun markDrained(operationKey: BridgeOperationKey) {
        val recordKey=drainedKey(operationKey.owner)
        val value=records.read(recordKey)?.let { JSONObject(it.decodeToString()) } ?: JSONObject()
        value.put(operationKey.id, java.time.Instant.now().toString())
        records.write(recordKey,value.toString().encodeToByteArray())
    }
    private suspend fun isDrained(operationKey: BridgeOperationKey): Boolean =
        records.read(drainedKey(operationKey.owner))?.let { JSONObject(it.decodeToString()).has(operationKey.id) } == true
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
        private val EXTERNAL_KINDS = setOf("import_picker", "export_picker", "plaid")
        private val SUBMITTED_STATUSES = setOf("running", "reconciliation_required", "completed")
        private const val PENDING="rn_external_pending_v1"
        private const val LINK="rn_link_snapshot_v1"
        private const val COUNTER="rn_external_counter_v1"
        private fun drainedKey(owner: String)="rn_external_drained_v1_${MessageDigest.getInstance("SHA-256").digest(owner.encodeToByteArray()).joinToString("") { "%02x".format(it) }}"
    }
}

/** Android JSONObject represents JSON null as JSONObject.NULL, not Kotlin null. */
internal fun JSONObject.bridgeNullableString(key: String): String? =
    if (!has(key) || isNull(key)) null else opt(key)
        ?.takeUnless { it === JSONObject.NULL }
        ?.let { optString(key).takeIf(String::isNotBlank) }
