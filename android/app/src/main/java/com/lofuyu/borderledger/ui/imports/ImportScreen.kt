@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.lofuyu.borderledger.ui.imports

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.imports.ImportAccount
import com.lofuyu.borderledger.imports.ImportDraft
import com.lofuyu.borderledger.imports.ImportRepository
import com.lofuyu.borderledger.imports.ImportState
import kotlinx.coroutines.launch

/** Native statement entry screen; document-picker launching remains a host concern. */
@Composable
fun ImportScreen(
    repository: ImportRepository,
    accounts: List<ImportAccount>,
    onPickDocument: (accountId: String) -> Unit,
    onOwnerSignIn: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val state by repository.state.collectAsState()
    val scope = rememberCoroutineScope()
    var selectedAccountId by remember(accounts) { mutableStateOf(accounts.firstOrNull()?.id.orEmpty()) }
    val draft = state.draftOrNull()
    val selectedCount = draft?.selectedRowIds?.size ?: 0

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = { TopAppBar(title = { Text("Import statement") }) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text("Review before anything enters the ledger.", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Only UTF-8 CSV statements up to 10 MiB are accepted. A preview is staged privately; existing records are unchanged until the Worker returns a commit receipt.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                Text("Owner account", style = MaterialTheme.typography.titleMedium)
                if (accounts.isEmpty()) {
                    Text("No owner accounts are available yet. Sign in or refresh the owner snapshot before importing.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = onOwnerSignIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Sign in to choose an account")
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        accounts.forEach { account ->
                            Row(
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics {
                                    contentDescription = "Select ${account.displayName}"
                                },
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(
                                    selected = selectedAccountId == account.id,
                                    onClick = { selectedAccountId = account.id },
                                )
                                Column {
                                    Text(account.displayName)
                                    if (account.currencies.isNotEmpty()) {
                                        Text(account.currencies.joinToString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            item {
                when (val currentState = state) {
                    ImportState.Idle -> OutlinedButton(
                        onClick = { if (selectedAccountId.isNotBlank()) onPickDocument(selectedAccountId) },
                        enabled = selectedAccountId.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text("Choose CSV statement") }
                    is ImportState.Previewing, is ImportState.Staging -> {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        Text("Preparing a private preview…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    is ImportState.Ready -> {
                        OutlinedButton(onClick = { onPickDocument(selectedAccountId) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Text("Choose a different statement")
                        }
                    }
                    is ImportState.Committing, is ImportState.Cancelling -> {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        Text("Waiting for the Worker receipt…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    is ImportState.Committed -> Unit
                    ImportState.Cancelled -> OutlinedButton(
                        onClick = { onPickDocument(selectedAccountId) },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text("Choose another statement") }
                    is ImportState.Error -> {
                        Text("No import was committed. ${currentState.failure.message}", color = MaterialTheme.colorScheme.error)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = { onPickDocument(selectedAccountId) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                Text("Choose again")
                            }
                            TextButton(onClick = onOwnerSignIn, modifier = Modifier.heightIn(min = 48.dp)) {
                                Text("Sign in")
                            }
                        }
                    }
                }
            }
            draft?.let { current ->
                val openCandidateCount = current.preview.duplicateCandidates.count { it.status == "open" }
                item { ImportPreviewSummary(current, repository, state is ImportState.Ready, scope) }
                items(current.rows, key = { it.rowId }) { row ->
                    val selected = row.rowId in current.selectedRowIds
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(
                                checked = selected,
                                onCheckedChange = { repository.setRowSelected(row.rowId, it) },
                                enabled = state is ImportState.Ready || state is ImportState.Error,
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(row.merchant, style = MaterialTheme.typography.titleMedium)
                                Text("${row.date} · ${row.currency} ${row.amountMinor} · ${row.category}")
                                Text("${row.status} · ${row.source}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                if (current.parseErrors.isNotEmpty()) {
                    item {
                        Text("Rows needing attention", style = MaterialTheme.typography.titleMedium)
                        current.parseErrors.forEach { error -> Text(error, color = MaterialTheme.colorScheme.error) }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = repository::selectAllRows, enabled = state is ImportState.Ready) { Text("Select all") }
                        TextButton(onClick = repository::clearSelection, enabled = state is ImportState.Ready) { Text("Clear") }
                    }
                    Button(
                        onClick = { scope.launch { repository.commit() } },
                        enabled = state is ImportState.Ready && selectedCount > 0 && openCandidateCount == 0,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text("Commit $selectedCount selected row(s)") }
                    if (openCandidateCount > 0) {
                        Text(
                            "Resolve or keep separate all $openCandidateCount duplicate candidate(s) before committing.",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    OutlinedButton(
                        onClick = { scope.launch { repository.cancel() } },
                        enabled = state is ImportState.Ready || state is ImportState.Error,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text("Cancel staged import") }
                }
            }
            item {
                when (val currentState = state) {
                    is ImportState.Committed -> {
                        val receipt = currentState.receipt
                        Text(
                            "Import confirmed by the Worker receipt. ${receipt.publishedRows} row(s) were published; duplicates: ${receipt.duplicateRows}.",
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    ImportState.Cancelled -> Text("Import cancelled. Existing ledger records were not changed.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else -> Unit
                }
            }
        }
    }
}

@Composable
private fun ImportPreviewSummary(
    draft: ImportDraft,
    repository: ImportRepository,
    decisionsEnabled: Boolean,
    scope: kotlinx.coroutines.CoroutineScope,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Worker preview", style = MaterialTheme.typography.titleMedium)
        Text("${draft.rows.size} valid row(s) · ${draft.selectedRowIds.size} selected")
        if (draft.preview.duplicateCandidates.isNotEmpty()) {
            val openCount = draft.preview.duplicateCandidates.count { it.status == "open" }
            Text(
                if (openCount > 0) "${openCount} possible duplicate(s) need a decision before commit."
                else "Duplicate decisions are recorded; no transaction is merged silently.",
                color = MaterialTheme.colorScheme.secondary,
            )
            draft.preview.duplicateCandidates.forEach { candidate ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text("Candidate comparison", style = MaterialTheme.typography.titleSmall)
                        Text("Uploaded row ${candidate.statementTransactionId} ↔ existing transaction ${candidate.candidateTransactionId}")
                        Text("Reason: ${candidate.reasonCodes.joinToString(", ")}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Score: ${candidate.score}/100 · Status: ${candidate.status}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(
                                onClick = { scope.launch { repository.decideDuplicate(candidate.id, "resolve") } },
                                enabled = decisionsEnabled && candidate.status == "open",
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) { Text(if (candidate.status == "accepted") "Resolved" else "Resolve") }
                            TextButton(
                                onClick = { scope.launch { repository.decideDuplicate(candidate.id, "keep_separate") } },
                                enabled = decisionsEnabled && candidate.status == "open",
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) { Text(if (candidate.status == "dismissed") "Kept separate" else "Keep separate") }
                        }
                        Text(
                            when (candidate.status) {
                                "accepted" -> "Resolved explicitly; the import path does not merge transactions silently."
                                "dismissed" -> "Kept separate explicitly; the candidate will not be auto-accepted."
                                else -> "Choose Resolve to acknowledge the match or Keep separate to dismiss it."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        draft.preview.errors.forEach { error ->
            Text(error.message, color = MaterialTheme.colorScheme.error)
        }
        Text("Nothing has been committed yet.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun ImportState.draftOrNull(): ImportDraft? = when (this) {
    is ImportState.Ready -> draft
    is ImportState.Staging -> draft
    is ImportState.Committing -> draft
    is ImportState.Cancelling -> draft
    is ImportState.Error -> draft
    else -> null
}

/** Alias kept descriptive for hosts that name the flow by its source document. */
@Composable
fun StatementImportScreen(
    repository: ImportRepository,
    accounts: List<ImportAccount>,
    onPickDocument: (accountId: String) -> Unit,
    onOwnerSignIn: () -> Unit = {},
    modifier: Modifier = Modifier,
) = ImportScreen(repository, accounts, onPickDocument, onOwnerSignIn, modifier)
