package com.lofuyu.borderledger.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.ui.theme.AppearanceMode
import com.lofuyu.borderledger.ui.theme.MotionPolicy

@Composable
fun LoginScreen(
    state: OwnerSessionState,
    appearanceMode: AppearanceMode,
    motionPolicy: MotionPolicy,
    onAppearanceModeChange: (AppearanceMode) -> Unit,
    onSignIn: (staySignedIn: Boolean, pendingDestination: String?) -> Unit,
    onAbout: () -> Unit = {},
) {
    var staySignedIn by rememberSaveable { mutableStateOf(false) }
    var appearanceExpanded by rememberSaveable { mutableStateOf(false) }
    val busy = state is OwnerSessionState.Restoring || state is OwnerSessionState.SigningIn ||
        state is OwnerSessionState.Exchanging || state is OwnerSessionState.Refreshing || state is OwnerSessionState.SigningOut

    Box(modifier = Modifier.fillMaxSize()) {
        LoginFlowBackdrop(
            modifier = Modifier.fillMaxSize(),
            motionPolicy = motionPolicy,
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("Border Ledger", style = MaterialTheme.typography.displaySmall)
            Spacer(Modifier.height(12.dp))
            Text(
                "Keep what arrived, what counted, and what still needs review on one clear line.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(28.dp))
            Button(
                onClick = { onSignIn(staySignedIn, "/capture") },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(if (busy) "Preparing secure sign-in…" else "Sign in securely")
            }
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                horizontalArrangement = Arrangement.Start,
            ) {
                Checkbox(
                    checked = staySignedIn,
                    onCheckedChange = { staySignedIn = it },
                    modifier = Modifier.semantics { contentDescription = "Stay signed in for up to 30 days" },
                )
                Spacer(Modifier.width(8.dp))
                Column(modifier = Modifier.padding(top = 10.dp)) {
                    Text("Stay signed in")
                    Text(
                        "Uses the longer owner-session window; capture access remains separately consented.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            Box {
                OutlinedButton(
                    onClick = { appearanceExpanded = true },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text("Appearance: ${appearanceMode.label}")
                }
                DropdownMenu(
                    expanded = appearanceExpanded,
                    onDismissRequest = { appearanceExpanded = false },
                ) {
                    AppearanceMode.entries.forEach { mode ->
                        DropdownMenuItem(
                            text = { Text(mode.label) },
                            onClick = {
                                appearanceExpanded = false
                                onAppearanceModeChange(mode)
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            TextButton(
                onClick = onAbout,
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text("About Border Ledger") }
            SessionMessage(state)
        }
    }
}

@Composable
private fun SessionMessage(state: OwnerSessionState) {
    val message = when (state) {
        OwnerSessionState.Restoring -> "Restoring a protected session…"
        OwnerSessionState.SigningIn -> "Opening the secure browser approval…"
        OwnerSessionState.Exchanging -> "Completing the secure return…"
        OwnerSessionState.Refreshing -> "Refreshing the owner session…"
        OwnerSessionState.SigningOut -> "Signing out and hiding financial data…"
        is OwnerSessionState.AwaitingBrowser -> "Approve access in the verified browser, then return here."
        is OwnerSessionState.SignedIn -> ""
        is OwnerSessionState.SignedOut -> when (state.reason) {
            com.lofuyu.borderledger.auth.SignedOutReason.Canceled -> "Sign-in was canceled. You can try again."
            com.lofuyu.borderledger.auth.SignedOutReason.Offline -> "Signed out locally. Remote revocation is pending until the network returns."
            else -> ""
        }
        is OwnerSessionState.Expired -> "The owner session expired. Sign in again; consented capture is not silently canceled."
        is OwnerSessionState.CallbackRejected -> "The return link could not be verified. Start sign-in again."
        is OwnerSessionState.StorageFailure -> "Secure storage is unavailable. Financial data remains locked; no reset was performed."
    }
    if (message.isNotBlank()) {
        Text(
            message,
            modifier = Modifier.padding(top = 16.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

private val AppearanceMode.label: String
    get() = when (this) {
        AppearanceMode.System -> "System"
        AppearanceMode.Light -> "Light"
        AppearanceMode.Dark -> "Dark"
    }
