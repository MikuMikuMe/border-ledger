package com.lofuyu.borderledger.debug

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.ZoneId

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationProbeScreen(
    permissionGranted: Boolean,
    connected: Boolean,
    previews: List<ProbePreview>,
    exportState: ProbeExportState,
    onOpenSettings: () -> Unit,
    onExport: () -> Unit,
) {
    val deviceZone = ZoneId.systemDefault()
    MaterialTheme {
        Scaffold(topBar = { TopAppBar(title = { Text("Notification probe") }) }) { inner ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(inner),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item { Text("Debug-only · metadata only", style = MaterialTheme.typography.titleMedium) }
                item { Text("Notification access: ${if (permissionGranted) "granted" else "not granted"}") }
                item { Text("Listener: ${if (connected) "connected" else "not connected"}") }
                item {
                    Text("Android notification access can expose other apps. This probe inspects only WeChat field presence, notification representations, and platform-exposed individual timestamps. It keeps at most 20 metadata rows in memory.")
                }
                item {
                    Text("Source identification: package only (${ProbePreview.APPROVED_PACKAGE}); conversation identity is unavailable.")
                }
                item {
                    Text("Controlled source check: trigger one new alert from the known BOC conversation, confirm that visible source on the device, then compare this package-only row and its timing. This probe cannot prove BOC origin or recover dismissed history.")
                }
                item {
                    Button(onClick = onOpenSettings, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Open notification access settings")
                    }
                }
                item {
                    OutlinedButton(onClick = onExport, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Export sanitized metadata CSV")
                    }
                }
                item { Text(exportState.label) }
                item {
                    Text("No bank source or parser has been verified. Any future demo state is synthetic. Captures here do not prove automatic transaction support.")
                }
                item { Text("Recent metadata (${previews.size}/20)", style = MaterialTheme.typography.titleMedium) }
                if (previews.isEmpty()) item { Text("No WeChat notification metadata observed in this app session.") }
                items(previews.asReversed()) { preview ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        val postedTime = ProbeTimeSummary.from(preview.notificationPostedAt, deviceZone)
                        val callbackTime = ProbeTimeSummary.from(preview.callbackAt, deviceZone)
                        val representations = preview.representations
                        HorizontalDivider()
                        Text("Observation: ${preview.observationKind.label}")
                        Text("Source: ${preview.sourcePackage} · ${preview.sourceIdentification.label} · category: ${preview.category}")
                        Text("Posted: ${preview.notificationPostedAt} ms · device ${postedTime.deviceTime}")
                        Text("Callback: ${preview.callbackAt} ms · device ${callbackTime.deviceTime}")
                        Text("Device timezone: ${postedTime.deviceZone}; Toronto reporting day: ${postedTime.torontoReportingDay}")
                        Text("Title field: ${if (preview.titlePresent) "present" else "absent"}; body field: ${if (preview.bodyPresent) "present" else "absent"}")
                        Text("Representations: standard text ${if (representations.standardTextPresent) "present" else "absent"}; big text ${if (representations.bigTextPresent) "present" else "absent"}; text lines ${representations.textLineCount}${if (representations.textLinesTruncated) "+" else ""}")
                        Text("Messaging representation: ${if (representations.messagingRepresentationPresent) "present" else "absent"}; messages ${representations.messagingMessageCount}${if (representations.messagingMessagesTruncated) "+" else ""}")
                        Text(
                            if (representations.individualTimestampInspectionAvailable) {
                                "Individual timestamps exposed: ${representations.individualTimestampCount}" +
                                    (representations.individualTimestampMin?.let { min -> "; range ${min}–${representations.individualTimestampMax}" } ?: "")
                            } else {
                                "Individual timestamps: unavailable on this Android API path"
                            },
                        )
                    }
                }
            }
        }
    }
}
