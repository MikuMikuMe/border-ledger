@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.lofuyu.borderledger.ui.export

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.exports.ExportHandoff
import com.lofuyu.borderledger.exports.ExportSelection
import com.lofuyu.borderledger.exports.ExportState
import com.lofuyu.borderledger.exports.LedgerExportCoordinator
import com.lofuyu.borderledger.exports.LedgerExportFilters
import com.lofuyu.borderledger.exports.LedgerExportRequest

/** Native export entry screen; the host owns the Android SAF/share launcher. */
@Composable
fun ExportScreen(
    coordinator: LedgerExportCoordinator,
    currentFilters: LedgerExportFilters,
    onRequestDestination: (request: LedgerExportRequest, handoff: ExportHandoff) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by coordinator.state.collectAsState()
    val request = nativeLedgerExportRequest(currentFilters)
    val isStreaming = state is ExportState.Streaming

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = { TopAppBar(title = { Text("Export ledger") }) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text("Choose exactly what to export.", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "The Worker streams canonical CSV rows, including records beyond the visible page. Android writes only to the destination you authorize.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                Text("All ledger records", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Activity filters are not shared with export yet, so this action always includes every ledger record.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "All-record export requires recent owner approval. It is not started until the Worker authorizes it.",
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Button(
                        onClick = { onRequestDestination(request, ExportHandoff.Save) },
                        enabled = !isStreaming,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("Save CSV") }
                    OutlinedButton(
                        onClick = { onRequestDestination(request, ExportHandoff.Share) },
                        enabled = !isStreaming,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("Share CSV") }
                }
            }
            item {
                when (val current = state) {
                    ExportState.Idle -> Text("No export has started.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    is ExportState.Streaming -> {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        Text("Streaming from the Worker to the selected Android destination…")
                    }
                    is ExportState.AwaitingWorkerReceipt -> Text(
                        "The file was handed to Android, but the Worker receipt has not arrived. This export is not reported as complete; retry after the owner session is available.",
                        color = MaterialTheme.colorScheme.secondary,
                    )
                    is ExportState.Completed -> Text(
                        "Export confirmed by the Worker receipt. ${current.receipt.exportedRows ?: "The returned row count is unavailable"} row(s) were handed off.",
                        color = MaterialTheme.colorScheme.primary,
                    )
                    ExportState.Cancelled -> Text("Export cancelled; no export success was reported.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    is ExportState.Error -> Text("Export was not completed. ${current.failure.message}", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

/**
 * Builds the only export request currently exposed by the native screen. The existing
 * `currentFilters` parameter remains for caller compatibility, but Activity filter state is
 * not shared with export yet and must not be represented as an empty filter.
 */
@Suppress("UNUSED_PARAMETER")
internal fun nativeLedgerExportRequest(currentFilters: LedgerExportFilters): LedgerExportRequest = LedgerExportRequest(
    selection = ExportSelection.All,
    filters = LedgerExportFilters(),
)

@Composable
fun LedgerExportScreen(
    coordinator: LedgerExportCoordinator,
    currentFilters: LedgerExportFilters,
    onRequestDestination: (request: LedgerExportRequest, handoff: ExportHandoff) -> Unit,
    modifier: Modifier = Modifier,
) = ExportScreen(coordinator, currentFilters, onRequestDestination, modifier)
