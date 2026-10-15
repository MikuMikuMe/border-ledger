package com.lofuyu.borderledger.ui.recurring

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.recurring.RecurringClassification
import com.lofuyu.borderledger.recurring.RecurringCurrencyPolicy
import com.lofuyu.borderledger.recurring.RecurringFilters
import com.lofuyu.borderledger.recurring.RecurringViewModel
import com.lofuyu.borderledger.ui.ledger.formatMinorUnits

@Composable
fun RecurringScreen(viewModel: RecurringViewModel, onOpenDetail: (String) -> Unit = {}) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(viewModel) { viewModel.load() }
    LazyColumn(
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text("Recurring", style = MaterialTheme.typography.headlineSmall)
            Text("Expected commitments stay separate from actual posted cost.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            FilterRow(state.filters, onChange = { viewModel.load(it) })
        }
        if (state.loading && state.items.isEmpty()) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth()) }
        state.error?.let { message -> item { ErrorBlock(message, onRetry = { viewModel.load(state.filters) }) } }
        if (!state.loading && state.items.isEmpty() && state.error == null) item {
            Text(emptyMessage(state.state), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.summary?.let { summary ->
            item { SummaryBlock(summary) }
            if (summary.upcoming.isNotEmpty()) {
                item { Text("Upcoming · next 30 days", style = MaterialTheme.typography.titleLarge) }
                items(summary.upcoming, key = { "upcoming-${it.stream.id}" }) { upcoming ->
                    StreamRow(upcoming.stream, "Expected ${upcoming.nextExpectedAmountMinor?.let { formatMinorUnits(it, upcoming.stream.currency) } ?: "amount unavailable"}", onOpenDetail)
                }
            }
            if (summary.latestPaymentChanges.isNotEmpty()) {
                item { Text("Latest payment changes", style = MaterialTheme.typography.titleLarge) }
                items(summary.latestPaymentChanges, key = { "change-${it.id}" }) { stream -> StreamRow(stream, "Amount changed", onOpenDetail) }
            }
        }
        items(state.items, key = { it.id }) { stream -> StreamRow(stream, "Source ${stream.sourceStatus}", onOpenDetail) }
        state.loadMoreError?.let { message -> item { ErrorBlock(message, onRetry = viewModel::loadMore) } }
        state.nextCursor?.let {
            item { OutlinedButton(onClick = viewModel::loadMore, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Load more") } }
        }
        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun FilterRow(filters: RecurringFilters, onChange: (RecurringFilters) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
        items(recurringCurrencyFilterOptions(), key = { it ?: "all-currencies" }) { currency ->
            FilterChip(selected = filters.currency == currency, onClick = { onChange(filters.copy(currency = currency)) }, label = { Text(currency ?: "All currencies") })
        }
    }
}

internal fun recurringCurrencyFilterOptions(): List<String?> = listOf(null) + RecurringCurrencyPolicy.supportedCodes

@Composable
private fun SummaryBlock(summary: com.lofuyu.borderledger.recurring.RecurringSummaryDto) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Expected monthly", style = MaterialTheme.typography.titleLarge)
        summary.monthlyByCurrency.filterValues { it != 0L }.forEach { (currency, amount) -> Text("$currency · ${formatMinorUnits(amount, currency)}") }
        if (summary.monthlyByCurrency.values.all { it == 0L }) Text("No supported expected monthly amount is available.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Actual posted cost", style = MaterialTheme.typography.titleLarge)
        summary.actualCostByCurrency.filterValues { it != 0L }.forEach { (currency, amount) -> Text("$currency · ${formatMinorUnits(amount, currency)}") }
        Text("${summary.state} · ${summary.streamCount} stream(s)", color = MaterialTheme.colorScheme.onSurfaceVariant)
        summary.coverageWarnings.forEach { Text(it, color = MaterialTheme.colorScheme.secondary) }
        summary.lastError?.let { Text("Source error: $it", color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun StreamRow(stream: com.lofuyu.borderledger.recurring.RecurringStreamDto, supporting: String, onOpenDetail: (String) -> Unit) {
    Card(onClick = { onOpenDetail(stream.id) }, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stream.merchantName ?: "Merchant unavailable", style = MaterialTheme.typography.titleMedium)
            Text("${stream.currency} · ${stream.classification}")
            stream.averageAmountMinor?.let { Text("Expected source amount: ${formatMinorUnits(it, stream.currency)}") }
            stream.predictedNextDate?.let { Text("Next expected: $it") }
            Text(supporting, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ErrorBlock(message: String, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(message, color = MaterialTheme.colorScheme.error)
        Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Try again") }
    }
}

private fun emptyMessage(state: String): String = when (state) {
    "waiting" -> "Recurring history is still being prepared."
    "incomplete" -> "Recurring history is incomplete; estimates are limited to observed coverage."
    "stale" -> "Showing the last good recurring result; the source is stale."
    "unavailable" -> "The recurring product is unavailable for this connection."
    "error" -> "The recurring source reported an error."
    else -> "No recurring streams match these filters."
}
