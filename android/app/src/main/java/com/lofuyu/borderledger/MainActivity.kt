package com.lofuyu.borderledger

import android.os.Bundle
import android.net.Uri
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.lifecycleScope
import android.content.Intent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.bank.OfficialPlaidLinkLauncher
import com.lofuyu.borderledger.exports.ContentResolverExportDestination
import com.lofuyu.borderledger.exports.ExportHandoff
import com.lofuyu.borderledger.exports.ExportState
import com.lofuyu.borderledger.exports.LedgerExportRequest
import com.lofuyu.borderledger.ui.about.AboutModel
import com.lofuyu.borderledger.ui.about.AboutScreen
import com.lofuyu.borderledger.ui.login.LoginScreen
import com.lofuyu.borderledger.ui.ledger.LedgerShell
import com.lofuyu.borderledger.ui.theme.BorderLedgerTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var container: AppContainer
    private var plaidLinkLauncher: OfficialPlaidLinkLauncher? = null
    private lateinit var importDocumentPicker: ActivityResultLauncher<Intent>
    private lateinit var exportDestinationPicker: ActivityResultLauncher<Intent>
    private var pendingImportAccountId: String? = null
    private var pendingExport: PendingExport? = null
    private var activityResumed by mutableStateOf(false)
    private var showLoginAbout by mutableStateOf(false)

    private data class PendingExport(
        val request: LedgerExportRequest,
        val handoff: ExportHandoff,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        container = (application as BorderLedgerApplication).container
        plaidLinkLauncher = OfficialPlaidLinkLauncher(this) { result ->
            lifecycleScope.launch { container.plaidLinkCoordinator.recover(result) }
        }
        container.plaidLinkCoordinator.attachLauncher(requireNotNull(plaidLinkLauncher))
        importDocumentPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val accountId = pendingImportAccountId
            pendingImportAccountId = null
            if (accountId == null) return@registerForActivityResult
            lifecycleScope.launch {
                container.importRepository.preview(
                    document = container.statementDocumentReader.read(result.data?.data),
                    accountId = accountId,
                )
            }
        }
        exportDestinationPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val pending = pendingExport
            pendingExport = null
            if (pending == null) return@registerForActivityResult
            val uri = result.data?.data
            if (result.resultCode != RESULT_OK || uri == null) {
                container.exportCoordinator.markCancelled()
                return@registerForActivityResult
            }
            lifecycleScope.launch {
                val state = container.exportCoordinator.export(
                    request = pending.request,
                    destination = ContentResolverExportDestination(contentResolver, uri),
                    handoff = pending.handoff,
                )
                if (state is ExportState.Completed && pending.handoff == ExportHandoff.Share) {
                    startActivity(container.exportCoordinator.createShareIntent(uri))
                }
            }
        }
        setContent {
            val appearance by container.themePreferences.mode.collectAsState(initial = com.lofuyu.borderledger.ui.theme.AppearanceMode.System)
            val sessionState by container.ownerSessionManager.state.collectAsState()
            LaunchedEffect(Unit) { container.ownerSessionManager.restore() }
            LaunchedEffect(sessionState) {
                container.captureOnboarding.syncOwnerSessionState()
                if (sessionState is OwnerSessionState.SignedIn) {
                    container.captureOnboarding.refreshApiHealth()
                }
            }
            BorderLedgerTheme(mode = appearance) {
                when (sessionState) {
                    is OwnerSessionState.SignedIn -> LedgerShell(
                        repository = container.ledgerRepository,
                        reviewRepository = container.reviewRepository,
                        captureOnboarding = container.captureOnboarding,
                        importRepository = container.importRepository,
                        exportCoordinator = container.exportCoordinator,
                        appearanceMode = appearance,
                        onAppearanceModeChange = { mode ->
                            lifecycleScope.launch { container.themePreferences.setMode(mode) }
                        },
                        onOpenListenerSettings = {
                            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                        },
                        onOpenAppNotificationSettings = {
                            startActivity(
                                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName),
                            )
                        },
                        onSignOut = {
                            lifecycleScope.launch { container.ownerSessionManager.signOut() }
                        },
                        onPickDocument = { accountId ->
                            pendingImportAccountId = accountId
                            importDocumentPicker.launch(container.statementDocumentReader.createOpenDocumentIntent())
                        },
                        onRequestExportDestination = { request, handoff ->
                            pendingExport = PendingExport(request, handoff)
                            exportDestinationPicker.launch(container.exportCoordinator.createSaveDocumentIntent())
                        },
                        recurringRepository = container.recurringRepository,
                        accountRepository = container.accountRepository,
                        plaidLinkCoordinator = container.plaidLinkCoordinator,
                        reportingPreferencesRepository = container.reportingPreferencesRepository,
                        deviceManagementRepository = container.deviceManagementRepository,
                        deviceDisplayPreferencesStore = container.deviceDisplayPreferencesStore,
                        appVersion = BuildConfig.VERSION_NAME,
                    )
                    else -> if (showLoginAbout) {
                        AboutScreen(
                            model = AboutModel(versionLabel = BuildConfig.VERSION_NAME),
                            onBack = { showLoginAbout = false },
                        )
                    } else {
                        LoginScreen(
                            state = sessionState,
                            appearanceMode = appearance,
                            motionPolicy = container.motionPolicyProvider.current(activityResumed),
                            onAppearanceModeChange = { mode ->
                                lifecycleScope.launch { container.themePreferences.setMode(mode) }
                            },
                            onSignIn = { staySignedIn, destination ->
                                lifecycleScope.launch {
                                    runCatching { container.ownerSessionManager.beginLogin(staySignedIn, destination) }
                                        .getOrNull()
                                        ?.let { launch -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(launch.authorizationUrl))) }
                                }
                            },
                            onAbout = { showLoginAbout = true },
                        )
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        activityResumed = true
    }

    override fun onPause() {
        activityResumed = false
        super.onPause()
    }

    override fun onDestroy() {
        plaidLinkLauncher?.let { launcher ->
            if (::container.isInitialized) container.plaidLinkCoordinator.detachLauncher(launcher)
        }
        plaidLinkLauncher = null
        super.onDestroy()
    }
}
