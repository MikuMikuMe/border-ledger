package com.lofuyu.borderledger.ui.accounts.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * `onOpenSourceConfig` remains in the signature for shell compatibility. Until
 * the shell provides an editor and save coordinator, this screen intentionally
 * renders source scope as read-only and never invokes that callback.
 */
@Suppress("UNUSED_PARAMETER")
@Composable
fun DeviceManagementScreen(
    state: DeviceManagementState,
    onRetry: () -> Unit,
    onRevoke: (String) -> Unit,
    onOpenSourceConfig: (MobileDevice) -> Unit,
    onOpenCaptureAuthorization: (MobileDevice) -> Unit,
    message: String? = null,
) {
    LazyColumn(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text("Devices", style = MaterialTheme.typography.headlineSmall) }
        if (state.loading) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.error?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.error) } }
        message?.let { value -> item { Text(value, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
        if (state.devices.isEmpty() && !state.loading) item { Text("No paired devices are available. This screen does not invent device state.") }
        items(state.devices, key = { it.id }) { device ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(device.name, style = MaterialTheme.typography.titleMedium)
                    Text("${device.platform} · ${device.status} · revision ${device.revision}")
                    Text(device.credentialExpiresAt?.let { "Capture expires $it" } ?: "Capture is not authorized", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    val sourceScope = device.sourceScopePresentation()
                    Text("Source scope (read-only)", style = MaterialTheme.typography.titleSmall)
                    Text("Revision ${sourceScope.revision}", style = MaterialTheme.typography.bodySmall)
                    Text(sourceScope.editabilityMessage, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (sourceScope.mappings.isEmpty()) {
                        Text("No source mappings are present in the owner device snapshot.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(SOURCE_SETUP_UNAVAILABLE_REASON, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        sourceScope.mappings.forEach { mapping ->
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("Source profile: ${mapping.sourceProfileId}")
                                Text("Account: ${mapping.accountId}")
                                Text("Currencies: ${mapping.currenciesLabel}")
                                Text("Instrument: ${mapping.instrumentHintLabel}")
                            }
                        }
                    }
                    if (device.canOpenSecureCaptureSetup()) {
                        OutlinedButton(onClick = { onOpenCaptureAuthorization(device) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(CAPTURE_SETUP_ACTION_LABEL) }
                        Text(CAPTURE_SETUP_ACTION_DESCRIPTION, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (device.revokedAt == null) Button(onClick = { onRevoke(device.id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Revoke device") }
                }
            }
        }
        item { OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Refresh devices") } }
    }
}
