package com.lofuyu.borderledger.ui.login

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.auth.SignedOutReason
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
    val canAnimate = motionPolicy.allowsContinuousMotion

    Box(modifier = Modifier.fillMaxSize()) {
        LoginFlowBackdrop(
            modifier = Modifier.fillMaxSize(),
            motionPolicy = motionPolicy,
        )

        BoxWithConstraints(
            modifier = Modifier.fillMaxSize().safeDrawingPadding(),
        ) {
            val editorialGap = if (maxHeight < 760.dp) {
                22.dp
            } else {
                (maxHeight * 0.085f).coerceIn(40.dp, 74.dp)
            }
            val formGap = if (maxHeight < 760.dp) 22.dp else 32.dp
            val heroEnter = if (canAnimate) {
                fadeIn(tween(durationMillis = 700)) +
                    slideInVertically(tween(durationMillis = 700)) { height -> height / 24 }
            } else {
                EnterTransition.None
            }
            val formEnter = if (canAnimate) {
                fadeIn(tween(durationMillis = 720, delayMillis = 110)) +
                    slideInVertically(tween(durationMillis = 720, delayMillis = 110)) { height -> height / 26 }
            } else {
                EnterTransition.None
            }

            Column(
                modifier = Modifier
                    .align(Alignment.Center)
                    .widthIn(max = 480.dp)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 22.dp, vertical = 18.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(
                        modifier = Modifier.size(38.dp),
                        color = LoginPalette.ivory.copy(alpha = 0.08f),
                        contentColor = LoginPalette.ivory,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, LoginPalette.ivory.copy(alpha = 0.24f)),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                "B",
                                style = MaterialTheme.typography.titleLarge.copy(
                                    fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                                ),
                            )
                        }
                    }
                    Spacer(Modifier.width(11.dp))
                    Column {
                        Text(
                            "Border Ledger",
                            color = LoginPalette.ivory,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "CROSS-BORDER FINANCE",
                            color = LoginPalette.ivoryMuted,
                            style = MaterialTheme.typography.labelSmall,
                            letterSpacing = 1.35.sp,
                        )
                    }
                }

                Spacer(Modifier.height(editorialGap))

                AnimatedVisibility(visible = true, enter = heroEnter) {
                    Column {
                        Text(
                            "A clearer view,\nin every currency.",
                            color = LoginPalette.ivory,
                            style = MaterialTheme.typography.headlineLarge.copy(
                                fontFamily = androidx.compose.ui.text.font.FontFamily.Serif,
                                fontSize = 40.sp,
                                lineHeight = 42.sp,
                                letterSpacing = (-1.2).sp,
                            ),
                        )
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "One quiet place for what arrived, what counts, and what still needs a second look.",
                            modifier = Modifier.fillMaxWidth(0.94f),
                            color = LoginPalette.ivoryMuted,
                            style = MaterialTheme.typography.bodyMedium,
                            lineHeight = 21.sp,
                        )
                    }
                }

                Spacer(Modifier.height(formGap))

                AnimatedVisibility(visible = true, enter = formEnter) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = LoginPalette.paper.copy(alpha = 0.97f),
                        contentColor = LoginPalette.ink,
                        shape = RoundedCornerShape(27.dp),
                        border = BorderStroke(1.dp, LoginPalette.champagneEdge),
                        shadowElevation = 14.dp,
                        tonalElevation = 0.dp,
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp)) {
                            Text(
                                "WELCOME BACK",
                                color = LoginPalette.muted,
                                style = MaterialTheme.typography.labelMedium,
                                letterSpacing = 1.5.sp,
                            )
                            Spacer(Modifier.height(12.dp))
                            Button(
                                onClick = { onSignIn(staySignedIn, "/capture") },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = LoginPalette.forestButton,
                                    contentColor = LoginPalette.paper,
                                    disabledContainerColor = LoginPalette.forestButton.copy(alpha = 0.55f),
                                    disabledContentColor = LoginPalette.paper.copy(alpha = 0.82f),
                                ),
                            ) {
                                Text(if (busy) "Preparing secure sign-in…" else "Sign in securely")
                            }
                            Text(
                                "Approval opens in your verified browser.",
                                modifier = Modifier.padding(top = 8.dp),
                                color = LoginPalette.muted,
                                style = MaterialTheme.typography.bodySmall,
                            )

                            SessionMessage(state)

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 60.dp)
                                    .toggleable(
                                        value = staySignedIn,
                                        role = Role.Checkbox,
                                        onValueChange = { staySignedIn = it },
                                    )
                                    .semantics(mergeDescendants = true) {
                                        contentDescription = "Stay signed in for up to 30 days"
                                    },
                                horizontalArrangement = Arrangement.Start,
                                verticalAlignment = Alignment.Top,
                            ) {
                                Checkbox(
                                    checked = staySignedIn,
                                    onCheckedChange = null,
                                    modifier = Modifier.padding(top = 4.dp),
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = LoginPalette.forestButton,
                                        uncheckedColor = LoginPalette.muted,
                                        checkmarkColor = LoginPalette.paper,
                                    ),
                                )
                                Spacer(Modifier.width(8.dp))
                                Column(modifier = Modifier.padding(top = 8.dp, end = 8.dp)) {
                                    Text("Stay signed in", color = LoginPalette.ink)
                                    Text(
                                        "Uses the longer owner-session window; capture access remains separately consented.",
                                        color = LoginPalette.muted,
                                        style = MaterialTheme.typography.bodySmall,
                                        lineHeight = 17.sp,
                                    )
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box {
                                    TextButton(
                                        onClick = { appearanceExpanded = true },
                                        modifier = Modifier.heightIn(min = 48.dp),
                                        colors = ButtonDefaults.textButtonColors(
                                            contentColor = LoginPalette.forestButton,
                                        ),
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
                                Spacer(Modifier.weight(1f))
                                TextButton(
                                    onClick = onAbout,
                                    modifier = Modifier.heightIn(min = 48.dp),
                                    colors = ButtonDefaults.textButtonColors(
                                        contentColor = LoginPalette.forestButton,
                                    ),
                                ) { Text("About Border Ledger") }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
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
            SignedOutReason.Canceled -> "Sign-in was canceled. You can try again."
            SignedOutReason.Offline -> "Signed out locally. Remote revocation is pending until the network returns."
            SignedOutReason.StartFailed -> "Sign-in could not start. Check your connection and try again."
            else -> ""
        }
        is OwnerSessionState.Expired -> "The owner session expired. Sign in again; consented capture is not silently canceled."
        is OwnerSessionState.CallbackRejected -> "The return link could not be verified. Start sign-in again."
        is OwnerSessionState.StorageFailure -> "Secure storage is unavailable. Financial data remains locked; no reset was performed."
    }
    if (message.isNotBlank()) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 10.dp, bottom = 7.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
            color = LoginPalette.messageSurface,
            contentColor = LoginPalette.ink,
            shape = RoundedCornerShape(13.dp),
        ) {
            Text(
                message,
                modifier = Modifier.padding(horizontal = 13.dp, vertical = 11.dp),
                style = MaterialTheme.typography.bodySmall,
                lineHeight = 18.sp,
            )
        }
    }
}

private object LoginPalette {
    val forestButton = androidx.compose.ui.graphics.Color(0xFF174B37)
    val ivory = androidx.compose.ui.graphics.Color(0xFFF2EFE4)
    val ivoryMuted = androidx.compose.ui.graphics.Color(0xFFC1D1C6)
    val paper = androidx.compose.ui.graphics.Color(0xFFF4F0E6)
    val ink = androidx.compose.ui.graphics.Color(0xFF203A30)
    val muted = androidx.compose.ui.graphics.Color(0xFF596C61)
    val champagneEdge = androidx.compose.ui.graphics.Color(0xFFD7C9A8).copy(alpha = 0.82f)
    val messageSurface = androidx.compose.ui.graphics.Color(0xFFE9E2D3)
}

private val AppearanceMode.label: String
    get() = when (this) {
        AppearanceMode.System -> "System"
        AppearanceMode.Light -> "Light"
        AppearanceMode.Dark -> "Dark"
    }

