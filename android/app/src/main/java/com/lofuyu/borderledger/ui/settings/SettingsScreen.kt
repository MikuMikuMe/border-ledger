package com.lofuyu.borderledger.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.ui.theme.AppearanceMode

@Composable
fun SettingsScreen(
    state: SettingsState,
    devicePreferences: DeviceDisplayPreferences,
    onSaveReporting: (ReportingPreferencesUpdate) -> Unit,
    onDevicePreferencesChanged: (DeviceDisplayPreferences) -> Unit,
    onRetry: () -> Unit,
) {
    val shared = state.preferences
    var timezoneDraft by remember(shared?.revision) { mutableStateOf(shared?.reportingTimezone.orEmpty()) }
    var weekStartDraft by remember(shared?.revision) { mutableIntStateOf(shared?.weekStart ?: 1) }
    var currencyDraft by remember(shared?.revision) { mutableStateOf(shared?.preferredCurrency) }
    var currencyMenuExpanded by remember { mutableStateOf(false) }
    LazyColumn(
        modifier = Modifier.padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text("Settings", style = MaterialTheme.typography.headlineSmall) }
        if (shared == null) {
            item { Text(state.error ?: "Loading shared reporting preferences…") }
            item { Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Try again") } }
        } else {
            item { Text("Shared reporting", style = MaterialTheme.typography.titleLarge) }
            item { Text("Revision ${shared.revision}; this changes report grouping only and never rewrites original event times.") }
            item {
                OutlinedTextField(
                    value = timezoneDraft,
                    onValueChange = { timezoneDraft = it },
                    label = { Text("Reporting timezone") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(0 to "Sunday", 1 to "Monday").forEach { (day, label) ->
                        FilterChip(selected = weekStartDraft == day, onClick = { weekStartDraft = day }, label = { Text(label) })
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Total spending currency", style = MaterialTheme.typography.labelLarge)
                    Text("Choose a registered ISO target for server-locked FX totals. Source amounts remain available for audit.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Box {
                        OutlinedButton(onClick = { currencyMenuExpanded = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Text(currencyDraft ?: "Source currencies (no conversion)")
                        }
                        DropdownMenu(expanded = currencyMenuExpanded, onDismissRequest = { currencyMenuExpanded = false }) {
                            reportingCurrencyOptions().forEach { option ->
                                DropdownMenuItem(
                                    text = { Text(option ?: "Source currencies (no conversion)") },
                                    onClick = { currencyDraft = option; currencyMenuExpanded = false },
                                )
                            }
                        }
                    }
                }
            }
            item {
                Button(
                    onClick = { onSaveReporting(ReportingPreferencesUpdate(timezoneDraft.trim(), weekStartDraft, currencyDraft)) },
                    enabled = !state.saving && timezoneDraft.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text(if (state.saving) "Saving…" else "Save reporting preferences") }
            }
            state.conflictRevision?.let { revision -> item { Text("This preference changed elsewhere. Refresh at revision $revision before saving.", color = MaterialTheme.colorScheme.error) } }
        }
        item { Text("This device", style = MaterialTheme.typography.titleLarge) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AppearanceMode.entries.forEach { mode ->
                    FilterChip(selected = devicePreferences.appearanceMode == mode, onClick = { onDevicePreferencesChanged(devicePreferences.copy(appearanceMode = mode)) }, label = { Text(mode.name) })
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DeviceFilter.entries.forEach { filter ->
                    FilterChip(selected = devicePreferences.filter == filter, onClick = { onDevicePreferencesChanged(devicePreferences.copy(filter = filter)) }, label = { Text(filter.name) })
                }
            }
        }
        item { Text("Theme, filter and motion are stored only on this device.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        item {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Reduce motion")
                    Text("Disable the animated login backdrop and continuous motion.", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                }
                Switch(
                    checked = devicePreferences.reducedMotion,
                    onCheckedChange = { onDevicePreferencesChanged(devicePreferences.copy(reducedMotion = it)) },
                    modifier = Modifier.semantics {
                        contentDescription = "Reduce motion"
                        stateDescription = if (devicePreferences.reducedMotion) "On" else "Off"
                    },
                )
            }
        }
    }
}
