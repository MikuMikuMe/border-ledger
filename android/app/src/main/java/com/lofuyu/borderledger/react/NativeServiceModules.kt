package com.lofuyu.borderledger.react

import android.net.Uri
import com.facebook.react.bridge.*
import com.lofuyu.borderledger.react.codegen.*
import com.lofuyu.borderledger.LedgerRepository
import com.lofuyu.borderledger.api.*
import com.lofuyu.borderledger.auth.*
import com.lofuyu.borderledger.recurring.*
import com.lofuyu.borderledger.review.*
import com.lofuyu.borderledger.ui.settings.*
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import com.lofuyu.borderledger.ui.accounts.devices.*

class SessionModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeSessionSpec(context) {
    private val s = BridgeSupport(r)
    private fun snapshot() = BridgePayloads.session(r.container.ownerSessionManager.state.value)
    override fun initialize() { super.initialize(); s.observeState(r.session.snapshots) { emitOnStateChanged(BridgeSupport.map(it)) }; s.observe("session") { emitOnStateChanged(BridgeSupport.map(snapshot())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise) = s.call(p, false) { r.session.getSnapshot() }
    override fun refreshOnResume(p: Promise) = s.call(p, false) { r.resume(); snapshot() }
    override fun beginLogin(staySignedIn: Boolean, pendingDestination: String?, p: Promise) = s.call(p, false) {
        val host = requireNotNull(r.host)
        require(pendingDestination == null || pendingDestination in setOf("overview", "activity", "recurring", "review", "accounts", "settings", "capture", "/capture"))
        val launch = r.beginLogin(staySignedIn, pendingDestination)
        host.openBrowser(Uri.parse(launch.authorizationUrl)); snapshot()
    }
    override fun signOut(p: Promise) = s.call(p, false) { r.signOut(); snapshot() }
    override fun consumePendingDestination(p: Promise) = s.call(p) { r.container.ownerSessionManager.consumePendingDestination() }
    override fun queryOperation(id: String, p: Promise) = s.call(p) { r.container.bridgeOperations.query(id, r.ownerGeneration())?.let(BridgePayloads::operation) }
    override fun readOperations(offset: Double, limit: Double, p: Promise) = s.call(p) {
        require(offset==offset.toInt().toDouble() && limit==limit.toInt().toDouble())
        r.container.bridgeOperations.list(r.ownerGeneration(),offset.toInt(),limit.toInt()).map(BridgePayloads::operation)
    }
    override fun cancelOperation(id: String, p: Promise) = s.call(p) { r.container.bridgeOperations.cancel(id, r.ownerGeneration())?.let(BridgePayloads::operation) }
}

class LedgerModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeLedgerSpec(context) {
    private val s = BridgeSupport(r)
    override fun initialize() { super.initialize(); s.observe("ledger") { emitOnChanged(BridgeSupport.map(r.changePayload())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise) = s.call(p) { r.cachedSnapshot() }
    override fun refreshSnapshot(p: Promise) = s.call(p) {
        when(r.container.ledgerRepository.refreshOwnerSnapshot()) {
            LedgerRepository.SnapshotRefreshResult.Refreshed -> Unit
            LedgerRepository.SnapshotRefreshResult.Offline -> throw TransportFailure.Offline
            LedgerRepository.SnapshotRefreshResult.NotSignedIn -> throw BridgeFailure("not_signed_in")
            LedgerRepository.SnapshotRefreshResult.Unauthorized -> throw BridgeFailure("unauthorized")
            LedgerRepository.SnapshotRefreshResult.Unavailable -> throw BridgeFailure("unavailable")
        }
        r.changes.emit("ledger"); r.cachedSnapshot()
    }
    override fun readTransactions(q: ReadableMap, p: Promise) = s.call(p) {
        val result = r.container.ledgerRepository.readOwnerTransactions(OwnerTransactionQuery(q.text("cursor"), q.integer("limit"), q.text("query"), q.text("currency"), q.text("status"), q.text("source"), q.text("category")))
        when(result) {
            is LedgerRepository.ActivityRefreshResult.Refreshed -> BridgePayloads.transactions(result.page)
            LedgerRepository.ActivityRefreshResult.Offline -> throw TransportFailure.Offline
            LedgerRepository.ActivityRefreshResult.NotSignedIn -> throw BridgeFailure("not_signed_in")
            LedgerRepository.ActivityRefreshResult.Unauthorized -> throw BridgeFailure("unauthorized")
            LedgerRepository.ActivityRefreshResult.Unavailable -> throw BridgeFailure("unavailable")
        }
    }
    override fun readReport(q: ReadableMap, p: Promise) = s.call(p) {
        val result = r.container.ledgerRepository.refreshOwnerReport(OwnerReportQuery(requireNotNull(q.text("startDate")), requireNotNull(q.text("endDate")), q.getBoolean("includeProvisional"), q.text("currency"), q.text("reportingCurrency"), requireNotNull(q.text("timeZone"))))
        when(result) {
            is LedgerRepository.ReportRefreshResult.Refreshed -> BridgePayloads.report(result.report)
            LedgerRepository.ReportRefreshResult.Offline -> throw TransportFailure.Offline
            LedgerRepository.ReportRefreshResult.NotSignedIn -> throw BridgeFailure("not_signed_in")
            LedgerRepository.ReportRefreshResult.Unauthorized -> throw BridgeFailure("unauthorized")
            LedgerRepository.ReportRefreshResult.Unavailable -> throw BridgeFailure("unavailable")
        }
    }
    override fun startCaptureSync(id: String, p: Promise) = s.call(p) { r.write(id,"capture_sync", "") {
        when(r.container.ledgerRepository.syncCapture()) { is com.lofuyu.borderledger.sync.UploadSyncResult.Completed, com.lofuyu.borderledger.sync.UploadSyncResult.NoPendingEvents -> Unit; else -> error("Reconcile capture health") }; null
    } }
}

class RecurringModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeRecurringSpec(context) {
    private val s = BridgeSupport(r)
    override fun initialize() { super.initialize(); s.observe("recurring") { emitOnChanged(BridgeSupport.map(r.changePayload())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun readPage(q: ReadableMap, p: Promise) = s.call(p) { val limit=q.integer("limit"); require(limit in 1..100); BridgePayloads.recurringPage(r.container.recurringRepository.readPage(RecurringQuery(q.text("cursor"), limit, q.text("currency"), q.text("classification")))) }
    override fun readSummary(start: String, end: String, p: Promise) = s.call(p) { BridgePayloads.recurringSummary(r.container.recurringRepository.readSummary(RecurringSummaryQuery(start,end))) }
    override fun readDetail(id: String, cursor: String?, limit: Double, p: Promise) = s.call(p) { require(limit in 1.0..100.0 && limit == limit.toInt().toDouble()); BridgePayloads.recurringDetail(r.container.recurringRepository.readDetail(id,cursor,limit.toInt())) }
    override fun startClassify(op: String, id: String, revision: Double, classification: String, p: Promise) = s.call(p) {
        require(revision >= 0 && revision == revision.toInt().toDouble()); require(RecurringClassification.entries.any { it.wireValue==classification })
        r.write(op,"recurring_classify", listOf(id,revision,classification).toString()) { r.container.recurringRepository.classify(id,revision.toInt(),classification); null }
    }
}

class ReviewModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeReviewSpec(context) {
    private val s = BridgeSupport(r)
    override fun initialize() { super.initialize(); s.observe("review") { emitOnChanged(BridgeSupport.map(r.changePayload())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun readAlerts(cursor: String?, limit: Double, p: Promise) = s.call(p) { require(limit == limit.toInt().toDouble()); BridgePayloads.reviewPage(r.container.reviewRepository.readAlerts(ReviewQuery(cursor,limit.toInt()))) }
    override fun startReview(op: String, v: ReadableMap, p: Promise) = s.call(p) {
        val eventId=requireNotNull(v.text("eventId")); val revision=v.integer("expectedRevision")
        val decision=ReviewDecision.entries.first { it.wireValue==v.text("decision") }
        val relation=v.text("relation")?.let { text -> ReviewRelation.entries.first { it.wireValue==text } }
        val money=v.getMap("allocatedMoney")?.let { ReviewMoney(requireNotNull(it.text("currency")), requireNotNull(it.text("amountMinor")).toLong()) }
        val target=v.text("targetId"); val candidate=v.text("candidateTransactionId")
        r.write(op,"review", listOf(eventId,revision,decision,target,candidate,relation,money).toString()) { r.container.reviewRepository.reviewAlert(eventId,revision,decision,target,candidate,relation,money); null }
    }
    override fun startAnnotate(op: String, v: ReadableMap, p: Promise) = s.call(p) {
        val a=ReviewAnnotationDto(requireNotNull(v.text("transactionId")), v.integer("expectedRevision"), requireNotNull(v.text("category")), v.text("note"))
        r.write(op,"annotate",a.toString()) { r.container.reviewRepository.annotateTransaction(a.transactionId,a.expectedRevision,a.category,a.note); null }
    }
}

class PreferencesModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativePreferencesSpec(context) {
    private val s = BridgeSupport(r)
    private fun snapshot()=BridgePayloads.display(r.container.deviceDisplayPreferencesStore.read())
    override fun initialize() { super.initialize(); s.observe("preferences") { emitOnChanged(BridgeSupport.map(snapshot())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise) = s.call(p,false) { snapshot() }
    override fun updateDisplay(v: ReadableMap, p: Promise) = s.call(p,false) {
        val value=DeviceDisplayPreferences(AppearanceMode.valueOf(requireNotNull(v.text("appearanceMode"))), DeviceFilter.valueOf(requireNotNull(v.text("filter"))), v.getBoolean("reducedMotion"))
        r.container.themePreferences.setMode(value.appearanceMode); r.container.deviceDisplayPreferencesStore.write(value); r.changes.emit("preferences"); snapshot()
    }
    override fun readReporting(p: Promise) = s.call(p) { BridgePayloads.reporting(r.container.reportingPreferencesRepository.read()) }
    override fun startUpdateReporting(op: String, revision: Double, v: ReadableMap, p: Promise) = s.call(p) {
        require(revision >= 0 && revision == revision.toInt().toDouble())
        val value=ReportingPreferencesUpdate(requireNotNull(v.text("reportingTimezone")),v.integer("weekStart"),v.text("preferredCurrency"))
        r.write(op,"reporting_preferences", listOf(revision,value).toString()) { r.container.reportingPreferencesRepository.update(revision.toInt(),value); null }
    }
}

class CaptureDevicesModule(context: ReactApplicationContext, private val r: NativeServiceRuntime): NativeCaptureDevicesSpec(context) {
    private val s=BridgeSupport(r)
    private fun snapshot()=BridgePayloads.capture(r.container.captureOnboarding.state.value)
    override fun initialize() { super.initialize(); s.observeState(r.container.captureOnboarding.state) { if(r.container.ownerSessionManager.state.value is OwnerSessionState.SignedIn) emitOnStateChanged(BridgeSupport.map(BridgePayloads.capture(it))) }; s.observeState(r.container.captureHealth.state) { if(r.container.ownerSessionManager.state.value is OwnerSessionState.SignedIn) emitOnHealthChanged(BridgeSupport.map(BridgePayloads.captureRuntime(it))) }; s.observe("capture") { if(r.container.ownerSessionManager.state.value is OwnerSessionState.SignedIn) emitOnStateChanged(BridgeSupport.map(snapshot())) } }
    override fun invalidate() { s.close(); super.invalidate() }
    override fun getSnapshot(p: Promise)=s.call(p) { snapshot() }
    override fun getRuntimeHealth(p: Promise)=s.call(p) { BridgePayloads.captureRuntime(r.container.captureHealth.state.value) }
    override fun refresh(p: Promise)=s.call(p) { r.container.captureOnboarding.refreshApiHealth(); snapshot() }
    override fun readDevices(p: Promise)=s.call(p) { r.container.deviceManagementRepository.readDevices().map(BridgePayloads::device) }
    override fun selectSource(id: String, currency: String, p: Promise)=s.call(p) { r.container.captureOnboarding.select(r.container.captureOnboarding.state.value.profiles.first { it.sourceProfileId==id },currency); snapshot() }
    override fun requestSourceTest(p: Promise)=s.call(p) { r.container.captureOnboarding.requestSourceTest(); snapshot() }
    override fun openNotificationSettings(p: Promise)=s.call(p) { requireNotNull(r.host).openNotificationSettings(); null }
    override fun openAppNotificationSettings(p: Promise)=s.call(p) { requireNotNull(r.host).openAppNotificationSettings(); null }
    override fun startAuthorizeCapture(op: String, consent: Boolean, p: Promise)=s.call(p) { r.write(op,"authorize_capture",consent.toString()) { r.container.captureOnboarding.authorizeCapture(consent); check(r.container.captureOnboarding.state.value.health==CaptureHealth.Ready); null } }
    override fun startRevokeDevice(op: String, id: String, p: Promise)=s.call(p) { r.write(op,"revoke_device",id) { r.container.deviceManagementRepository.revoke(id); null } }
    private fun config(v: ReadableMap): DeviceSourceConfig {
        val values=requireNotNull(v.getArray("mappings")); require(values.size() <= 100)
        return DeviceSourceConfig(v.integer("expectedRevision"),(0 until values.size()).map { index ->
            val value=requireNotNull(values.getMap(index)); val hint=value.getMap("instrumentHint")?.let { InstrumentHint(requireNotNull(it.text("kind")),requireNotNull(it.text("value"))) }
            SourceMapping(requireNotNull(value.text("sourceProfileId")),requireNotNull(value.text("accountId")),requireNotNull(value.getArray("allowedCurrencies")).strings(),hint)
        })
    }
    override fun startReplaceSourceConfig(op: String, v: ReadableMap, p: Promise)=s.call(p) { val value=config(v); r.write(op,"source_config",value.toString()) { r.container.deviceManagementRepository.replaceSourceConfig(value).id } }
    override fun startAuthorizeDevice(op: String, v: ReadableMap, p: Promise)=s.call(p) { val value=config(v); r.write(op,"authorize_device",value.toString()) { r.container.deviceManagementRepository.authorizeCapture(value).id } }
}
