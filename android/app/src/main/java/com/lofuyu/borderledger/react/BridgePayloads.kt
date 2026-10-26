package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.BuildConfig
import com.lofuyu.borderledger.auth.*
import com.lofuyu.borderledger.accounts.*
import com.lofuyu.borderledger.bank.*
import com.lofuyu.borderledger.recurring.*
import com.lofuyu.borderledger.review.*
import com.lofuyu.borderledger.imports.*
import com.lofuyu.borderledger.exports.*
import com.lofuyu.borderledger.ui.ledger.*
import com.lofuyu.borderledger.ui.accounts.devices.*
import com.lofuyu.borderledger.ui.settings.*

/** Explicit allowlist projections. Never reflect, serialize native auth records, or expose exception messages. */
object BridgePayloads {
    fun session(v: OwnerSessionState, environment: String = BuildConfig.MOBILE_ENVIRONMENT): Map<String, Any?> = mapOf(
        "state" to when(v) {
            OwnerSessionState.Restoring -> "restoring"; OwnerSessionState.SigningIn -> "signing_in"; OwnerSessionState.Exchanging -> "exchanging"
            OwnerSessionState.Refreshing -> "refreshing"; OwnerSessionState.SigningOut -> "signing_out"; is OwnerSessionState.AwaitingBrowser -> "awaiting_browser"
            is OwnerSessionState.SignedIn -> "signed_in"; is OwnerSessionState.SignedOut -> "signed_out"; is OwnerSessionState.Expired -> "expired"
            is OwnerSessionState.CallbackRejected -> "callback_rejected"; is OwnerSessionState.StorageFailure -> "storage_failure"
        }, "expiresAt" to when(v) { is OwnerSessionState.SignedIn -> v.expiresAt; is OwnerSessionState.AwaitingBrowser -> v.expiresAt; else -> null },
        "pendingDestination" to (v as? OwnerSessionState.SignedIn)?.pendingDestination,
        "userId" to (v as? OwnerSessionState.SignedIn)?.binding?.identity?.userId,
        "ledgerId" to (v as? OwnerSessionState.SignedIn)?.binding?.identity?.ledgerId,
        "sessionEpoch" to (v as? OwnerSessionState.SignedIn)?.binding?.epoch,
        "reason" to (v as? OwnerSessionState.SignedOut)?.reason?.name,
        "pendingRevocations" to when(v) { is OwnerSessionState.SignedOut -> v.pendingRevocations; is OwnerSessionState.Expired -> v.pendingRevocations; else -> 0 },
        "environment" to environment,
    )
    fun operation(v: BridgeOperation) = mapOf("operationId" to v.operationId, "kind" to v.kind, "status" to v.status, "updatedAt" to v.updatedAt, "resultId" to v.resultId)
    fun transaction(v: LedgerTransaction) = mapOf("id" to v.id, "occurredAt" to v.occurredAt, "currency" to v.currency,
        "signedMinorUnits" to v.signedMinorUnits.toString(), "merchant" to v.merchant, "accountLabel" to v.accountLabel, "status" to v.status,
        "sourceLabel" to v.sourceLabel, "category" to v.category, "note" to v.note, "kind" to v.kind, "revision" to v.revision, "accountId" to v.accountId)
    fun transactions(v: LedgerTransactionPage) = mapOf("items" to v.items.map(::transaction), "nextCursor" to v.nextCursor, "limit" to v.limit)
    fun snapshot(v: LedgerSnapshot) = mapOf("schemaVersion" to v.schemaVersion, "snapshotAt" to v.snapshotAt, "timeZone" to v.timeZone,
        "accounts" to v.accounts.map { mapOf("id" to it.id, "displayName" to it.displayName, "institution" to it.institution, "instrument" to it.instrument, "currencies" to it.currencies, "lastSuccessfulSyncAt" to it.lastSuccessfulSyncAt) },
        "transactions" to v.transactions.map(::transaction),
        "recurring" to v.recurring.map { mapOf("id" to it.id, "label" to it.label, "currency" to it.currency, "monthlyMinorUnits" to it.monthlyMinorUnits?.toString(), "classification" to it.classification, "nextDueAt" to it.nextDueAt) },
        "reviews" to v.reviews.map { mapOf("id" to it.id, "reason" to it.reason, "currency" to it.currency, "affectedMinorUnits" to it.affectedMinorUnits?.toString(), "candidateLabel" to it.candidateLabel, "status" to it.status) }, "report" to v.report?.let(::report))
    fun report(v: LedgerReport): Map<String, Any?> = mapOf("timeBasis" to v.timeBasis,
        "currencyTotals" to v.currencyTotals.map { mapOf("currency" to it.currency, "confirmedMinorUnits" to it.confirmedMinorUnits.toString(), "provisionalMinorUnits" to it.provisionalMinorUnits.toString(), "confirmedCount" to it.confirmedCount, "provisionalCount" to it.provisionalCount) },
        "dailyTotals" to v.dailyTotals.map { mapOf("date" to it.date, "currency" to it.currency, "confirmedMinorUnits" to it.confirmedMinorUnits.toString(), "provisionalMinorUnits" to it.provisionalMinorUnits.toString()) },
        "reviewCount" to v.reviewCount, "excludedCount" to v.excludedCount, "from" to v.from, "to" to v.to, "includeProvisional" to v.includeProvisional,
        "timeZone" to v.timeZone, "asOf" to v.asOf, "sourceCoverage" to v.sourceCoverage.map { mapOf("source" to it.key, "count" to it.value) },
        "reportingCurrency" to v.reportingCurrency, "convertedTotals" to v.convertedTotals?.let { mapOf("confirmedMinorUnits" to it.confirmedMinorUnits.toString(), "provisionalMinorUnits" to it.provisionalMinorUnits.toString(), "confirmedCount" to it.confirmedCount, "provisionalCount" to it.provisionalCount) },
        "convertedDailyTotals" to v.convertedDailyTotals.map { mapOf("date" to it.date, "confirmedMinorUnits" to it.confirmedMinorUnits.toString(), "provisionalMinorUnits" to it.provisionalMinorUnits.toString()) },
        "fx" to v.fx.let { mapOf("provider" to it.provider, "complete" to it.complete, "unavailableSourceCurrencies" to it.unavailableSourceCurrencies, "lockedDateCount" to it.lockedDateCount,
            "earliest" to it.observedDateRange.earliest, "latest" to it.observedDateRange.latest,
            "chineseBankBand" to it.chineseBankBand?.let { b -> mapOf("eligible" to b.eligible, "currency" to b.currency, "baseMinorUnits" to b.baseMinorUnits.toString(), "lowerMinorUnits" to b.lowerMinorUnits.toString(), "upperMinorUnits" to b.upperMinorUnits.toString(), "percentageBasisPoints" to b.percentageBasisPoints) }) })
    fun stream(v: RecurringStreamDto) = mapOf("id" to v.id, "accountId" to v.accountId, "currency" to v.currency, "merchantName" to v.merchantName, "merchantEntityId" to v.merchantEntityId,
        "frequency" to v.frequency, "sourceFrequency" to v.sourceFrequency, "classification" to v.classification, "sourceStatus" to v.sourceStatus, "isOutflow" to v.isOutflow,
        "firstDate" to v.firstDate, "lastDate" to v.lastDate, "averageAmountMinor" to v.averageAmountMinor?.toString(), "lastAmountMinor" to v.lastAmountMinor?.toString(),
        "predictedAmountMinor" to v.predictedAmountMinor?.toString(), "predictedNextDate" to v.predictedNextDate, "sourceUpdatedAt" to v.sourceUpdatedAt, "revision" to v.revision)
    fun recurringPage(v: RecurringPageDto) = mapOf("items" to v.items.map(::stream), "nextCursor" to v.page.nextCursor, "limit" to v.page.limit, "state" to v.state,
        "checkedAt" to v.checkedAt, "sourceUpdatedAt" to v.sourceUpdatedAt, "lastError" to v.lastError?.let { "source_error" }, "coverageWarnings" to v.coverageWarnings)
    fun recurringDetail(v: RecurringDetailDto) = mapOf("stream" to stream(v.stream), "history" to v.history.map { mapOf("providerTransactionId" to it.providerTransactionId, "pendingProviderTransactionId" to it.pendingProviderTransactionId,
        "date" to it.date, "amountMinor" to it.amountMinor.toString(), "currency" to it.currency, "status" to it.status, "kind" to it.kind) }, "nextCursor" to v.page.nextCursor, "limit" to v.page.limit, "classification" to v.classification)
    private fun moneyMap(v: Map<String, Long>) = v.map { mapOf("currency" to it.key, "amountMinor" to it.value.toString()) }
    fun recurringSummary(v: RecurringSummaryDto) = mapOf("monthlyByCurrency" to moneyMap(v.monthlyByCurrency), "yearlyByCurrency" to moneyMap(v.yearlyByCurrency), "subscriptionByCurrency" to moneyMap(v.subscriptionByCurrency),
        "actualCostByCurrency" to moneyMap(v.actualCostByCurrency), "upcoming" to v.upcoming.map { mapOf("stream" to stream(it.stream), "nextExpectedAmountMinor" to it.nextExpectedAmountMinor?.toString()) },
        "latestPaymentChanges" to v.latestPaymentChanges.map(::stream), "streamCount" to v.streamCount, "coverageWarnings" to v.coverageWarnings, "checkedAt" to v.checkedAt, "sourceUpdatedAt" to v.sourceUpdatedAt, "lastError" to v.lastError?.let { "source_error" }, "state" to v.state)
    fun money(v: ReviewMoney) = mapOf("currency" to v.currency, "amountMinor" to v.amountMinor.toString())
    fun reviewPage(v: ReviewPageDto) = mapOf("items" to v.items.map(::alert), "nextCursor" to v.nextCursor, "limit" to v.limit)
    fun alert(v: ReviewAlertDto): Map<String, Any?> = mapOf("eventId" to v.eventId, "eventType" to v.eventType, "state" to v.state, "countedMoney" to v.countedMoney?.let(::money),
        "reportingDate" to v.reportingDate, "revision" to v.revision, "reasonCodes" to v.reasonCodes,
        "sourceEvidence" to v.sourceEvidence?.let { mapOf("sourceProfileId" to it.sourceProfileId, "parserVersion" to it.parserVersion, "eventTimeBasis" to it.eventTimeBasis, "capturedAt" to it.capturedAt, "notificationPostedAt" to it.notificationPostedAt, "bankReference" to it.bankReference, "merchant" to it.merchant, "eventMoney" to it.eventMoney?.let(::money)) },
        "provenance" to v.provenance.map { mapOf("sourceKind" to it.sourceKind, "sourceId" to it.sourceId, "basis" to it.basis, "revision" to it.revision) }, "affectedMoney" to v.affectedMoney?.let(::money),
        "candidates" to v.candidates.map { c -> mapOf("id" to c.id, "statementTransactionId" to c.statementTransactionId, "candidateTransactionId" to c.candidateTransactionId, "score" to c.score, "reasonCodes" to c.reasonCodes, "status" to c.status, "evidenceBasis" to c.evidenceBasis, "relation" to c.relation?.wireValue,
            "targetTransaction" to c.targetTransaction.let { mapOf("id" to it.id, "date" to it.date, "merchant" to it.merchant, "amountMinor" to it.amountMinor.toString(), "currency" to it.currency, "kind" to it.kind, "status" to it.status, "source" to it.source) }) },
        "links" to v.links.map { mapOf("id" to it.id, "targetEventId" to it.targetEventId, "targetTransactionId" to it.targetTransactionId, "relation" to it.relation.wireValue, "allocatedMoney" to it.allocatedMoney?.let(::money), "evidenceBasis" to it.evidenceBasis, "revision" to it.revision) },
        "linkAction" to v.linkAction?.let { mapOf("targetId" to it.targetId, "candidateTransactionId" to it.candidateTransactionId, "relation" to it.relation.wireValue, "allocatedMoney" to it.allocatedMoney?.let(::money)) },
        "linkDisabledReason" to v.linkDisabledReason, "transactionId" to v.transactionId, "annotation" to v.annotation?.let { mapOf("transactionId" to it.transactionId, "expectedRevision" to it.expectedRevision, "category" to it.category, "note" to it.note) }, "annotationDisabledReason" to v.annotationDisabledReason)
    fun account(v: BankAccount) = mapOf("providerAccountId" to v.providerAccountId, "name" to v.name, "mask" to v.mask, "subtype" to v.subtype, "currency" to v.currency, "kind" to v.kind)
    fun accountPage(v: AccountPage) = mapOf("accounts" to v.accounts.map(::account), "nextCursor" to v.nextCursor, "limit" to v.limit)
    fun lunchFlowConnection(v: com.lofuyu.borderledger.accounts.LunchFlowConnection) = mapOf(
        "userId" to v.userId,"ledgerId" to v.ledgerId,"connectionId" to v.connectionId,"generation" to v.generation?.toDouble(),
        "adapter" to v.adapter,"configured" to v.configured,"connected" to v.connected,"reconnectRequired" to v.reconnectRequired,
        "canReconnect" to v.canReconnect,"remoteRevocation" to v.remoteRevocation,"reason" to v.reason,"retryable" to v.retryable)
    fun lunchFlowAccounts(v: LunchFlowAccounts) = mapOf("connectionId" to v.connectionId,"generation" to v.generation.toDouble(),"configured" to v.configured, "accounts" to v.accounts.map { account ->
        mapOf("providerAccountId" to account.providerAccountId, "name" to account.name, "institution" to account.institution,
            "connectionId" to account.connectionId,"providerBankConnectionId" to account.providerBankConnectionId,"lastAttemptAt" to account.lastAttemptAt,"currencies" to account.currencies, "selected" to account.selected, "accountId" to account.accountId,
            "kind" to account.kind, "currency" to account.currency, "lastSyncedAt" to account.lastSyncedAt, "lastError" to account.lastError)
    })
    fun connection(v: ConnectionStatus) = mapOf("connectionId" to v.connectionId, "institution" to v.institution, "state" to v.state, "expiresAt" to v.expiresAt, "cleanupState" to v.cleanupState, "lastSyncedAt" to v.lastSyncedAt, "lastError" to v.lastError?.let { "source_error" })
    fun link(v: ConnectionCoordinatorState): Map<String, Any?> = mapOf("state" to when(v) {
        ConnectionCoordinatorState.Idle -> "idle"; ConnectionCoordinatorState.LoadingLink -> "loading"; ConnectionCoordinatorState.Linking -> "linking"; is ConnectionCoordinatorState.Pending -> "pending"
        is ConnectionCoordinatorState.Connected -> "connected"; ConnectionCoordinatorState.Canceled -> "canceled"; is ConnectionCoordinatorState.Unsupported -> "unsupported"; ConnectionCoordinatorState.ReconciliationRequired -> "reconciliation_required"; is ConnectionCoordinatorState.Failed -> "failed"
    }, "outcomeCode" to when(v) {
        is ConnectionCoordinatorState.Pending, is ConnectionCoordinatorState.Connected -> "success"
        ConnectionCoordinatorState.Canceled -> "canceled"
        is ConnectionCoordinatorState.Unsupported -> "unsupported"
        ConnectionCoordinatorState.ReconciliationRequired -> "reconciliation_required"
        is ConnectionCoordinatorState.Failed -> "failed"
        else -> null
    }, "operationId" to null, "canCancel" to false,
        "pendingConnectionId" to (v as? ConnectionCoordinatorState.Pending)?.operation?.pendingConnectionId,
        "connectionId" to (v as? ConnectionCoordinatorState.Connected)?.operation?.connectionId,
        "accounts" to (v as? ConnectionCoordinatorState.Pending)?.accounts.orEmpty().map(::account))
    fun capture(v: CaptureOnboardingState) = mapOf("health" to v.health.name, "apiHealth" to v.apiHealth.name,
        "profiles" to v.profiles.map { mapOf("sourceProfileId" to it.sourceProfileId, "displayName" to it.displayName, "accountId" to it.accountId, "instrumentLabel" to it.instrumentLabel, "currencies" to it.currencies) },
        "selectedSourceProfileId" to v.selected?.sourceProfileId, "selectedCurrency" to v.selected?.currency, "notificationAccess" to v.notificationAccess.name,
        "appNotificationPermission" to v.appNotificationPermission.name, "sourceTest" to v.sourceTest.name, "consentRecorded" to v.consentRecorded, "credentialExpiresAt" to v.credentialExpiresAt, "sourceConfigRevision" to v.sourceConfigRevision, "sourceSetupStatus" to v.sourceSetupStatus.name)
    fun mapping(v: SourceMapping) = mapOf("sourceProfileId" to v.sourceProfileId, "accountId" to v.accountId, "allowedCurrencies" to v.allowedCurrencies, "instrumentHint" to v.instrumentHint?.let { mapOf("kind" to it.kind, "value" to it.value) })
    fun captureRuntime(v: com.lofuyu.borderledger.capture.CaptureHealthState): Map<String,Any?> = mapOf(
        "listenerPermission" to v.listenerPermission.name, "listenerConnected" to v.listenerConnected, "appPostingNotificationPermission" to v.appPostingNotificationPermission.name,
        "firstUnlock" to v.firstUnlock.name, "storage" to v.storage.name, "source" to v.source.name, "intake" to v.intake.name, "upload" to v.upload.name,
        "pendingCount" to v.pendingCount, "storedIntakeCount" to v.storedIntakeCount, "pendingLimit" to v.pendingLimit,
        "uploadRetryAttempt" to v.uploadRetryAttempt, "uploadRetryMaxAttempts" to v.uploadRetryMaxAttempts,
        "uploadRetryAt" to v.uploadRetryAtMillis?.let { java.time.Instant.ofEpochMilli(it).toString() },
        "lastSuccessfulUploadAt" to v.lastSuccessfulUploadAtMillis?.let { java.time.Instant.ofEpochMilli(it).toString() },
        "lastCacheSnapshotAt" to v.lastCacheSnapshotAtMillis?.let { java.time.Instant.ofEpochMilli(it).toString() }, "pairingRenewalRequired" to v.pairingRenewalRequired)
    fun device(v: MobileDevice) = mapOf("id" to v.id, "name" to v.name, "platform" to v.platform, "status" to v.status, "credentialExpiresAt" to v.credentialExpiresAt, "revokedAt" to v.revokedAt, "sourceMappings" to v.sourceMappings.map(::mapping), "revision" to v.revision)
    fun display(v: DeviceDisplayPreferences) = mapOf("appearanceMode" to v.appearanceMode.name, "filter" to v.filter.name, "reducedMotion" to v.reducedMotion)
    fun reporting(v: ReportingPreferences) = mapOf("reportingTimezone" to v.reportingTimezone, "weekStart" to v.weekStart, "preferredCurrency" to v.preferredCurrency, "revision" to v.revision, "updatedAt" to v.updatedAt)
    fun importDraft(v: ImportState): ImportDraft? = when(v) { is ImportState.Ready -> v.draft; is ImportState.Staging -> v.draft; is ImportState.Committing -> v.draft; is ImportState.Cancelling -> v.draft; is ImportState.Error -> v.draft; else -> null }
    fun files(i: ImportState, e: ExportState): Map<String, Any?> {
        val draft = importDraft(i)
        // Parser messages contain row/validation diagnostics, never source bytes.
        // Keep a malformed ten-MiB statement from becoming an unbounded JS array.
        val parseErrors=draft?.parseErrors.orEmpty()
        val parserDiagnostics=parseErrors.take(100) + if(parseErrors.size>100) listOf("${parseErrors.size-100} more parser errors. Correct the statement before importing again.") else emptyList()
        return mapOf("importState" to i.javaClass.simpleName.lowercase(), "exportState" to e.javaClass.simpleName.lowercase(), "previewId" to draft?.preview?.id,
            "revision" to draft?.preview?.revision, "expiresAt" to draft?.preview?.expiresAt, "rowCount" to (draft?.rows?.size ?: 0), "selectedRowCount" to (draft?.selectedRowIds?.size ?: 0),
            "duplicates" to draft?.preview?.duplicateCandidates.orEmpty().map { mapOf("id" to it.id, "statementTransactionId" to it.statementTransactionId, "candidateTransactionId" to it.candidateTransactionId, "score" to it.score, "reasonCodes" to it.reasonCodes, "status" to it.status) },
            "errors" to (parserDiagnostics + draft?.preview?.errors.orEmpty().map { it.code } + listOfNotNull((i as? ImportState.Error)?.failure?.code, (e as? ExportState.Error)?.failure?.code)),
            "importReceiptId" to (i as? ImportState.Committed)?.receipt?.receiptId, "exportReceiptId" to (e as? ExportState.Completed)?.receipt?.receiptId)
    }
    fun rows(draft: ImportDraft?, offset: Int, limit: Int): Map<String, Any?> {
        require(offset >= 0 && limit in 1..100)
        return mapOf("items" to draft?.rows.orEmpty().drop(offset).take(limit).map { mapOf("rowId" to it.rowId, "rowIndex" to it.rowIndex, "accountId" to it.accountId, "date" to it.date,
            "merchant" to it.merchant, "amountMinor" to it.amountMinor.toString(), "currency" to it.currency, "category" to it.category, "kind" to it.kind, "status" to it.status, "selected" to (it.rowId in draft!!.selectedRowIds)) }, "offset" to offset, "total" to (draft?.rows?.size ?: 0))
    }
}
