package com.lofuyu.borderledger.react

import android.net.Uri
import com.facebook.react.bridge.*
import com.lofuyu.borderledger.LedgerRepository
import com.lofuyu.borderledger.api.*
import com.lofuyu.borderledger.auth.*
import com.lofuyu.borderledger.recurring.*
import com.lofuyu.borderledger.review.*
import com.lofuyu.borderledger.sync.UploadSyncResult
import com.lofuyu.borderledger.ui.accounts.devices.*
import com.lofuyu.borderledger.ui.settings.*
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import com.lofuyu.borderledger.react.codegen.*

private val PENDING_DESTINATIONS = setOf(
    "overview",
    "activity",
    "recurring",
    "review",
    "accounts",
    "settings",
    "capture",
    "/capture",
)

private val Double.isWholeNumber: Boolean
    get() = isFinite() && this == toInt().toDouble()

private data class RecurringClassifyRequest(
    val operationId: String,
    val streamId: String,
    val expectedRevision: Int,
    val classification: RecurringClassification,
)

private data class ReviewLinkRequest(
    val targetId: String?,
    val candidateTransactionId: String?,
    val relation: ReviewRelation?,
    val allocatedMoney: ReviewMoney?,
)

private data class ReviewRequest(
    val eventId: String,
    val expectedRevision: Int,
    val decision: ReviewDecision,
    val link: ReviewLinkRequest,
)

private fun reviewMoney(value: ReadableMap?): ReviewMoney? = value?.let {
    ReviewMoney(
        currency = requireNotNull(it.text("currency")),
        amountMinor = requireNotNull(it.text("amountMinor")).toLong(),
    )
}

private fun reviewRequest(value: ReadableMap): ReviewRequest {
    val link = ReviewLinkRequest(
        targetId = value.text("targetId"),
        candidateTransactionId = value.text("candidateTransactionId"),
        relation = value.text("relation")?.let { relation ->
            ReviewRelation.entries.first { it.wireValue == relation }
        },
        allocatedMoney = reviewMoney(value.getMap("allocatedMoney")),
    )
    return ReviewRequest(
        eventId = requireNotNull(value.text("eventId")),
        expectedRevision = value.integer("expectedRevision"),
        decision = ReviewDecision.entries.first { it.wireValue == value.text("decision") },
        link = link,
    )
}

private fun annotation(value: ReadableMap) = ReviewAnnotationDto(
    transactionId = requireNotNull(value.text("transactionId")),
    expectedRevision = value.integer("expectedRevision"),
    category = requireNotNull(value.text("category")),
    note = value.text("note"),
)

private fun displayPreferences(value: ReadableMap) = DeviceDisplayPreferences(
    appearanceMode = AppearanceMode.valueOf(requireNotNull(value.text("appearanceMode"))),
    filter = DeviceFilter.valueOf(requireNotNull(value.text("filter"))),
    reducedMotion = value.getBoolean("reducedMotion"),
)

private fun reportingUpdate(value: ReadableMap) = ReportingPreferencesUpdate(
    reportingTimezone = requireNotNull(value.text("reportingTimezone")),
    weekStart = value.integer("weekStart"),
    preferredCurrency = value.text("preferredCurrency"),
)

private fun sourceConfig(value: ReadableMap): DeviceSourceConfig {
    val mappings = requireNotNull(value.getArray("mappings"))
    require(mappings.size() <= 100)
    return DeviceSourceConfig(
        expectedRevision = value.integer("expectedRevision"),
        mappings = (0 until mappings.size()).map { index -> sourceMapping(requireNotNull(mappings.getMap(index))) },
    )
}

private fun sourceMapping(value: ReadableMap): SourceMapping {
    val hint = value.getMap("instrumentHint")?.let {
        InstrumentHint(
            kind = requireNotNull(it.text("kind")),
            value = requireNotNull(it.text("value")),
        )
    }
    return SourceMapping(
        sourceProfileId = requireNotNull(value.text("sourceProfileId")),
        accountId = requireNotNull(value.text("accountId")),
        allowedCurrencies = requireNotNull(value.getArray("allowedCurrencies")).strings(),
        instrumentHint = hint,
    )
}

private fun requireSnapshotRefresh(result: LedgerRepository.SnapshotRefreshResult) {
    when (result) {
        LedgerRepository.SnapshotRefreshResult.Refreshed -> Unit
        LedgerRepository.SnapshotRefreshResult.Offline -> throw TransportFailure.Offline
        LedgerRepository.SnapshotRefreshResult.NotSignedIn -> throw BridgeFailure("not_signed_in")
        LedgerRepository.SnapshotRefreshResult.Unauthorized -> throw BridgeFailure("unauthorized")
        LedgerRepository.SnapshotRefreshResult.Unavailable -> throw BridgeFailure("unavailable")
    }
}

private fun activityPayload(result: LedgerRepository.ActivityRefreshResult): Map<String, Any?> = when (result) {
    is LedgerRepository.ActivityRefreshResult.Refreshed -> BridgePayloads.transactions(result.page)
    LedgerRepository.ActivityRefreshResult.Offline -> throw TransportFailure.Offline
    LedgerRepository.ActivityRefreshResult.NotSignedIn -> throw BridgeFailure("not_signed_in")
    LedgerRepository.ActivityRefreshResult.Unauthorized -> throw BridgeFailure("unauthorized")
    LedgerRepository.ActivityRefreshResult.Unavailable -> throw BridgeFailure("unavailable")
}

private fun reportPayload(result: LedgerRepository.ReportRefreshResult): Map<String, Any?> = when (result) {
    is LedgerRepository.ReportRefreshResult.Refreshed -> BridgePayloads.report(result.report)
    LedgerRepository.ReportRefreshResult.Offline -> throw TransportFailure.Offline
    LedgerRepository.ReportRefreshResult.NotSignedIn -> throw BridgeFailure("not_signed_in")
    LedgerRepository.ReportRefreshResult.Unauthorized -> throw BridgeFailure("unauthorized")
    LedgerRepository.ReportRefreshResult.Unavailable -> throw BridgeFailure("unavailable")
}

private fun requireCaptureSync(result: UploadSyncResult) {
    when (result) {
        is UploadSyncResult.Completed, UploadSyncResult.NoPendingEvents -> Unit
        else -> error("Reconcile capture health")
    }
}

class SessionModule(context: ReactApplicationContext, private val r: NativeServiceRuntime) : NativeSessionSpec(context) {
    private val s = BridgeSupport(r)

    private fun snapshot() = BridgePayloads.session(r.container.ownerSessionManager.state.value)

    override fun initialize() {
        super.initialize()
        s.observeState(r.session.snapshots) { emitOnStateChanged(BridgeSupport.map(it)) }
        s.observe("session") { emitOnStateChanged(BridgeSupport.map(snapshot())) }
    }

    override fun invalidate() {
        s.close()
        super.invalidate()
    }

    override fun getSnapshot(p: Promise) = s.call(p, false) { r.session.getSnapshot() }

    override fun refreshOnResume(p: Promise) = s.call(p, false) {
        r.resume()
        snapshot()
    }

    override fun beginLogin(v: ReadableMap, p: Promise) = s.call(p, false) {
        val staySignedIn = v.getBoolean("staySignedIn")
        val pendingDestination = v.text("pendingDestination")
        require(pendingDestination == null || pendingDestination in PENDING_DESTINATIONS)
        val host = requireNotNull(r.host)
        val launch = r.beginLogin(staySignedIn, pendingDestination)
        host.openBrowser(Uri.parse(launch.authorizationUrl))
        snapshot()
    }

    override fun signOut(p: Promise) = s.call(p, false) {
        r.signOut()
        snapshot()
    }

    override fun consumePendingDestination(p: Promise) = s.call(p) {
        r.container.ownerSessionManager.consumePendingDestination()
    }

    override fun queryOperation(v: ReadableMap, p: Promise) = s.call(p) {
        val id = requireNotNull(v.text("operationId"))
        r.container.bridgeOperations.query(BridgeOperationKey(id, r.ownerGeneration()))?.let(BridgePayloads::operation)
    }

    override fun readOperations(v: ReadableMap, p: Promise) = s.call(p) {
        val offset = v.integer("offset")
        val limit = v.integer("limit")
        r.container.bridgeOperations.list(
            BridgeOperationPage(r.ownerGeneration(), offset, limit),
        ).map(BridgePayloads::operation)
    }

    override fun cancelOperation(v: ReadableMap, p: Promise) = s.call(p) {
        val id = requireNotNull(v.text("operationId"))
        r.container.bridgeOperations.cancel(BridgeOperationKey(id, r.ownerGeneration()))?.let(BridgePayloads::operation)
    }
}

class LedgerModule(context: ReactApplicationContext, private val r: NativeServiceRuntime) : NativeLedgerSpec(context) {
    private val s = BridgeSupport(r)

    override fun initialize() {
        super.initialize()
        s.observe("ledger") { emitOnChanged(BridgeSupport.map(r.changePayload())) }
    }

    override fun invalidate() {
        s.close()
        super.invalidate()
    }

    override fun getSnapshot(p: Promise) = s.call(p) { r.cachedSnapshot() }

    override fun refreshSnapshot(p: Promise) = s.call(p) {
        requireSnapshotRefresh(r.container.ledgerRepository.refreshOwnerSnapshot())
        r.changes.emit("ledger")
        r.cachedSnapshot()
    }

    override fun readTransactions(q: ReadableMap, p: Promise) = s.call(p) {
        val query = OwnerTransactionQuery(
            cursor = q.text("cursor"),
            limit = q.integer("limit"),
            query = q.text("query"),
            currency = q.text("currency"),
            status = q.text("status"),
            source = q.text("source"),
            category = q.text("category"),
        )
        activityPayload(r.container.ledgerRepository.readOwnerTransactions(query))
    }

    override fun readReport(q: ReadableMap, p: Promise) = s.call(p) {
        val query = OwnerReportQuery(
            startDate = requireNotNull(q.text("startDate")),
            endDate = requireNotNull(q.text("endDate")),
            includeProvisional = q.getBoolean("includeProvisional"),
            currency = q.text("currency"),
            reportingCurrency = q.text("reportingCurrency"),
            timeZone = requireNotNull(q.text("timeZone")),
        )
        reportPayload(r.container.ledgerRepository.refreshOwnerReport(query))
    }

    override fun startCaptureSync(v: ReadableMap, p: Promise) = s.call(p) {
        val id = requireNotNull(v.text("operationId"))
        r.write(WriteRequest(id, "capture_sync", "") {
            requireCaptureSync(r.container.ledgerRepository.syncCapture())
            null
        })
    }
}

class RecurringModule(context: ReactApplicationContext, private val r: NativeServiceRuntime) : NativeRecurringSpec(context) {
    private val s = BridgeSupport(r)

    override fun initialize() {
        super.initialize()
        s.observe("recurring") { emitOnChanged(BridgeSupport.map(r.changePayload())) }
    }

    override fun invalidate() {
        s.close()
        super.invalidate()
    }

    override fun readPage(q: ReadableMap, p: Promise) = s.call(p) {
        val limit = q.integer("limit")
        require(limit in 1..100)
        BridgePayloads.recurringPage(
            r.container.recurringRepository.readPage(
                RecurringQuery(q.text("cursor"), limit, q.text("currency"), q.text("classification")),
            ),
        )
    }

    override fun readSummary(v: ReadableMap, p: Promise) = s.call(p) {
        val start = requireNotNull(v.text("startDate"))
        val end = requireNotNull(v.text("endDate"))
        BridgePayloads.recurringSummary(r.container.recurringRepository.readSummary(RecurringSummaryQuery(start, end)))
    }

    override fun readDetail(v: ReadableMap, p: Promise) = s.call(p) {
        val id = requireNotNull(v.text("id"))
        val cursor = v.text("cursor")
        val limit = v.integer("limit")
        require(limit in 1..100)
        BridgePayloads.recurringDetail(r.container.recurringRepository.readDetail(id, cursor, limit))
    }

    override fun startClassify(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val id = requireNotNull(v.text("id"))
        val revision = v.integer("expectedRevision")
        val classification = requireNotNull(v.text("classification"))
        require(revision >= 0)
        require(RecurringClassification.entries.any { it.wireValue == classification })
        val request = RecurringClassifyRequest(
            operationId = op,
            streamId = id,
            expectedRevision = revision,
            classification = RecurringClassification.entries.first { it.wireValue == classification },
        )
        r.write(WriteRequest(request.operationId, "recurring_classify", listOf(id, revision, classification).toString()) {
            r.container.recurringRepository.classify(
                request.streamId,
                request.expectedRevision,
                request.classification.wireValue,
            )
            null
        })
    }
}

class ReviewModule(context: ReactApplicationContext, private val r: NativeServiceRuntime) : NativeReviewSpec(context) {
    private val s = BridgeSupport(r)

    override fun initialize() {
        super.initialize()
        s.observe("review") { emitOnChanged(BridgeSupport.map(r.changePayload())) }
    }

    override fun invalidate() {
        s.close()
        super.invalidate()
    }

    override fun readAlerts(v: ReadableMap, p: Promise) = s.call(p) {
        val cursor = v.text("cursor")
        val limit = v.integer("limit")
        BridgePayloads.reviewPage(r.container.reviewRepository.readAlerts(ReviewQuery(cursor, limit)))
    }

    override fun startReview(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val request = reviewRequest(requireNotNull(v.getMap("value")))
        val link = request.link
        r.write(WriteRequest(op, "review", listOf(
            request.eventId,
            request.expectedRevision,
            request.decision,
            link.targetId,
            link.candidateTransactionId,
            link.relation,
            link.allocatedMoney,
        ).toString()) {
            r.container.reviewRepository.reviewAlert(
                request.eventId,
                request.expectedRevision,
                request.decision,
                link.targetId,
                link.candidateTransactionId,
                link.relation,
                link.allocatedMoney,
            )
            null
        })
    }

    override fun startAnnotate(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val value = annotation(requireNotNull(v.getMap("value")))
        r.write(WriteRequest(op, "annotate", value.toString()) {
            r.container.reviewRepository.annotateTransaction(
                value.transactionId,
                value.expectedRevision,
                value.category,
                value.note,
            )
            null
        })
    }
}

class PreferencesModule(context: ReactApplicationContext, private val r: NativeServiceRuntime) : NativePreferencesSpec(context) {
    private val s = BridgeSupport(r)

    private fun snapshot() = BridgePayloads.display(r.container.deviceDisplayPreferencesStore.read())

    override fun initialize() {
        super.initialize()
        s.observe("preferences") { emitOnChanged(BridgeSupport.map(snapshot())) }
    }

    override fun invalidate() {
        s.close()
        super.invalidate()
    }

    override fun getSnapshot(p: Promise) = s.call(p, false) { snapshot() }

    override fun updateDisplay(v: ReadableMap, p: Promise) = s.call(p, false) {
        val value = displayPreferences(v)
        r.container.themePreferences.setMode(value.appearanceMode)
        r.container.deviceDisplayPreferencesStore.write(value)
        r.changes.emit("preferences")
        snapshot()
    }

    override fun readReporting(p: Promise) = s.call(p) {
        BridgePayloads.reporting(r.container.reportingPreferencesRepository.read())
    }

    override fun startUpdateReporting(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val revision = v.integer("expectedRevision")
        require(revision >= 0)
        val value = reportingUpdate(requireNotNull(v.getMap("value")))
        r.write(WriteRequest(op, "reporting_preferences", listOf(revision, value).toString()) {
            r.container.reportingPreferencesRepository.update(revision, value)
            null
        })
    }
}

class CaptureDevicesModule(context: ReactApplicationContext, private val r: NativeServiceRuntime) : NativeCaptureDevicesSpec(context) {
    private val s = BridgeSupport(r)

    private fun snapshot() = BridgePayloads.capture(r.container.captureOnboarding.state.value)

    private fun isOwnerSignedIn() = r.container.ownerSessionManager.state.value is OwnerSessionState.SignedIn

    private fun emitCaptureState(value: CaptureOnboardingState) {
        if (isOwnerSignedIn()) emitOnStateChanged(BridgeSupport.map(BridgePayloads.capture(value)))
    }

    private fun emitCaptureHealth(value: com.lofuyu.borderledger.capture.CaptureHealthState) {
        if (isOwnerSignedIn()) emitOnHealthChanged(BridgeSupport.map(BridgePayloads.captureRuntime(value)))
    }

    private fun emitCaptureSnapshot() {
        if (isOwnerSignedIn()) emitOnStateChanged(BridgeSupport.map(snapshot()))
    }

    override fun initialize() {
        super.initialize()
        s.observeState(r.container.captureOnboarding.state, ::emitCaptureState)
        s.observeState(r.container.captureHealth.state, ::emitCaptureHealth)
        s.observe("capture", ::emitCaptureSnapshot)
    }

    override fun invalidate() {
        s.close()
        super.invalidate()
    }

    override fun getSnapshot(p: Promise) = s.call(p) { snapshot() }

    override fun getRuntimeHealth(p: Promise) = s.call(p) {
        BridgePayloads.captureRuntime(r.container.captureHealth.state.value)
    }

    override fun refresh(p: Promise) = s.call(p) {
        r.container.captureOnboarding.refreshApiHealth()
        snapshot()
    }

    override fun readDevices(p: Promise) = s.call(p) {
        r.container.deviceManagementRepository.readDevices().map(BridgePayloads::device)
    }

    override fun selectSource(v: ReadableMap, p: Promise) = s.call(p) {
        val id = requireNotNull(v.text("sourceProfileId"))
        val currency = requireNotNull(v.text("currency"))
        val profile = r.container.captureOnboarding.state.value.profiles.first { it.sourceProfileId == id }
        r.container.captureOnboarding.select(profile, currency)
        snapshot()
    }

    override fun requestSourceTest(p: Promise) = s.call(p) {
        r.container.captureOnboarding.requestSourceTest()
        snapshot()
    }

    override fun openNotificationSettings(p: Promise) = s.call(p) {
        requireNotNull(r.host).openNotificationSettings()
        null
    }

    override fun openAppNotificationSettings(p: Promise) = s.call(p) {
        requireNotNull(r.host).openAppNotificationSettings()
        null
    }

    override fun startAuthorizeCapture(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val consent = v.getBoolean("consent")
        r.write(WriteRequest(op, "authorize_capture", consent.toString()) {
            r.container.captureOnboarding.authorizeCapture(consent)
            check(r.container.captureOnboarding.state.value.health == CaptureHealth.Ready)
            null
        })
    }

    override fun startRevokeDevice(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val id = requireNotNull(v.text("deviceId"))
        r.write(WriteRequest(op, "revoke_device", id) {
            r.container.deviceManagementRepository.revoke(id)
            null
        })
    }

    override fun startReplaceSourceConfig(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val value = sourceConfig(requireNotNull(v.getMap("config")))
        r.write(WriteRequest(op, "source_config", value.toString()) {
            r.container.deviceManagementRepository.replaceSourceConfig(value).id
        })
    }

    override fun startAuthorizeDevice(v: ReadableMap, p: Promise) = s.call(p) {
        val op = requireNotNull(v.text("operationId"))
        val value = sourceConfig(requireNotNull(v.getMap("config")))
        r.write(WriteRequest(op, "authorize_device", value.toString()) {
            r.container.deviceManagementRepository.authorizeCapture(value).id
        })
    }
}
