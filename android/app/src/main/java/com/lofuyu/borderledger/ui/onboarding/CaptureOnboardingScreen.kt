@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.lofuyu.borderledger.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Checkbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.auth.AppNotificationPermissionState
import com.lofuyu.borderledger.api.CaptureApiHealth
import com.lofuyu.borderledger.auth.CaptureHealth
import com.lofuyu.borderledger.auth.CaptureOnboardingCoordinator
import com.lofuyu.borderledger.auth.CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE
import com.lofuyu.borderledger.auth.NotificationAccessState
import com.lofuyu.borderledger.auth.SourceTestResult
import kotlinx.coroutines.launch

@Composable
fun CaptureOnboardingScreen(
    coordinator: CaptureOnboardingCoordinator,
    onOpenListenerSettings: () -> Unit,
    onOpenAppNotificationSettings: () -> Unit,
) {
    val state by coordinator.state.collectAsState()
    val scope = rememberCoroutineScope()
    var consentChecked by remember { mutableStateOf(false) }

    Scaffold(topBar = { TopAppBar(title = { Text("Capture setup") }) }) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(innerPadding),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Text("Choose exactly what Border Ledger may capture", style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Android notification access can expose notifications from other apps. Border Ledger processes only the bank sources you choose; unrelated messages are not saved or uploaded.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                Text("Approved source and instrument", style = MaterialTheme.typography.titleMedium)
            }
            if (state.profiles.isEmpty()) {
                item {
                    Text(
                        CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                items(state.profiles, key = { it.sourceProfileId }) { profile ->
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
                                contentDescription = "Select ${profile.displayName}, ${profile.instrumentLabel}"
                            },
                        ) {
                            RadioButton(
                                selected = state.selected?.sourceProfileId == profile.sourceProfileId,
                                onClick = {
                                    val currency = state.selected?.currency?.takeIf { it in profile.currencies } ?: profile.currencies.firstOrNull()
                                    if (currency != null) coordinator.select(profile, currency)
                                },
                            )
                            Column(modifier = Modifier.padding(start = 8.dp, top = 7.dp)) {
                                Text(profile.displayName)
                                Text(profile.instrumentLabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (state.selected?.sourceProfileId == profile.sourceProfileId) {
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.fillMaxWidth().padding(start = 48.dp),
                            ) {
                                items(profile.currencies, key = { it }) { currency ->
                                    FilterChip(
                                        selected = state.selected?.currency == currency,
                                        onClick = { coordinator.select(profile, currency) },
                                        label = { Text(currency) },
                                    )
                                }
                            }
                        }
                    }
                }
            }
            if (state.profiles.isEmpty()) {
                item {
                    Text("Capture API health: ${state.apiHealth.label}", style = MaterialTheme.typography.bodySmall)
                    Text("No capture authorization or renewal action is available while source setup is unavailable.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Health: ${state.health.label}", style = MaterialTheme.typography.titleMedium)
                }
            } else {
                item {
                    Text("Permission and source health", style = MaterialTheme.typography.titleMedium)
                    Text("Notification listener: ${state.notificationAccess.label}")
                    OutlinedButton(onClick = onOpenListenerSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Open notification access settings")
                    }
                    Text("App notifications for Border Ledger: ${state.appNotificationPermission.label}")
                    OutlinedButton(onClick = onOpenAppNotificationSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Open Border Ledger notification settings")
                    }
                    Text("Source test: ${state.sourceTest.label}")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = coordinator::recordSyntheticSelfTest, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Run synthetic self-test")
                        }
                        OutlinedButton(onClick = coordinator::requestSourceTest, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text("Request real source test")
                        }
                    }
                    Text(
                        "A synthetic self-test proves only local UI/parser wiring. A real request stays Awaiting until the notification listener supplies matching source, account, currency, and event evidence.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("Capture API health: ${state.apiHealth.label}", style = MaterialTheme.typography.bodySmall)
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Checkbox(checked = consentChecked, onCheckedChange = { consentChecked = it })
                        Text(
                            "I approve capture only for the selected source, instrument, and currency.",
                            modifier = Modifier.padding(start = 8.dp, top = 10.dp),
                        )
                    }
                    Button(
                        onClick = { scope.launch { coordinator.authorizeCapture(consentChecked) } },
                        enabled = state.health != CaptureHealth.Issuing,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text("Authorize selected capture source") }
                    Text("Health: ${state.health.label}", style = MaterialTheme.typography.titleMedium)
                    if (state.credentialExpiresAt != null) Text("Capture grant expires: ${state.credentialExpiresAt}")
                }
            }
        }
    }
}

private val NotificationAccessState.label: String
    get() = when (this) {
        NotificationAccessState.Unknown -> "not checked"
        NotificationAccessState.Missing -> "not granted"
        NotificationAccessState.Granted -> "granted"
    }

private val AppNotificationPermissionState.label: String
    get() = when (this) {
        AppNotificationPermissionState.Unknown -> "not checked"
        AppNotificationPermissionState.Blocked -> "blocked (capture can remain separate)"
        AppNotificationPermissionState.Granted -> "allowed"
    }

private val SourceTestResult.label: String
    get() = when (this) {
        SourceTestResult.NotRun -> "not run"
        SourceTestResult.SyntheticOnly -> "synthetic only; not accepted"
        SourceTestResult.Awaiting -> "awaiting listener evidence"
        SourceTestResult.Passed -> "real source result recorded"
        SourceTestResult.Failed -> "failed; import-only"
        SourceTestResult.Unsupported -> "unsupported; import-only"
        SourceTestResult.Unavailable -> "unavailable; import-only"
    }

private val CaptureHealth.label: String
    get() = when (this) {
        CaptureHealth.OwnerSessionRequired -> "owner sign-in required"
        CaptureHealth.SourceSelectionRequired -> "select a source, instrument, and currency"
        CaptureHealth.NotificationAccessRequired -> "notification-listener access required"
        CaptureHealth.SourceTestRequired -> "a real source test is required"
        CaptureHealth.ConsentRequired -> "explicit capture consent required"
        CaptureHealth.Issuing -> "issuing the narrow capture grant"
        CaptureHealth.Ready -> "ready for the selected scope"
        CaptureHealth.ImportOnly -> "import-only; source capability is not proven"
        CaptureHealth.Paused -> "paused"
        CaptureHealth.NeedsRenewal -> "capture grant needs renewal"
        CaptureHealth.ApiUnavailable -> "capture API unavailable; setup is limited"
        CaptureHealth.Error -> "could not protect or issue capture state"
    }

private val CaptureApiHealth.label: String
    get() = when (this) {
        CaptureApiHealth.OwnerSessionRequired -> "owner sign-in required"
        CaptureApiHealth.Checking -> "checking"
        CaptureApiHealth.NotPaired -> "not paired"
        CaptureApiHealth.Ready -> "ready"
        CaptureApiHealth.Offline -> "offline; retry when connected"
        CaptureApiHealth.Unavailable -> "unavailable; import-only fallback"
        CaptureApiHealth.Revoked -> "revoked; re-authorize explicitly"
    }
