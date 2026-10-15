package com.lofuyu.borderledger.ui.about

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.activity.compose.BackHandler
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

data class AboutModel(
    val appName: String = "Border Ledger",
    val versionLabel: String,
    val reportingRules: String = "Reports preserve original event times; timezone and week-start preferences affect grouping only.",
)

@Composable
fun AboutScreen(model: AboutModel, onBack: (() -> Unit)? = null) {
    if (onBack != null) {
        BackHandler(onBack = onBack)
    }
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (onBack != null) {
                TextButton(onClick = onBack) { Text("Back") }
            }
            Text(model.appName, style = MaterialTheme.typography.headlineSmall)
            Text("Version ${model.versionLabel}")
            Text("Owner data and capture permissions are separate capabilities.")
            Text(model.reportingRules, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Help and privacy", style = MaterialTheme.typography.titleLarge)
            Text("Sign out clears the visible owner cache and pauses capture. Encrypted pending uploads remain queued, and offline revocation capabilities are retried when connectivity returns.")
            Text("This About screen contains no sample balances, provider credentials or provider access.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
