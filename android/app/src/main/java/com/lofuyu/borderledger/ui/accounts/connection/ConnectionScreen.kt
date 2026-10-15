@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.lofuyu.borderledger.ui.accounts.connection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.accounts.BankAccount
import com.lofuyu.borderledger.accounts.ConnectionStatus
import com.lofuyu.borderledger.bank.ConnectionCoordinatorState
import com.lofuyu.borderledger.bank.PlaidLinkCoordinator

@Composable
fun ConnectionScreen(
    coordinator: PlaidLinkCoordinator,
    state: ConnectionCoordinatorState,
    onConnect: () -> Unit,
    onConfirmSelection: (List<String>) -> Unit,
    onCancelPending: () -> Unit,
    connections: List<ConnectionStatus> = emptyList(),
    accounts: List<BankAccount> = emptyList(),
    loading: Boolean = false,
    error: String? = null,
    onSync: () -> Unit = {},
    onDisconnect: (String) -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("Bank connections") }) },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Connect a bank", style = MaterialTheme.typography.headlineSmall)
            Text("Plaid handles bank authorization. Border Ledger receives only the selected account metadata and keeps provider credentials on the Worker.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (loading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            error?.let { message ->
                Text(message, color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) { Text("Refresh bank status") }
            }
            if (!loading && connections.isEmpty()) {
                Text("No active bank connections are available.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            connections.forEach { connection ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(connection.institution ?: "Bank connection", style = MaterialTheme.typography.titleMedium)
                        Text("${connection.state} · ${connection.lastSyncedAt ?: "not synced yet"}")
                        connection.lastError?.let { Text("Provider status: $it", color = MaterialTheme.colorScheme.error) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = onSync, modifier = Modifier.weight(1f)) { Text("Request sync") }
                            OutlinedButton(onClick = { onDisconnect(connection.connectionId) }, modifier = Modifier.weight(1f)) { Text("Disconnect") }
                        }
                    }
                }
            }
            if (accounts.isNotEmpty()) {
                Text("Selected accounts", style = MaterialTheme.typography.titleLarge)
                accounts.forEach { account ->
                    Text("${account.name} · ${account.currency} · ${account.mask?.let { "••$it" } ?: "mask unavailable"}")
                }
            }
            when (state) {
                ConnectionCoordinatorState.Idle, ConnectionCoordinatorState.Canceled -> {
                    Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) { Text("Start bank connection") }
                    if (state is ConnectionCoordinatorState.Canceled) Text("Connection canceled. No account was added.")
                }
                ConnectionCoordinatorState.LoadingLink, ConnectionCoordinatorState.Linking -> {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    Text(if (state is ConnectionCoordinatorState.LoadingLink) "Preparing secure bank authorization…" else "Complete authorization with your bank…")
                }
                is ConnectionCoordinatorState.Pending -> PendingSelection(state, onConfirmSelection, onCancelPending)
                is ConnectionCoordinatorState.Connected -> {
                    Text("Bank connected", style = MaterialTheme.typography.titleLarge)
                    Text(state.operation.institution ?: "Provider connection confirmed")
                    Text("Only the accounts you selected are active. Refresh is requested separately and may remain queued.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                is ConnectionCoordinatorState.Unsupported -> {
                    Text(state.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                is ConnectionCoordinatorState.Failed -> {
                    Text(state.message, color = MaterialTheme.colorScheme.error)
                    if (state.recoverable) Button(onClick = onConnect, modifier = Modifier.fillMaxWidth()) { Text("Try again") }
                }
            }
        }
    }
}

@Composable
private fun PendingSelection(
    state: ConnectionCoordinatorState.Pending,
    onConfirmSelection: (List<String>) -> Unit,
    onCancelPending: () -> Unit,
) {
    var selected by remember(state.operation.pendingConnectionId) { mutableStateOf(emptySet<String>()) }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        item {
            Text("Choose accounts", style = MaterialTheme.typography.titleLarge)
            Text("This review expires in 15 minutes. The server will verify these IDs against the provider response.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(state.accounts, key = { it.providerAccountId }) { account ->
            AccountChoice(account, selected.contains(account.providerAccountId)) {
                selected = if (selected.contains(account.providerAccountId)) selected - account.providerAccountId else selected + account.providerAccountId
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                Button(onClick = { onConfirmSelection(selected.toList()) }, enabled = selected.isNotEmpty(), modifier = Modifier.weight(1f)) { Text("Confirm selected") }
                OutlinedButton(onClick = onCancelPending, modifier = Modifier.weight(1f)) { Text("Cancel") }
            }
        }
    }
}

@Composable
private fun AccountChoice(account: BankAccount, selected: Boolean, onToggle: () -> Unit) {
    Card(onClick = onToggle, modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(account.name, style = MaterialTheme.typography.titleMedium)
                Text(listOf(account.kind, account.currency, account.mask?.let { "••$it" }).filterNotNull().joinToString(" · "), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(if (selected) "Selected" else "Select", color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
