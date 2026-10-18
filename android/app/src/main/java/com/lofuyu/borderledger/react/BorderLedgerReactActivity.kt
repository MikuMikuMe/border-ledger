package com.lofuyu.borderledger.react

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.lofuyu.borderledger.BorderLedgerApplication
import com.lofuyu.borderledger.bank.OfficialPlaidLinkLauncher
import com.lofuyu.borderledger.bank.PlaidCallbackIdentity
import com.lofuyu.borderledger.bank.PlaidLinkResult
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory
import kotlinx.coroutines.launch

/** Shared production/probe host. The React runtime starts only when an Activity opens. */
abstract class BorderLedgerReactActivity : ReactActivity(), NativeServiceHost {
    protected val services get() = (application as BorderLedgerApplication).nativeServices
    private var plaid: OfficialPlaidLinkLauncher? = null
    private var documentPicker: ActivityResultLauncher<Intent>? = null
    private var plaidCallbackIdentity = PlaidCallbackIdentity()

    override fun onCreate(savedInstanceState: Bundle?) {
        (application as BorderLedgerApplication).initializeReactNative()
        // Replace only restored RN Screen fragments; retain SDK/native saved state.
        supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
        super.onCreate(savedInstanceState)
        plaidCallbackIdentity = PlaidCallbackIdentity(savedInstanceState?.getString(PLAID_OPERATION_ID))
        documentPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            services.external.noteDocumentResultReceived()
            services.scope.launch {
                runCatching {
                    services.external.handleDocumentResult(result.data?.data, result.resultCode == RESULT_OK)
                }
            }
        }
        plaid = OfficialPlaidLinkLauncher(
            activity = this,
            onOrphanedResult = { result, callbackOperationId ->
                val claimedOperationId = plaidCallbackIdentity.claim(callbackOperationId)
                services.external.notePlaidCallbackReceived(claimedOperationId)
                services.scope.launch {
                    services.external.handlePlaid(result, claimedOperationId)
                }
            },
            onResultReceived = services.external::notePlaidCallbackReceived,
        )
        services.host = this
    }

    override fun onSaveInstanceState(outState: Bundle) {
        plaidCallbackIdentity.snapshot()?.let { outState.putString(PLAID_OPERATION_ID, it) }
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        services.host = this
        services.scope.launch {
            runCatching { services.resume() }
            runCatching { services.external.noteActivityResumed() }
            val enabled = androidx.core.app.NotificationManagerCompat
                .getEnabledListenerPackages(this@BorderLedgerReactActivity).contains(packageName)
            services.container.captureOnboarding.setNotificationAccess(
                if (enabled) com.lofuyu.borderledger.auth.NotificationAccessState.Granted
                else com.lofuyu.borderledger.auth.NotificationAccessState.Missing,
            )
            services.container.captureHealth.refresh(
                this@BorderLedgerReactActivity,
                com.lofuyu.borderledger.capture.BankNotificationListenerService::class.java,
            )
            val posting = androidx.core.app.NotificationManagerCompat
                .from(this@BorderLedgerReactActivity).areNotificationsEnabled()
            services.container.captureOnboarding.setAppNotificationPermission(
                if (posting) com.lofuyu.borderledger.auth.AppNotificationPermissionState.Granted
                else com.lofuyu.borderledger.auth.AppNotificationPermissionState.Blocked,
            )
        }
    }

    override fun onDestroy() {
        if (services.host === this) services.host = null
        plaid?.releaseActivityWaiter()
        plaid = null
        super.onDestroy()
    }

    override fun openBrowser(uri: Uri) {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    private fun openCaptureSettings(appNotifications: Boolean) {
        val request = captureSettingsRequest(packageName, appNotifications)
        startActivity(Intent(request.action).apply {
            request.extras.forEach { (key, value) -> putExtra(key, value) }
        })
    }

    override fun openNotificationSettings() = openCaptureSettings(false)
    override fun openAppNotificationSettings() = openCaptureSettings(true)

    override fun launchImport(operationId: String) {
        requireNotNull(documentPicker).launch(
            Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("text/*"),
        )
    }

    override fun launchExport(operationId: String) {
        requireNotNull(documentPicker).launch(
            services.container.exportCoordinator.createSaveDocumentIntent(),
        )
    }

    override suspend fun launchPlaid(
        linkToken: String,
        operationId: String,
        onProviderLaunchStarted: suspend () -> Unit,
    ): PlaidLinkResult {
        plaidCallbackIdentity.begin(operationId)
        return try {
            requireNotNull(plaid).launch(linkToken, operationId, onProviderLaunchStarted)
        } finally {
            plaidCallbackIdentity.complete(operationId)
        }
    }

    override fun getMainComponentName(): String = "BorderLedger"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

    private companion object {
        const val PLAID_OPERATION_ID = "border_ledger_plaid_operation_id"
    }
}
