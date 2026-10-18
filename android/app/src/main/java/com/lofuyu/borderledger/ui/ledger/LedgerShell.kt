@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.lofuyu.borderledger.ui.ledger

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.EventRepeat
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.RateReview
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.foundation.shape.RoundedCornerShape
import com.lofuyu.borderledger.LedgerRepository
import com.lofuyu.borderledger.accounts.AccountRepository
import com.lofuyu.borderledger.api.OwnerReportQuery
import com.lofuyu.borderledger.api.OwnerTransactionQuery
import com.lofuyu.borderledger.auth.CaptureOnboardingCoordinator
import com.lofuyu.borderledger.bank.PlaidLinkCoordinator
import com.lofuyu.borderledger.exports.ExportHandoff
import com.lofuyu.borderledger.exports.LedgerExportCoordinator
import com.lofuyu.borderledger.exports.LedgerExportFilters
import com.lofuyu.borderledger.exports.LedgerExportRequest
import com.lofuyu.borderledger.imports.ImportAccount
import com.lofuyu.borderledger.imports.ImportRepository
import com.lofuyu.borderledger.local.OwnerReadCacheEntry
import com.lofuyu.borderledger.ui.export.ExportScreen
import com.lofuyu.borderledger.ui.imports.ImportScreen
import com.lofuyu.borderledger.ui.onboarding.CaptureOnboardingScreen
import com.lofuyu.borderledger.ui.about.AboutModel
import com.lofuyu.borderledger.ui.about.AboutScreen
import com.lofuyu.borderledger.ui.accounts.connection.ConnectionScreen
import com.lofuyu.borderledger.ui.accounts.connection.ConnectionViewModel
import com.lofuyu.borderledger.ui.accounts.devices.DeviceManagementScreen
import com.lofuyu.borderledger.ui.accounts.devices.DeviceManagementRepository
import com.lofuyu.borderledger.ui.accounts.devices.DeviceManagementViewModel
import com.lofuyu.borderledger.ui.recurring.RecurringDetailScreen
import com.lofuyu.borderledger.ui.recurring.RecurringScreen
import com.lofuyu.borderledger.ui.settings.DeviceDisplayPreferences
import com.lofuyu.borderledger.ui.settings.DeviceDisplayPreferencesStore
import com.lofuyu.borderledger.ui.settings.ReportingPreferencesRepository
import com.lofuyu.borderledger.ui.settings.ReportingPreferences
import com.lofuyu.borderledger.ui.settings.reportingCurrencyOptions
import com.lofuyu.borderledger.ui.settings.SettingsScreen
import com.lofuyu.borderledger.ui.settings.SettingsViewModel
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import com.lofuyu.borderledger.recurring.RecurringDetailViewModel
import com.lofuyu.borderledger.recurring.RecurringRepository
import com.lofuyu.borderledger.recurring.RecurringSummaryQuery
import com.lofuyu.borderledger.review.ReviewRepository
import com.lofuyu.borderledger.review.ReviewViewModel
import com.lofuyu.borderledger.ui.review.ReviewScreen
import java.time.LocalDate
import java.time.ZoneId
import java.time.Instant
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

@Composable
fun LedgerShell(
    repository: LedgerRepository,
    reviewRepository: ReviewRepository,
    captureOnboarding: CaptureOnboardingCoordinator,
    importRepository: ImportRepository,
    exportCoordinator: LedgerExportCoordinator,
    appearanceMode: AppearanceMode,
    onAppearanceModeChange: (AppearanceMode) -> Unit,
    onOpenListenerSettings: () -> Unit,
    onOpenAppNotificationSettings: () -> Unit,
    onSignOut: () -> Unit,
    onPickDocument: (accountId: String) -> Unit,
    onRequestExportDestination: (request: LedgerExportRequest, handoff: ExportHandoff) -> Unit,
    recurringRepository: RecurringRepository,
    accountRepository: AccountRepository,
    plaidLinkCoordinator: PlaidLinkCoordinator,
    reportingPreferencesRepository: ReportingPreferencesRepository,
    deviceManagementRepository: DeviceManagementRepository,
    deviceDisplayPreferencesStore: DeviceDisplayPreferencesStore,
    appVersion: String,
) {
    var destinationName by rememberSaveable { mutableStateOf(LedgerDestination.Overview.name) }
    var showCaptureSetup by rememberSaveable { mutableStateOf(false) }
    var reloadToken by remember { mutableStateOf(0) }
    var snapshotState by remember { mutableStateOf<SnapshotState>(SnapshotState.Loading) }
    var refreshMessage by remember { mutableStateOf<String?>(null) }
    var reportOverride by remember { mutableStateOf<LedgerReport?>(null) }
    var reportWindowName by rememberSaveable { mutableStateOf(ReportWindow.Month.name) }
    var reportIncludeProvisional by rememberSaveable { mutableStateOf(false) }
    var reportSourceCurrency by rememberSaveable { mutableStateOf<String?>(null) }
    var reportingCurrency by rememberSaveable { mutableStateOf<String?>(null) }
    var reportLoading by remember { mutableStateOf(false) }
    var reportMessage by remember { mutableStateOf<String?>(null) }
    var activityTransactions by remember { mutableStateOf<List<LedgerTransaction>?>(null) }
    var activityNextCursor by remember { mutableStateOf<String?>(null) }
    var activityLoading by remember { mutableStateOf(false) }
    var activityMessage by remember { mutableStateOf<String?>(null) }
    var recurringDetailId by rememberSaveable { mutableStateOf<String?>(null) }
    var devicePreferences by remember(deviceDisplayPreferencesStore) { mutableStateOf(deviceDisplayPreferencesStore.read()) }
    var deviceMessage by remember { mutableStateOf<String?>(null) }
    val reportQueryState = remember { ReportQueryState() }
    val scope = rememberCoroutineScope()
    val destination = LedgerDestination.valueOf(destinationName)
    val recurringViewModel = remember(recurringRepository) {
        com.lofuyu.borderledger.recurring.RecurringViewModel(recurringRepository, recurringSummaryQuery())
    }
    val recurringDetailViewModel = remember(recurringRepository) { RecurringDetailViewModel(recurringRepository) }
    val reviewViewModel = remember(reviewRepository) { ReviewViewModel(reviewRepository) }
    val connectionViewModel = remember(accountRepository) { ConnectionViewModel(accountRepository) }
    val connectionState by connectionViewModel.state.collectAsState()
    val plaidState by plaidLinkCoordinator.state.collectAsState()
    val settingsViewModel = remember(reportingPreferencesRepository) { SettingsViewModel(reportingPreferencesRepository) }
    val settingsState by settingsViewModel.state.collectAsState()
    val deviceViewModel = remember(deviceManagementRepository) { DeviceManagementViewModel(deviceManagementRepository) }
    val deviceState by deviceViewModel.state.collectAsState()
    val importAccounts = (snapshotState as? SnapshotState.Ready)?.snapshot?.accounts?.map { account ->
        ImportAccount(account.id, account.displayName, account.currencies)
    }.orEmpty()

    fun refreshOwnerSnapshot() {
        scope.launch {
            refreshMessage = null
            when (repository.refreshOwnerSnapshot()) {
                LedgerRepository.SnapshotRefreshResult.Refreshed -> reloadToken++
                LedgerRepository.SnapshotRefreshResult.NotSignedIn -> refreshMessage = "Owner sign-in is required before reading the ledger."
                LedgerRepository.SnapshotRefreshResult.Offline -> refreshMessage = "The owner snapshot could not be refreshed offline; showing the last valid cache if available."
                LedgerRepository.SnapshotRefreshResult.Unauthorized -> refreshMessage = "The owner session needs to be renewed before refreshing the ledger."
                LedgerRepository.SnapshotRefreshResult.Unavailable -> refreshMessage = "The owner read service is unavailable; no financial values were changed."
            }
        }
    }

    fun reportQuery(window: ReportWindow, includeProvisional: Boolean, sourceCurrency: String?, targetCurrency: String?): ReportQuerySpec {
        val preferences = settingsState.preferences ?: ReportingPreferences.DEFAULT
        return ReportQuerySpec(
            window = window,
            includeProvisional = includeProvisional,
            sourceCurrency = sourceCurrency,
            reportingCurrency = targetCurrency,
            reportingTimezone = preferences.reportingTimezone,
            weekStart = preferenceWeekStart(preferences.weekStart),
            preferencesRevision = preferences.revision,
        )
    }

    fun refreshOwnerReport(query: ReportQuerySpec) {
        val request = reportQueryState.begin(query)
        // Keep the visible report bound to the exact query being loaded.
        // Otherwise a fast preference change can relabel stale CAD/EUR
        // values as the newly selected currency.
        reportOverride = null
        scope.launch {
            reportLoading = true
            reportMessage = null
            val zone = runCatching { ZoneId.of(query.reportingTimezone) }.getOrDefault(ZoneId.of("America/Toronto"))
            val range = reportDateWindow(query.window, LocalDate.now(zone), query.weekStart)
            when (val result = repository.refreshOwnerReport(
                OwnerReportQuery(
                    startDate = range.startDate.toString(),
                    endDate = range.endDate.toString(),
                    includeProvisional = query.includeProvisional,
                    currency = query.sourceCurrency,
                    reportingCurrency = query.reportingCurrency,
                    timeZone = query.reportingTimezone,
                ),
            )) {
                else -> if (reportQueryState.isCurrent(request)) {
                    when (result) {
                        is LedgerRepository.ReportRefreshResult.Refreshed -> reportOverride = result.report
                        LedgerRepository.ReportRefreshResult.NotSignedIn -> reportMessage = "Owner sign-in is required before changing the report window."
                        LedgerRepository.ReportRefreshResult.Offline -> reportMessage = "The selected report is unavailable offline; retry when the owner session is online."
                        LedgerRepository.ReportRefreshResult.Unauthorized -> reportMessage = "The owner session needs to be renewed before reading this report."
                        LedgerRepository.ReportRefreshResult.Unavailable -> reportMessage = "The selected report is unavailable; no financial values were changed."
                    }
                }
            }
            if (reportQueryState.isCurrent(request)) reportLoading = false
        }
    }

    LaunchedEffect(Unit) {
        settingsViewModel.load()
    }

    LaunchedEffect(
        settingsState.preferences?.revision,
        settingsState.preferences?.preferredCurrency,
        settingsState.preferences?.reportingTimezone,
        settingsState.preferences?.weekStart,
    ) {
        val preferences = settingsState.preferences ?: return@LaunchedEffect
        val persistedTarget = preferences.preferredCurrency
        reportingCurrency = persistedTarget
        val query = reportQuery(ReportWindow.valueOf(reportWindowName), reportIncludeProvisional, reportSourceCurrency, persistedTarget)
        if (!reportQueryState.hasSameSpec(query)) refreshOwnerReport(query)
    }

    fun refreshActivity(reset: Boolean) {
        if (activityLoading) return
        val cursor = if (reset) null else activityNextCursor ?: return
        scope.launch {
            activityLoading = true
            if (reset) activityMessage = null
            when (val result = repository.readOwnerTransactions(OwnerTransactionQuery(cursor = cursor, limit = 100))) {
                is LedgerRepository.ActivityRefreshResult.Refreshed -> {
                    activityTransactions = if (reset) {
                        result.page.items
                    } else {
                        (activityTransactions.orEmpty() + result.page.items).distinctBy { it.id }
                    }
                    activityNextCursor = result.page.nextCursor
                }
                LedgerRepository.ActivityRefreshResult.NotSignedIn -> activityMessage = "Owner sign-in is required before reading Activity."
                LedgerRepository.ActivityRefreshResult.Offline -> activityMessage = "Activity is unavailable offline; showing cached rows if available."
                LedgerRepository.ActivityRefreshResult.Unauthorized -> activityMessage = "The owner session needs to be renewed before reading Activity."
                LedgerRepository.ActivityRefreshResult.Unavailable -> activityMessage = "The owner Activity service is unavailable; showing cached rows if available."
            }
            activityLoading = false
        }
    }

    fun updateActivityTransaction(updated: LedgerTransaction) {
        activityTransactions = activityTransactions?.map { if (it.id == updated.id) updated else it }
        val current = snapshotState as? SnapshotState.Ready
        if (current != null) {
            snapshotState = current.copy(snapshot = current.snapshot.copy(
                transactions = current.snapshot.transactions.map { if (it.id == updated.id) updated else it },
            ))
        }
    }

    LaunchedEffect(reloadToken) {
        reportOverride = null
        reportMessage = null
        activityTransactions = null
        activityNextCursor = null
        snapshotState = SnapshotState.Loading
        val cache = runCatching { repository.readCachedOwnerSnapshot(Instant.now()) }.getOrNull()
        snapshotState = when {
            cache == null -> SnapshotState.NoSnapshot
            else -> when (val decoded = LedgerSnapshotDecoder.decode(cache.payload)) {
                is LedgerSnapshotDecodeResult.Ready -> SnapshotState.Ready(cache, decoded.snapshot)
                is LedgerSnapshotDecodeResult.Unsupported -> SnapshotState.Unsupported(cache, decoded.message)
            }
        }
        settingsState.preferences?.let {
            refreshOwnerReport(reportQuery(ReportWindow.valueOf(reportWindowName), reportIncludeProvisional, reportSourceCurrency, reportingCurrency))
        }
    }

    LaunchedEffect(destination) {
        when (destination) {
            LedgerDestination.BankConnections -> connectionViewModel.load()
            LedgerDestination.Devices -> deviceViewModel.load()
            LedgerDestination.Settings -> Unit
            LedgerDestination.Activity -> refreshActivity(reset = true)
            else -> Unit
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, destination) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START && destination == LedgerDestination.Overview) {
                refreshOwnerReport(reportQuery(ReportWindow.valueOf(reportWindowName), reportIncludeProvisional, reportSourceCurrency, reportingCurrency))
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(destination, reportWindowName, reportIncludeProvisional, reportSourceCurrency, reportingCurrency, settingsState.preferences?.revision) {
        if (destination != LedgerDestination.Overview) return@LaunchedEffect
        while (isActive) {
            delay(15 * 60 * 1000L)
            refreshOwnerReport(reportQuery(ReportWindow.valueOf(reportWindowName), reportIncludeProvisional, reportSourceCurrency, reportingCurrency))
        }
    }

    BackHandler(enabled = showCaptureSetup) { showCaptureSetup = false }
    BackHandler(enabled = destination == LedgerDestination.RecurringDetail) {
        recurringDetailId = null
        destinationName = LedgerDestination.Recurring.name
    }
    BackHandler(enabled = destination in setOf(
        LedgerDestination.BankConnections,
        LedgerDestination.Devices,
        LedgerDestination.Settings,
        LedgerDestination.About,
        LedgerDestination.Import,
        LedgerDestination.Export,
    )) {
        destinationName = LedgerDestination.Accounts.name
    }

    if (showCaptureSetup) {
        CaptureOnboardingScreen(
            coordinator = captureOnboarding,
            onOpenListenerSettings = onOpenListenerSettings,
            onOpenAppNotificationSettings = onOpenAppNotificationSettings,
        )
        return
    }

    Scaffold(
        modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        topBar = {
            TopAppBar(
                title = { Text(destination.label) },
                actions = {
                    TextButton(onClick = onSignOut, modifier = Modifier.heightIn(min = 48.dp)) {
                        Text("Sign out")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                primaryLedgerDestinations.forEach { item ->
                    NavigationBarItem(
                        selected = item == destination,
                        onClick = { destinationName = item.name },
                        icon = { Icon(item.navigationIcon(), contentDescription = null) },
                        label = { Text(item.label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        alwaysShowLabel = true,
                        modifier = Modifier.semantics { contentDescription = "Open ${item.label}" },
                    )
                }
            }
        },
    ) { innerPadding ->
        // Keep each destination's state inside the Scaffold's safe content area.
        Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
            when (destination) {
                LedgerDestination.Overview -> OverviewDestination(
                    state = snapshotState,
                    reportOverride = reportOverride,
                    reportWindow = ReportWindow.valueOf(reportWindowName),
                    includeProvisional = reportIncludeProvisional,
                    selectedSourceCurrency = reportSourceCurrency,
                    selectedReportingCurrency = reportingCurrency,
                    reportLoading = reportLoading,
                    reportMessage = reportMessage,
                    onOpenAccounts = { destinationName = LedgerDestination.Accounts.name },
                    onReload = ::refreshOwnerSnapshot,
                    onReportChanged = { window, include, sourceCurrency, targetCurrency ->
                        reportWindowName = window.name
                        reportIncludeProvisional = include
                        reportSourceCurrency = sourceCurrency
                        reportingCurrency = targetCurrency
                        refreshOwnerReport(reportQuery(window, include, sourceCurrency, targetCurrency))
                    },
                    refreshMessage = refreshMessage,
                )
                LedgerDestination.Recurring -> RecurringScreen(
                    viewModel = recurringViewModel,
                    onOpenDetail = { id -> recurringDetailId = id; destinationName = LedgerDestination.RecurringDetail.name },
                )
                LedgerDestination.RecurringDetail -> recurringDetailId?.let { id ->
                    RecurringDetailScreen(
                        id = id,
                        viewModel = recurringDetailViewModel,
                        onBack = { recurringDetailId = null; destinationName = LedgerDestination.Recurring.name },
                        onSaveClassification = { streamId, revision, classification ->
                            recurringDetailViewModel.saveClassification(streamId, revision, classification)
                        },
                    )
                } ?: MissingSnapshotState()
                LedgerDestination.Activity -> ActivityDestination(
                    state = snapshotState,
                    remoteTransactions = activityTransactions,
                    loading = activityLoading,
                    message = activityMessage,
                    hasMore = activityNextCursor != null,
                    onRefresh = { refreshActivity(reset = true) },
                    onLoadMore = { refreshActivity(reset = false) },
                    reviewRepository = reviewRepository,
                    onTransactionUpdated = ::updateActivityTransaction,
                )
                LedgerDestination.Review -> ReviewDestination(snapshotState, reviewViewModel)
                LedgerDestination.Accounts -> AccountsDestination(
                    state = snapshotState,
                    appearanceMode = appearanceMode,
                    onAppearanceModeChange = onAppearanceModeChange,
                    onOpenCaptureSetup = { showCaptureSetup = true },
                    onReload = ::refreshOwnerSnapshot,
                    refreshMessage = refreshMessage,
                    onSignOut = onSignOut,
                    onOpenConnections = { destinationName = LedgerDestination.BankConnections.name },
                    onOpenDevices = { destinationName = LedgerDestination.Devices.name },
                    onOpenSettings = { destinationName = LedgerDestination.Settings.name },
                    onOpenAbout = { destinationName = LedgerDestination.About.name },
                    onOpenImport = { destinationName = LedgerDestination.Import.name },
                    onOpenExport = { destinationName = LedgerDestination.Export.name },
                )
                LedgerDestination.BankConnections -> ConnectionScreen(
                    coordinator = plaidLinkCoordinator,
                    state = plaidState,
                    onConnect = { scope.launch { plaidLinkCoordinator.connect() } },
                    onConfirmSelection = { ids -> scope.launch { plaidLinkCoordinator.confirmSelection(ids); connectionViewModel.load() } },
                    onCancelPending = { scope.launch { plaidLinkCoordinator.cancelPending() } },
                    connections = connectionState.connections,
                    accounts = connectionState.accounts,
                    loading = connectionState.loading,
                    error = connectionState.error,
                    onSync = connectionViewModel::sync,
                    onDisconnect = connectionViewModel::disconnect,
                    onRetry = connectionViewModel::load,
                )
                LedgerDestination.Devices -> DeviceManagementScreen(
                    state = deviceState,
                    onRetry = deviceViewModel::load,
                    onRevoke = deviceViewModel::revoke,
                    onOpenSourceConfig = { device -> deviceMessage = "Source scope editing requires an approved source mapping; no change was made for ${device.name}." },
                    onOpenCaptureAuthorization = { showCaptureSetup = true },
                    message = deviceMessage,
                )
                LedgerDestination.Settings -> SettingsScreen(
                    state = settingsState,
                    devicePreferences = devicePreferences,
                    onSaveReporting = settingsViewModel::save,
                    onDevicePreferencesChanged = { value ->
                        devicePreferences = value
                        deviceDisplayPreferencesStore.write(value)
                        if (value.appearanceMode != appearanceMode) onAppearanceModeChange(value.appearanceMode)
                    },
                    onRetry = settingsViewModel::load,
                )
                LedgerDestination.About -> AboutScreen(AboutModel(versionLabel = appVersion))
                LedgerDestination.Import -> ImportScreen(
                    repository = importRepository,
                    accounts = importAccounts,
                    onPickDocument = onPickDocument,
                    onOwnerSignIn = ::refreshOwnerSnapshot,
                )
                LedgerDestination.Export -> ExportScreen(
                    coordinator = exportCoordinator,
                    currentFilters = LedgerExportFilters(),
                    onRequestDestination = onRequestExportDestination,
                )
            }
        }
    }
}

private sealed interface SnapshotState {
    data object Loading : SnapshotState
    data object NoSnapshot : SnapshotState
    data class Unsupported(val cache: OwnerReadCacheEntry, val message: String) : SnapshotState
    data class Ready(val cache: OwnerReadCacheEntry, val snapshot: LedgerSnapshot) : SnapshotState
}

private data class ReportDailyDisplay(
    val date: String,
    val currency: String,
    val confirmedMinorUnits: Long,
    val provisionalMinorUnits: Long,
)

@Composable
private fun OverviewDestination(
    state: SnapshotState,
    reportOverride: LedgerReport?,
    reportWindow: ReportWindow,
    includeProvisional: Boolean,
    selectedSourceCurrency: String?,
    selectedReportingCurrency: String?,
    reportLoading: Boolean,
    reportMessage: String?,
    onOpenAccounts: () -> Unit,
    onReload: () -> Unit,
    onReportChanged: (ReportWindow, Boolean, String?, String?) -> Unit,
    refreshMessage: String?,
) {
    when (state) {
        SnapshotState.Loading -> LoadingState()
        SnapshotState.NoSnapshot -> MissingSnapshotState(onOpenAccounts, onReload, refreshMessage)
        is SnapshotState.Unsupported -> UnsupportedSnapshotState(state.message, onReload)
        is SnapshotState.Ready -> {
            val report = reportOverride ?: state.snapshot.report
            val availableCurrencies = (state.snapshot.transactions.map { it.currency } + report?.currencyTotals.orEmpty().map { it.currency })
                .distinct()
                .sorted()
            val sourceTotals = report?.currencyTotals
                ?.filter { selectedSourceCurrency == null || it.currency == selectedSourceCurrency }
                ?.associate { it.currency to if (includeProvisional) it.confirmedMinorUnits + it.provisionalMinorUnits else it.confirmedMinorUnits }
                ?: state.snapshot.confirmedTotals()
            val converted = if (selectedReportingCurrency != null) report?.convertedTotals else null
            val totals = if (selectedReportingCurrency != null && converted != null) {
                listOf(selectedReportingCurrency to if (includeProvisional) converted.confirmedMinorUnits + converted.provisionalMinorUnits else converted.confirmedMinorUnits)
            } else {
                sourceTotals.toList()
            }
            val dailyTotals: List<ReportDailyDisplay> = if (selectedReportingCurrency != null && report != null) {
                report.convertedDailyTotals.map { daily ->
                    ReportDailyDisplay(daily.date, selectedReportingCurrency, daily.confirmedMinorUnits, daily.provisionalMinorUnits)
                }
            } else {
                report?.dailyTotals.orEmpty()
                    .filter { selectedSourceCurrency == null || it.currency == selectedSourceCurrency }
                    .map { daily -> ReportDailyDisplay(daily.date, daily.currency, daily.confirmedMinorUnits, daily.provisionalMinorUnits) }
            }
            LedgerList {
                item {
                    Text("Owner ledger", style = MaterialTheme.typography.headlineSmall)
                    Text("Snapshot ${state.snapshot.snapshotAt} · ${state.snapshot.timeZone}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Server snapshot only; unsent capture records are not included.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        if (report == null) "Full-window report is unavailable; totals reflect the verified snapshot rows only."
                        else "${reportWindow.label} report · ${report.timeBasis} · ${report.from ?: "full history"} to ${report.to ?: "today"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    refreshMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    reportMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
                item {
                    SectionTitle("Reporting lens")
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(ReportWindow.entries, key = { it.name }) { window ->
                            FilterChip(
                                selected = reportWindow == window,
                                onClick = { onReportChanged(window, includeProvisional, selectedSourceCurrency, selectedReportingCurrency) },
                                label = { Text(window.label) },
                            )
                        }
                        item {
                            FilterChip(
                                selected = includeProvisional,
                                onClick = { onReportChanged(reportWindow, !includeProvisional, selectedSourceCurrency, selectedReportingCurrency) },
                                label = { Text("Include provisional") },
                            )
                        }
                    }
                    ActivityFilterRow(
                        label = "Currency (no FX conversion)",
                        values = availableCurrencies,
                        selected = selectedSourceCurrency,
                        onSelected = { onReportChanged(reportWindow, includeProvisional, it, selectedReportingCurrency) },
                    )
                    ReportingCurrencyFilterRow(
                        selected = selectedReportingCurrency,
                        onSelected = { onReportChanged(reportWindow, includeProvisional, selectedSourceCurrency, it) },
                    )
                    if (reportLoading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                }
                item {
                    SectionTitle(if (selectedReportingCurrency == null) "Confirmed net spending" else "Total spending in $selectedReportingCurrency")
                    if (selectedReportingCurrency != null) {
                        Text(
                            if (report?.fx?.complete == true) "Locked to purchase dates using Frankfurter daily rates."
                            else "Partial conversion; unavailable source currencies remain in the source audit below.",
                            color = if (report?.fx?.complete == true) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                        )
                        if (report?.fx?.unavailableSourceCurrencies?.isNotEmpty() == true) {
                            Text("Unavailable: ${report.fx.unavailableSourceCurrencies.joinToString()}", color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
                if (totals.isEmpty()) {
                    item { HonestEmptyState("No confirmed records are present in this snapshot.") }
                } else {
                    items(totals.toList().sortedBy { it.first }) { (currency, amount) ->
                        SummaryCard(
                            label = currency,
                            value = formatMinorUnits(amount, currency),
                            supporting = when {
                                report == null -> "Verified snapshot rows only"
                                selectedReportingCurrency != null -> if (includeProvisional) "Confirmed + provisional · server-converted target" else "Confirmed · server-converted target"
                                includeProvisional -> "Confirmed + provisional · source currency"
                                else -> "Confirmed · source currency"
                            },
                        )
                    }
                }
                item { SectionTitle("Source freshness") }
                item { Text("${state.snapshot.accounts.size} account(s) · ${state.snapshot.transactions.size} activity row(s)") }
                report?.let { fullReport ->
                    if (fullReport.reviewCount > 0) item { Text("${fullReport.reviewCount} record(s) need review.", color = MaterialTheme.colorScheme.secondary) }
                    item { SectionTitle("Daily totals") }
                    if (dailyTotals.isEmpty()) {
                        item { HonestEmptyState("No daily totals are available for this reporting lens.") }
                    } else {
                        items(dailyTotals, key = { "${it.date}:${it.currency}" }) { daily ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("${daily.date} · ${daily.currency}", style = MaterialTheme.typography.titleMedium)
                                    Text("Confirmed: ${formatMinorUnits(daily.confirmedMinorUnits, daily.currency)}")
                                    if (includeProvisional) Text("Provisional: ${formatMinorUnits(daily.provisionalMinorUnits, daily.currency)}")
                                }
                            }
                        }
                    }
                    item { SpendingChart(fullReport, includeProvisional) }
                    val chineseBankBand = fullReport.fx.chineseBankBand
                    if (selectedReportingCurrency != null && chineseBankBand != null) {
                        item { ChineseBankBandCard(chineseBankBand) }
                    }
                    if (selectedReportingCurrency != null && fullReport.currencyTotals.isNotEmpty()) {
                        item { SectionTitle("Source currency audit") }
                        items(fullReport.currencyTotals.filter { selectedSourceCurrency == null || it.currency == selectedSourceCurrency }, key = { it.currency }) { source ->
                            val amount = if (includeProvisional) source.confirmedMinorUnits + source.provisionalMinorUnits else source.confirmedMinorUnits
                            SummaryCard(
                                label = source.currency,
                                value = formatMinorUnits(amount, source.currency),
                                supporting = if (includeProvisional) "Confirmed + provisional · original source amount" else "Confirmed · original source amount",
                            )
                        }
                    }
                    if (fullReport.sourceCoverage.isNotEmpty()) {
                        item { Text("Source coverage", style = MaterialTheme.typography.titleMedium) }
                        items(fullReport.sourceCoverage.toList().sortedBy { it.first }) { (source, count) ->
                            Text("$source: $count", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                item { Spacer(Modifier.height(12.dp)); OutlinedButton(onClick = onReload, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Refresh owner snapshot") } }
            }
        }
    }
}

private fun LedgerDestination.navigationIcon() = when (this) {
    LedgerDestination.Overview -> Icons.Filled.Home
    LedgerDestination.Recurring -> Icons.Filled.EventRepeat
    LedgerDestination.Activity -> Icons.AutoMirrored.Filled.ReceiptLong
    LedgerDestination.Review -> Icons.Filled.RateReview
    LedgerDestination.Accounts -> Icons.Filled.AccountBalanceWallet
    else -> Icons.Filled.Home
}

/** Credential-free deterministic FX preview used only by the debug build. */
@Composable
fun FxReportPreviewScreen(scenario: String) {
    val normalizedScenario = scenario.trim().lowercase()
    val report = fxPreviewReport(normalizedScenario)
    val includeProvisional = normalizedScenario == "provisional"
    LedgerList {
        item {
            Text("FX report preview · ${normalizedScenario.ifBlank { "available" }}", style = MaterialTheme.typography.headlineSmall)
            Text("Debug fixture only. No owner credential, network request, or Frankfurter call is used.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        item {
            SectionTitle("Total spending in ${report.reportingCurrency ?: "source currencies"}")
            report.convertedTotals?.let { totals ->
                val amount = if (includeProvisional) totals.confirmedMinorUnits + totals.provisionalMinorUnits else totals.confirmedMinorUnits
                SummaryCard(
                    label = report.reportingCurrency ?: "Source",
                    value = formatMinorUnits(amount, report.reportingCurrency ?: "CAD"),
                    supporting = if (report.fx.complete) "Locked to purchase dates using Frankfurter daily rates." else "Partial conversion; source audit remains available.",
                )
            } ?: HonestEmptyState("No converted total is available for this fixture.")
            if (!report.fx.complete) {
                Text("Unavailable source currencies: ${report.fx.unavailableSourceCurrencies.joinToString()}", color = MaterialTheme.colorScheme.error)
            }
        }
        item { SectionTitle("Converted daily totals") }
        items(report.convertedDailyTotals, key = { it.date }) { daily ->
            SummaryCard(
                label = "${daily.date} · ${report.reportingCurrency}",
                value = formatMinorUnits(if (includeProvisional) daily.confirmedMinorUnits + daily.provisionalMinorUnits else daily.confirmedMinorUnits, report.reportingCurrency ?: "CAD"),
                supporting = if (includeProvisional) "Confirmed + provisional" else "Confirmed",
            )
        }
        report.fx.chineseBankBand?.let { band -> item { ChineseBankBandCard(band) } }
        item { SectionTitle("Source currency audit") }
        items(report.currencyTotals, key = { it.currency }) { source ->
            val amount = if (includeProvisional) source.confirmedMinorUnits + source.provisionalMinorUnits else source.confirmedMinorUnits
            SummaryCard(source.currency, formatMinorUnits(amount, source.currency), "Original source amount")
        }
    }
}

internal fun fxPreviewReport(scenario: String): LedgerReport {
    val hasBand = scenario == "boc-cny" || scenario == "boc+cny"
    val partial = scenario == "partial" || scenario == "unavailable"
    val target = "CAD"
    val sources = if (hasBand) {
        listOf(
            LedgerReportCurrencyTotal("CNY", 200, 0, 1, 0),
            LedgerReportCurrencyTotal("JPY", 2100, 0, 1, 0),
        )
    } else {
        listOf(
            LedgerReportCurrencyTotal("USD", 15000, if (scenario == "provisional") 2500 else 0, 2, if (scenario == "provisional") 1 else 0),
            LedgerReportCurrencyTotal("CAD", 7200, 0, 1, 0),
        )
    }
    val confirmed = if (scenario == "refund") -200L else if (hasBand) 900L else 34800L
    val provisional = if (scenario == "provisional") 50L else 0L
    return LedgerReport(
        timeBasis = "accounting_date",
        currencyTotals = sources,
        dailyTotals = emptyList(),
        reviewCount = if (partial) 1 else 0,
        excludedCount = 0,
        from = "2026-10-01",
        to = "2026-10-14",
        includeProvisional = scenario == "provisional",
        timeZone = "America/Toronto",
        asOf = "2026-10-14T12:00:00Z",
        sourceCoverage = mapOf("statement" to sources.size),
        reportingCurrency = target,
        convertedTotals = if (scenario == "unavailable") null else LedgerReportConvertedTotals(confirmed, provisional, sources.size, if (provisional == 0L) 0 else 1),
        convertedDailyTotals = listOf(
            LedgerReportConvertedDailyTotal("2026-10-13", confirmed, provisional),
            LedgerReportConvertedDailyTotal("2026-10-14", if (scenario == "refund") -120 else 9800, 0),
        ),
        fx = LedgerReportFx(
            provider = "frankfurter",
            complete = !partial,
            unavailableSourceCurrencies = if (partial) listOf("EUR") else emptyList(),
            lockedDateCount = 2,
            observedDateRange = LedgerFxDateRange("2026-10-01", "2026-10-14"),
            chineseBankBand = if (hasBand) ChineseBankBand(true, target, 100, 99, 101, 150) else null,
        ),
    )
}

@Composable
private fun RecurringDestination(state: SnapshotState) {
    when (state) {
        SnapshotState.Loading -> LoadingState()
        SnapshotState.NoSnapshot -> MissingSnapshotState()
        is SnapshotState.Unsupported -> UnsupportedSnapshotState(state.message)
        is SnapshotState.Ready -> LedgerList {
            item { Text("Recurring", style = MaterialTheme.typography.headlineSmall); Text("Source-backed estimates; no estimate creates a transaction.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (state.snapshot.recurring.isEmpty()) item { HonestEmptyState("No recurring streams are present in this snapshot.") }
            items(state.snapshot.recurring, key = { it.id }) { recurring ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(recurring.label, style = MaterialTheme.typography.titleMedium)
                        Text(recurring.currency)
                        recurring.monthlyMinorUnits?.let { Text("Expected monthly: ${formatMinorUnits(it, recurring.currency)}") }
                        recurring.classification?.let { Text("Classification: $it") }
                        recurring.nextDueAt?.let { Text("Next due: $it", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityDestination(
    state: SnapshotState,
    remoteTransactions: List<LedgerTransaction>?,
    loading: Boolean,
    message: String?,
    hasMore: Boolean,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    reviewRepository: ReviewRepository,
    onTransactionUpdated: (LedgerTransaction) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var currency by rememberSaveable { mutableStateOf<String?>(null) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var status by rememberSaveable { mutableStateOf<String?>(null) }
    var source by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedTransactionId by rememberSaveable { mutableStateOf<String?>(null) }
    when {
        state is SnapshotState.Loading && remoteTransactions == null -> LoadingState()
        remoteTransactions == null && state is SnapshotState.NoSnapshot -> MissingSnapshotState()
        remoteTransactions == null && state is SnapshotState.Unsupported -> UnsupportedSnapshotState(state.message)
        else -> {
            val allTransactions = remoteTransactions ?: (state as? SnapshotState.Ready)?.snapshot?.transactions.orEmpty()
            val filters = ActivityFilters(query, currency, category, status, source)
            val transactions = allTransactions.filterTransactions(filters)
            LedgerList {
                item {
                    Text("Activity", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        if (remoteTransactions == null) "Cached owner rows; refresh when online for the full paginated Activity feed. Filters never convert unlike currencies."
                        else "Server Activity page; filters never convert unlike currencies.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    message?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    if (loading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text("Search merchant, account, status") }, modifier = Modifier.fillMaxWidth())
                    ActivityFilterRow(
                        label = "Currency",
                        values = allTransactions.map { it.currency }.distinct().sorted(),
                        selected = currency,
                        onSelected = { currency = it },
                    )
                    ActivityFilterRow(
                        label = "Category",
                        values = allTransactions.mapNotNull { it.category }.distinct().sorted(),
                        selected = category,
                        onSelected = { category = it },
                    )
                    ActivityFilterRow(
                        label = "State",
                        values = allTransactions.map { it.status }.distinct().sorted(),
                        selected = status,
                        onSelected = { status = it },
                    )
                    ActivityFilterRow(
                        label = "Source",
                        values = allTransactions.mapNotNull { it.sourceLabel }.distinct().sorted(),
                        selected = source,
                        onSelected = { source = it },
                    )
                }
                if (transactions.isEmpty()) item { HonestEmptyState("No activity matches this search.") }
                items(transactions, key = { it.id }) { transaction ->
                    Card(onClick = { selectedTransactionId = transaction.id }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(transaction.merchant ?: "Merchant unavailable", style = MaterialTheme.typography.titleMedium)
                            Text("${formatMinorUnits(transaction.signedMinorUnits, transaction.currency)} · ${transaction.currency}")
                            Text("${transaction.occurredAt} · ${transaction.status}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            transaction.accountLabel?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            transaction.sourceLabel?.let { Text("Source: $it", style = MaterialTheme.typography.bodySmall) }
                        }
                    }
                }
                if (hasMore) item {
                    OutlinedButton(onClick = onLoadMore, enabled = !loading, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(if (loading) "Loading more Activity…" else "Load more Activity")
                    }
                }
            }
            val selected = allTransactions.firstOrNull { it.id == selectedTransactionId }
            if (selected != null) {
                val dialogScope = rememberCoroutineScope()
                var draftCategory by remember(selected.id) { mutableStateOf(selected.category.orEmpty()) }
                var draftNote by remember(selected.id) { mutableStateOf(selected.note.orEmpty()) }
                var annotationError by remember(selected.id) { mutableStateOf<String?>(null) }
                var annotationSaving by remember(selected.id) { mutableStateOf(false) }
                AlertDialog(
                    onDismissRequest = { selectedTransactionId = null },
                    title = { Text("Activity detail") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(selected.merchant ?: "Merchant unavailable", style = MaterialTheme.typography.titleMedium)
                            Text("Amount: ${formatMinorUnits(selected.signedMinorUnits, selected.currency)} · ${selected.currency}")
                            Text("Occurred: ${selected.occurredAt}")
                            Text("State: ${selected.status}")
                            selected.accountLabel?.let { Text("Account: $it") }
                            selected.sourceLabel?.let { Text("Source: $it") }
                            OutlinedTextField(
                                value = draftCategory,
                                onValueChange = { draftCategory = it.take(80) },
                                label = { Text("Category") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            OutlinedTextField(
                                value = draftNote,
                                onValueChange = { draftNote = it.take(1_000) },
                                label = { Text("Note") },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            annotationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                            Text("Source evidence and report values remain server-authoritative.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    confirmButton = {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { selectedTransactionId = null }) { Text("Close") }
                            TextButton(
                                enabled = !annotationSaving && draftCategory.trim().isNotEmpty(),
                                onClick = {
                                    dialogScope.launch {
                                        annotationSaving = true
                                        annotationError = null
                                        try {
                                            val acknowledgement = reviewRepository.annotateTransaction(
                                                transactionId = selected.id,
                                                expectedRevision = selected.revision,
                                                category = draftCategory.trim(),
                                                note = draftNote.takeIf { it.isNotBlank() },
                                            )
                                            onTransactionUpdated(selected.copy(
                                                category = draftCategory.trim(),
                                                note = draftNote.takeIf { it.isNotBlank() },
                                                revision = acknowledgement.revision,
                                            ))
                                            selectedTransactionId = null
                                        } catch (_: com.lofuyu.borderledger.review.ReviewRevisionConflict) {
                                            annotationError = "This transaction changed elsewhere. Your draft is preserved; close and refresh to review the current value."
                                            onRefresh()
                                        } catch (_: com.lofuyu.borderledger.api.TransportFailure.Offline) {
                                            annotationError = "Annotation is unavailable offline; no change was applied."
                                        } catch (_: Exception) {
                                            annotationError = "Annotation could not be saved; no change was applied."
                                        } finally {
                                            annotationSaving = false
                                        }
                                    }
                                },
                            ) { Text(if (annotationSaving) "Saving…" else "Save") }
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun ReportingCurrencyFilterRow(
    selected: String?,
    onSelected: (String?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Total spending currency", style = MaterialTheme.typography.labelMedium)
        Text("Choose a target for server-locked FX totals; source amounts remain visible below.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(reportingCurrencyOptions(), key = { it ?: "source-currencies" }) { value ->
                FilterChip(
                    selected = selected == value,
                    onClick = { onSelected(value) },
                    label = { Text(value ?: "Source currencies (no conversion)", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    modifier = Modifier.semantics { contentDescription = value?.let { "Report totals in $it" } ?: "Keep totals in their source currencies" },
                )
            }
        }
    }
}

@Composable
private fun ChineseBankBandCard(band: ChineseBankBand) {
    val shape = RoundedCornerShape(12.dp)
    val outlineColor = MaterialTheme.colorScheme.outline
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .drawBehind {
                drawRoundRect(
                    color = outlineColor,
                    cornerRadius = CornerRadius(12.dp.toPx()),
                    style = Stroke(width = 2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 8f))),
                )
            }
            .semantics {
                contentDescription = "Chinese bank settlement estimate: ${formatMinorUnits(band.lowerMinorUnits, band.currency)} to ${formatMinorUnits(band.upperMinorUnits, band.currency)}; CNY spending excluded"
            },
        shape = shape,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Chinese bank settlement estimate", style = MaterialTheme.typography.titleMedium)
            Text("±1.5% Chinese bank settlement estimate; CNY spending excluded")
            Text("Range: ${formatMinorUnits(band.lowerMinorUnits, band.currency)} – ${formatMinorUnits(band.upperMinorUnits, band.currency)} ${band.currency}")
            Text("Base: ${formatMinorUnits(band.baseMinorUnits, band.currency)} ${band.currency}; rates locked to purchase dates.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ActivityFilterRow(
    label: String,
    values: List<String>,
    selected: String?,
    onSelected: (String?) -> Unit,
) {
    if (values.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                FilterChip(
                    selected = selected == null,
                    onClick = { onSelected(null) },
                    label = { Text("All") },
                )
            }
            items(values, key = { it }) { value ->
                FilterChip(
                    selected = selected == value,
                    onClick = { onSelected(if (selected == value) null else value) },
                    label = { Text(value.replace('_', ' '), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                )
            }
        }
    }
}

@Composable
private fun ReviewDestination(state: SnapshotState, reviewViewModel: ReviewViewModel) {
    val reviewState by reviewViewModel.state.collectAsState()
    LaunchedEffect(reviewViewModel) { reviewViewModel.refresh() }
    ReviewScreen(
        snapshot = (state as? SnapshotState.Ready)?.snapshot,
        state = reviewState,
        onRefresh = reviewViewModel::refresh,
        onLoadMore = reviewViewModel::loadMore,
        onResolve = reviewViewModel::resolve,
        onSaveAnnotation = reviewViewModel::saveAnnotation,
    )
}

@Composable
private fun AccountsDestination(
    state: SnapshotState,
    appearanceMode: AppearanceMode,
    onAppearanceModeChange: (AppearanceMode) -> Unit,
    onOpenCaptureSetup: () -> Unit,
    onOpenConnections: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenAbout: () -> Unit,
    onOpenImport: () -> Unit,
    onOpenExport: () -> Unit,
    onReload: () -> Unit,
    refreshMessage: String?,
    onSignOut: () -> Unit,
) {
    LedgerList {
        item { Text("Accounts", style = MaterialTheme.typography.headlineSmall); Text("Banks, capture, devices and settings live here.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (state is SnapshotState.Ready) {
            if (state.snapshot.accounts.isEmpty()) item { HonestEmptyState("No owner accounts are present in this snapshot.") }
            items(state.snapshot.accounts, key = { it.id }) { account ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(account.displayName, style = MaterialTheme.typography.titleMedium)
                        account.institution?.let { Text(it) }
                        account.instrument?.let { Text(it) }
                        Text(if (account.currencies.isEmpty()) "Currency metadata unavailable" else account.currencies.joinToString())
                        account.lastSuccessfulSyncAt?.let { Text("Last successful sync: $it", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        } else {
            item { Text("Account details appear after an owner snapshot is available.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        item {
            SectionTitle("Capture and devices")
            Text("Capture is separately scoped and never grants access to the full ledger.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = onOpenCaptureSetup, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Open capture setup") }
            OutlinedButton(onClick = onOpenConnections, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Manage bank connections") }
            OutlinedButton(onClick = onOpenImport, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Import a statement") }
            OutlinedButton(onClick = onOpenExport, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Export ledger") }
            OutlinedButton(onClick = onOpenDevices, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Manage devices") }
            OutlinedButton(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Open settings") }
            OutlinedButton(onClick = onOpenAbout, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("About Border Ledger") }
            OutlinedButton(onClick = onReload, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Refresh owner snapshot") }
            refreshMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        item {
            SectionTitle("Appearance")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                AppearanceMode.entries.forEach { mode ->
                    FilterChip(selected = appearanceMode == mode, onClick = { onAppearanceModeChange(mode) }, label = { Text(mode.label) })
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)); Button(onClick = onSignOut, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Sign out and clear owner read cache") } }
    }
}

@Composable
private fun LedgerList(content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
private fun LoadingState() {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Reading the encrypted owner snapshot…", style = MaterialTheme.typography.titleLarge)
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun MissingSnapshotState(onOpenAccounts: (() -> Unit)? = null, onReload: (() -> Unit)? = null, refreshMessage: String? = null) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Owner data is not cached yet.", style = MaterialTheme.typography.headlineSmall)
        Text("This screen does not invent balances. Refresh the owner read model after a server snapshot is available, or check Accounts for capture and connection setup.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        refreshMessage?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        onOpenAccounts?.let { openAccounts ->
            OutlinedButton(onClick = openAccounts, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Open Accounts") }
        }
        onReload?.let { reload ->
            OutlinedButton(onClick = reload, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Read cache again") }
        }
    }
}

@Composable
private fun UnsupportedSnapshotState(message: String, onReload: (() -> Unit)? = null) {
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Owner snapshot unavailable", style = MaterialTheme.typography.headlineSmall)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("The cached bytes were not used because their schema or contents could not be verified.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        onReload?.let { reload ->
            OutlinedButton(onClick = reload, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Try again") }
        }
    }
}

@Composable
private fun HonestEmptyState(message: String) {
    Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun SummaryCard(label: String, value: String, supporting: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.titleMedium)
            Text(value, style = MaterialTheme.typography.headlineSmall)
            Text(supporting, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge)
}

private val AppearanceMode.label: String
    get() = when (this) {
        AppearanceMode.System -> "System"
        AppearanceMode.Light -> "Light"
        AppearanceMode.Dark -> "Dark"
    }

private fun recurringSummaryQuery(): RecurringSummaryQuery {
    val today = LocalDate.now(ZoneId.of("America/Toronto"))
    return RecurringSummaryQuery(
        startDate = today.minusYears(1).toString(),
        endDate = today.plusDays(30).toString(),
    )
}

