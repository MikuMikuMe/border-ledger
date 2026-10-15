package com.lofuyu.borderledger.ui.recurring

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.recurring.RecurringClassification
import com.lofuyu.borderledger.recurring.RecurringDetailState
import com.lofuyu.borderledger.recurring.RecurringDetailViewModel
import com.lofuyu.borderledger.ui.ledger.formatMinorUnits

@Composable
fun RecurringDetailScreen(
    id: String,
    viewModel: RecurringDetailViewModel,
    onBack: () -> Unit = {},
    onSaveClassification: (String, Int, String) -> Unit = { _, _, _ -> },
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(id) { viewModel.load(id) }
    when (val current = state) {
        RecurringDetailState.Loading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        is RecurringDetailState.Error -> Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(current.message, color = MaterialTheme.colorScheme.error)
            Button(onClick = onBack, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Back") }
        }
        is RecurringDetailState.Ready -> {
            val stream = current.detail.stream
            LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Text(stream.merchantName ?: "Merchant unavailable", style = MaterialTheme.typography.headlineSmall)
                    Text("${stream.currency} · Expected source history", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("Classification", style = MaterialTheme.typography.titleLarge)
                     current.saveError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    RecurringClassification.entries.forEach { classification ->
                        FilterChip(
                            selected = stream.classification == classification.wireValue,
                            onClick = { onSaveClassification(stream.id, stream.revision, classification.wireValue) },
                             enabled = !current.saving,
                            label = { Text(classification.wireValue) },
                            modifier = Modifier.padding(end = 8.dp),
                        )
                    }
                }
                item { Text("Payment history", style = MaterialTheme.typography.titleLarge) }
                if (current.detail.history.isEmpty()) item { Text("No posted or pending members are available.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(current.detail.history, key = { it.providerTransactionId }) { payment ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(formatMinorUnits(payment.amountMinor, payment.currency), style = MaterialTheme.typography.titleMedium)
                            Text("${payment.date} · ${payment.status} · ${payment.kind}")
                        }
                    }
                }
                current.detail.page.nextCursor?.let { cursor ->
                    item { Button(onClick = { viewModel.load(id, cursor) }, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Load more history") } }
                }
                item { Button(onClick = onBack, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Back") } }
            }
        }
    }
}
