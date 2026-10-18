package com.lofuyu.borderledger.react

import com.facebook.react.bridge.*
import com.lofuyu.borderledger.react.codegen.*
import com.lofuyu.borderledger.imports.*
import com.lofuyu.borderledger.exports.*
import org.json.JSONObject

class AccountsModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeAccountsSpec(context) {
    private val s=BridgeSupport(r)
    override fun initialize() { super.initialize(); s.observeSuspending("accounts") { val snapshot=r.external.linkSnapshot(); if(r.container.ownerSessionManager.state.value is com.lofuyu.borderledger.auth.OwnerSessionState.SignedIn) emitOnStateChanged(BridgeSupport.map(snapshot)) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise)=s.call(p) { r.external.linkSnapshot() }
    override fun readAccounts(cursor: String?, limit: Double, p: Promise)=s.call(p) { require(limit in 1.0..100.0 && limit==limit.toInt().toDouble()); BridgePayloads.accountPage(r.container.accountRepository.listAccounts(cursor,limit.toInt())) }
    override fun readConnections(p: Promise)=s.call(p) { r.container.accountRepository.listConnections().map(BridgePayloads::connection) }
    override fun startConnect(op: String, reconnect: String?, p: Promise)=s.call(p) { r.external.start(op,"plaid",JSONObject().put("reconnectConnectionId",reconnect ?: JSONObject.NULL)) }
    override fun startSelectAccounts(op: String, pending: String, accounts: ReadableArray, p: Promise)=s.call(p) {
        val ids=accounts.strings(); require(ids.isNotEmpty() && ids.size<=100)
        r.write(op,"select_accounts",listOf(pending,ids).toString()) { val result=r.container.accountRepository.selectAccounts(pending,ids,op); check(result.state=="connected"); r.external.clearLink(); result.operationId }
    }
    override fun startCancelPending(op: String, pending: String, p: Promise)=s.call(p) { r.write(op,"cancel_pending",pending) { r.container.accountRepository.cancelPending(pending,op); r.external.clearLink(); null } }
    override fun startSync(op: String, p: Promise)=s.call(p) { r.write(op,"bank_sync","") { r.container.accountRepository.sync(op).operationId } }
    override fun startDisconnect(op: String, id: String, p: Promise)=s.call(p) { r.write(op,"disconnect",id) { r.container.accountRepository.disconnect(id,op); null } }
}

class FilesModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeFilesSpec(context) {
    private val s=BridgeSupport(r)
    private suspend fun snapshot()=r.fileSnapshot()
    override fun initialize() { super.initialize(); s.observeSuspending("files") { emitOnStateChanged(BridgeSupport.map(snapshot())) }; s.observeStateSuspending(r.container.importRepository.state) { emitOnStateChanged(BridgeSupport.map(snapshot())) }; s.observeStateSuspending(r.container.exportCoordinator.state) { emitOnStateChanged(BridgeSupport.map(snapshot())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise)=s.call(p) { snapshot() }
    override fun readImportRows(offset: Double, limit: Double, p: Promise)=s.call(p) { require(offset==offset.toInt().toDouble() && limit==limit.toInt().toDouble()); BridgePayloads.rows(r.fileDraft(),offset.toInt(),limit.toInt()) }
    override fun startPickImport(op: String, account: String, p: Promise)=s.call(p) { r.external.start(op,"import_picker",JSONObject().put("accountId",account)) }
    override fun setRowSelected(id: String, selected: Boolean, p: Promise)=s.call(p) { r.withFiles { requireNotNull(BridgePayloads.importDraft(r.container.importRepository.state.value)); r.container.importRepository.setRowSelected(id,selected); BridgePayloads.files(r.container.importRepository.state.value,r.container.exportCoordinator.state.value) } }
    override fun startDecideDuplicate(op: String, candidate: String, decision: String, p: Promise)=s.call(p) {
        r.writeFiles(op,"import_duplicate",{listOf(it?.preview?.id,it?.preview?.revision,candidate,decision).toString()},
            {BridgeImportOperations.requireDuplicate(it,candidate,decision)}) {
            val result=r.container.importRepository.decideDuplicate(candidate,decision); check(result is ImportState.Ready); null
        }
    }
    override fun startCommitImport(op: String, p: Promise)=s.call(p) {
        r.writeFiles(op,"import_commit",{listOf(it?.preview?.id,it?.preview?.revision,it?.selectedRowIds?.sorted()).toString()},
            BridgeImportOperations::requireCommit) { requireNotNull(r.container.importRepository.commit(op)).receiptId }
    }
    override fun startCancelImport(op: String, p: Promise)=s.call(p) {
        r.writeFiles(op,"import_cancel",{listOf(it?.preview?.id,it?.preview?.revision).toString()},
            BridgeImportOperations::requireDraft) { check(r.container.importRepository.cancel() is ImportState.Cancelled); null }
    }
    override fun startExport(op: String, v: ReadableMap, p: Promise)=s.call(p) {
        val args=JSONObject().put("selection",v.text("selection")).put("currency",v.text("currency") ?: JSONObject.NULL).put("startDate",v.text("startDate") ?: JSONObject.NULL).put("endDate",v.text("endDate") ?: JSONObject.NULL).put("share",v.getBoolean("share"))
        require(ExportSelection.entries.any { it.wireValue==v.text("selection") })
        r.external.start(op,"export_picker",args)
    }
}
