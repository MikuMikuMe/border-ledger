package com.lofuyu.borderledger.react

import com.facebook.react.bridge.*
import com.lofuyu.borderledger.react.codegen.*
import com.lofuyu.borderledger.imports.*
import com.lofuyu.borderledger.exports.*
import com.lofuyu.borderledger.accounts.AccountPageRequest
import com.lofuyu.borderledger.accounts.AccountSelectionRequest
import com.lofuyu.borderledger.accounts.AccountCursor
import com.lofuyu.borderledger.accounts.ConnectionId
import com.lofuyu.borderledger.accounts.DisconnectRequest
import com.lofuyu.borderledger.accounts.IdempotencyKey
import com.lofuyu.borderledger.accounts.PendingCancellationRequest
import com.lofuyu.borderledger.accounts.ProviderAccountId
import com.lofuyu.borderledger.accounts.SyncRequest
import org.json.JSONObject

class AccountsModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeAccountsSpec(context) {
    private val s=BridgeSupport(r)
    override fun initialize() { super.initialize(); s.observeSuspending("accounts") { val snapshot=r.external.linkSnapshot(); if(r.container.ownerSessionManager.state.value is com.lofuyu.borderledger.auth.OwnerSessionState.SignedIn) emitOnStateChanged(BridgeSupport.map(snapshot)) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise)=s.call(p) { r.external.linkSnapshot() }
    override fun readAccounts(v: ReadableMap, p: Promise)=s.call(p) {
        val limit = v.integer("limit")
        require(limit in 1..100)
        BridgePayloads.accountPage(r.container.accountRepository.listAccounts(AccountPageRequest(v.text("cursor")?.let(::AccountCursor), limit)))
    }
    override fun readConnections(p: Promise)=s.call(p) { r.container.accountRepository.listConnections().map(BridgePayloads::connection) }
    override fun startConnect(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        r.external.start(ExternalStartRequest(op,"plaid",JSONObject().put("reconnectConnectionId",v.text("reconnectConnectionId") ?: JSONObject.NULL)))
    }
    override fun cancelConnect(v: ReadableMap, p: Promise)=s.call(p) { r.external.cancelPlaidConnect(requireNotNull(v.text("operationId"))) }
    override fun startSelectAccounts(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val pending = requireNotNull(v.text("pendingConnectionId"))
        val ids = requireNotNull(v.getArray("accountIds")).strings()
        require(ids.isNotEmpty() && ids.size<=100)
        r.write(WriteRequest(op,"select_accounts",listOf(pending,ids).toString()) {
            val result = r.container.accountRepository.selectAccounts(
                AccountSelectionRequest(ConnectionId(pending), ids.map(::ProviderAccountId), IdempotencyKey(op)),
            )
            check(result.state=="connected"); r.external.clearLink(); result.operationId
        })
    }
    override fun startCancelPending(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val pending = requireNotNull(v.text("pendingConnectionId"))
        r.write(WriteRequest(op,"cancel_pending",pending) {
            r.container.accountRepository.cancelPending(PendingCancellationRequest(ConnectionId(pending), IdempotencyKey(op)))
            r.external.clearLink(); null
        })
    }
    override fun startSync(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        r.write(WriteRequest(op,"bank_sync","") { r.container.accountRepository.sync(SyncRequest(IdempotencyKey(op))).operationId })
    }
    override fun startDisconnect(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val id = requireNotNull(v.text("connectionId"))
        r.write(WriteRequest(op,"disconnect",id) { r.container.accountRepository.disconnect(DisconnectRequest(ConnectionId(id), IdempotencyKey(op))); null })
    }
}

class FilesModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeFilesSpec(context) {
    private val s=BridgeSupport(r)
    private suspend fun snapshot()=r.fileSnapshot()
    override fun initialize() { super.initialize(); s.observeSuspending("files") { emitOnStateChanged(BridgeSupport.map(snapshot())) }; s.observeStateSuspending(r.container.importRepository.state) { emitOnStateChanged(BridgeSupport.map(snapshot())) }; s.observeStateSuspending(r.container.exportCoordinator.state) { emitOnStateChanged(BridgeSupport.map(snapshot())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise)=s.call(p) { snapshot() }
    override fun readImportRows(v: ReadableMap, p: Promise)=s.call(p) {
        val offset = v.integer("offset")
        val limit = v.integer("limit")
        BridgePayloads.rows(r.fileDraft(),offset,limit)
    }
    override fun startPickImport(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val account = requireNotNull(v.text("accountId"))
        r.external.start(ExternalStartRequest(op,"import_picker",JSONObject().put("accountId",account)))
    }
    override fun setRowSelected(v: ReadableMap, p: Promise)=s.call(p) {
        val id = requireNotNull(v.text("rowId"))
        val selected = v.getBoolean("selected")
        r.withFiles { requireNotNull(BridgePayloads.importDraft(r.container.importRepository.state.value)); r.container.importRepository.setRowSelected(id,selected); BridgePayloads.files(r.container.importRepository.state.value,r.container.exportCoordinator.state.value) }
    }
    override fun startDecideDuplicate(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val candidate = requireNotNull(v.text("candidateId"))
        val decision = requireNotNull(v.text("decision"))
        r.writeFiles(FileWriteRequest(op,"import_duplicate",{listOf(it?.preview?.id,it?.preview?.revision,candidate,decision).toString()},
            {BridgeImportOperations.requireDuplicate(it,candidate,decision)}) {
            val result=r.container.importRepository.decideDuplicate(candidate,decision); check(result is ImportState.Ready); null
        })
    }
    override fun startCommitImport(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        r.writeFiles(FileWriteRequest(op,"import_commit",{listOf(it?.preview?.id,it?.preview?.revision,it?.selectedRowIds?.sorted()).toString()},
            BridgeImportOperations::requireCommit) { requireNotNull(r.container.importRepository.commit(op)).receiptId })
    }
    override fun startCancelImport(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        r.writeFiles(FileWriteRequest(op,"import_cancel",{listOf(it?.preview?.id,it?.preview?.revision).toString()},
            BridgeImportOperations::requireDraft) { check(r.container.importRepository.cancel() is ImportState.Cancelled); null })
    }
    override fun startExport(v: ReadableMap, p: Promise)=s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val args=JSONObject().put("selection",v.text("selection")).put("currency",v.text("currency") ?: JSONObject.NULL).put("startDate",v.text("startDate") ?: JSONObject.NULL).put("endDate",v.text("endDate") ?: JSONObject.NULL).put("share",v.getBoolean("share"))
        require(ExportSelection.entries.any { it.wireValue==v.text("selection") })
        r.external.start(ExternalStartRequest(op,"export_picker",args))
    }
}
