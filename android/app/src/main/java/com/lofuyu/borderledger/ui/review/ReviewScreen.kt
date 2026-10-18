package com.lofuyu.borderledger.ui.review

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
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.review.ReviewAlertDto
import com.lofuyu.borderledger.review.ReviewDecision
import com.lofuyu.borderledger.review.ReviewViewState
import com.lofuyu.borderledger.review.SNAPSHOT_ANNOTATION_DISABLED_REASON
import com.lofuyu.borderledger.review.SNAPSHOT_REVIEW_ACTION_DISABLED_REASON
import com.lofuyu.borderledger.review.actionDisabledReason
import com.lofuyu.borderledger.review.annotationActionDisabledReason
import com.lofuyu.borderledger.ui.ledger.LedgerSnapshot
import com.lofuyu.borderledger.ui.ledger.formatMinorUnits

@Composable
fun ReviewScreen(
    snapshot: LedgerSnapshot?,
    state: ReviewViewState,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onResolve: (ReviewAlertDto, ReviewDecision) -> Unit,
    onSaveAnnotation: (ReviewAlertDto, String, String?) -> Unit,
) {
    val showingAuthoritative = state.hasAuthoritativeData
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Review", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Owner decisions preserve raw evidence and confirmed state.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.actionError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.actionMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            if (state.loading) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            OutlinedButton(
                onClick = onRefresh,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(if (state.loading) "Refreshing owner Review…" else "Refresh owner Review")
            }
        }

        if (showingAuthoritative) {
            if (state.items.isEmpty()) {
                item { Text("No owner alert projections are present.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                items(state.items) { alert ->
                    AuthoritativeAlertCard(alert, state, onResolve, onSaveAnnotation)
                }
            }
            state.nextCursor?.let {
                item {
                    OutlinedButton(onClick = onLoadMore, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Load more owner alerts")
                    }
                }
            }
        } else if (snapshot != null) {
            item {
                Text("Read-only cached snapshot", style = MaterialTheme.typography.titleLarge)
                Text(
                    "The owner Review API has not supplied revision-aware alert rows yet. Cached rows remain visible, but no action is wired to them.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(SNAPSHOT_REVIEW_ACTION_DISABLED_REASON, color = MaterialTheme.colorScheme.error)
                Text(SNAPSHOT_ANNOTATION_DISABLED_REASON, color = MaterialTheme.colorScheme.error)
            }
            if (snapshot.reviews.isEmpty()) {
                item { Text("No cached review items are present.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                items(snapshot.reviews) { review ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(review.reason, style = MaterialTheme.typography.titleMedium)
                            review.candidateLabel?.let { Text("Candidate: $it") }
                            val currency = review.currency
                            val affectedMinorUnits = review.affectedMinorUnits
                            if (currency != null && affectedMinorUnits != null) {
                                Text("Affected: ${formatMinorUnits(affectedMinorUnits, currency)}")
                            }
                            Text("Status: ${review.status}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Keep separate — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Ignore — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text("Category/note annotation — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        } else if (!state.loading) {
            item {
                Text("Owner Review data is not available.", style = MaterialTheme.typography.titleLarge)
                Text(
                    "No cached review rows are shown because the owner Review response could not be verified.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun AuthoritativeAlertCard(
    alert: ReviewAlertDto,
    state: ReviewViewState,
    onResolve: (ReviewAlertDto, ReviewDecision) -> Unit,
    onSaveAnnotation: (ReviewAlertDto, String, String?) -> Unit,
) {
    val pending = state.pendingActionKey == "alert:${alert.eventId}" || state.pendingActionKey == "annotation:${alert.eventId}"
    val keepSeparateReason = alert.actionDisabledReason(ReviewDecision.KEEP_SEPARATE)
    val ignoreReason = alert.actionDisabledReason(ReviewDecision.IGNORE)
    val linkReason = alert.actionDisabledReason(ReviewDecision.LINK)
    val classifyReason = alert.actionDisabledReason(ReviewDecision.CLASSIFY)
    val annotationReason = alert.annotationActionDisabledReason()
    var category by remember(alert.eventId, alert.annotation?.expectedRevision) {
        mutableStateOf(alert.annotation?.category.orEmpty())
    }
    var note by remember(alert.eventId, alert.annotation?.expectedRevision) {
        mutableStateOf(alert.annotation?.note.orEmpty())
    }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(alert.eventType, style = MaterialTheme.typography.titleMedium)
            Text("State: ${alert.state}")
            alert.reportingDate?.let { Text("Reporting date: $it") }
            alert.countedMoney?.let {
                Text("Counted: ${formatMinorUnits(it.amountMinor, it.currency)} · ${it.currency}")
            }
            alert.affectedMoney?.let {
                Text("Affected: ${formatMinorUnits(it.amountMinor, it.currency)} · ${it.currency}")
            }
            if (alert.reasonCodes.isNotEmpty()) {
                Text("Reason codes: ${alert.reasonCodes.joinToString()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            alert.sourceEvidence?.let { evidence ->
                Text(
                    "Source: ${evidence.sourceProfileId} · ${evidence.parserVersion} · ${evidence.eventTimeBasis}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                evidence.merchant?.let { Text("Source merchant: $it") }
                evidence.bankReference?.let { Text("Bank reference: $it") }
            }
            if (alert.provenance.isNotEmpty()) {
                Text(
                    "Provenance: ${alert.provenance.joinToString { "${it.sourceKind}/${it.sourceId} · ${it.basis} · r${it.revision}" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (alert.candidates.isEmpty()) {
                Text(
                    "Candidate transaction comparison: no bounded candidate transactions were returned.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text("Candidate transaction comparison", style = MaterialTheme.typography.titleSmall)
                alert.candidates.forEach { candidate ->
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${candidate.targetTransaction.merchant} · ${candidate.targetTransaction.date}")
                        Text(
                            "Target: ${candidate.targetTransaction.id} · candidate: ${candidate.candidateTransactionId}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "${formatMinorUnits(candidate.targetTransaction.amountMinor, candidate.targetTransaction.currency)} · ${candidate.targetTransaction.currency} · score ${candidate.score}%",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            "Status: ${candidate.status} · evidence: ${candidate.evidenceBasis} · relation: ${candidate.relation?.wireValue ?: "unsupported"}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (candidate.reasonCodes.isNotEmpty()) {
                            Text(
                                "Reasons: ${candidate.reasonCodes.joinToString()}",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            if (alert.links.isNotEmpty()) {
                Text("Existing links", style = MaterialTheme.typography.titleSmall)
                alert.links.forEach { link ->
                    Text(
                        "${link.relation.wireValue} → ${link.targetTransactionId ?: link.targetEventId} · ${link.evidenceBasis} · r${link.revision}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Text("Revision: ${alert.revision}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                if (keepSeparateReason == null) {
                    Button(
                        onClick = { onResolve(alert, ReviewDecision.KEEP_SEPARATE) },
                        enabled = state.pendingActionKey == null,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("Keep separate") }
                } else {
                    Text("Keep separate — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (ignoreReason == null) {
                    OutlinedButton(
                        onClick = { onResolve(alert, ReviewDecision.IGNORE) },
                        enabled = state.pendingActionKey == null,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("Ignore") }
                } else {
                    Text("Ignore — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (linkReason == null) {
                Button(
                    onClick = { onResolve(alert, ReviewDecision.LINK) },
                    enabled = state.pendingActionKey == null,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text("Link candidate") }
            } else {
                Text("Link candidate — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (annotationReason == null && alert.annotation != null) {
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text("Category") },
                    singleLine = true,
                    enabled = state.pendingActionKey == null,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("Note (optional)") },
                    enabled = state.pendingActionKey == null,
                    minLines = 2,
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    onClick = { onSaveAnnotation(alert, category.trim(), note.takeIf { it.isNotBlank() }) },
                    enabled = state.pendingActionKey == null && category.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) { Text("Save category and note") }
            } else {
                Text("Category/note — disabled", color = MaterialTheme.colorScheme.onSurfaceVariant)
                annotationReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (pending) Text("Saving against revision ${alert.revision}…", color = MaterialTheme.colorScheme.primary)
            keepSeparateReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            ignoreReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            linkReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            classifyReason?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
