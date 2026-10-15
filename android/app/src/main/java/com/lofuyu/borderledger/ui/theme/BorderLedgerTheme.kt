package com.lofuyu.borderledger.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Paper = Color(0xFFF3EFE6)
private val Ink = Color(0xFF18201F)
private val MutedInk = Color(0xFF4F5C56)
private val Rule = Color(0xFFD2CCC0)
private val Teal = Color(0xFF1B6B5B)
private val Copper = Color(0xFFB04E36)
private val Review = Color(0xFF996B1F)
private val DarkCanvas = Color(0xFF101715)
private val DarkSurface = Color(0xFF18221F)
private val DarkRaised = Color(0xFF1D2925)
private val DarkInk = Color(0xFFEEF1E8)
private val DarkMuted = Color(0xFFA5B2AA)
private val DarkRule = Color(0xFF43534B)
private val DarkTeal = Color(0xFF83C9B1)
private val DarkCopper = Color(0xFFEDA087)

private val LightColors = lightColorScheme(
    primary = Teal,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD2E9DF),
    onPrimaryContainer = Ink,
    secondary = Copper,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF5D9CF),
    onSecondaryContainer = Ink,
    background = Paper,
    onBackground = Ink,
    surface = Paper,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE8E2D8),
    onSurfaceVariant = MutedInk,
    outline = Rule,
    error = Color(0xFFA83F3F),
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = DarkTeal,
    onPrimary = Color(0xFF07392E),
    primaryContainer = Color(0xFF1D5145),
    onPrimaryContainer = DarkInk,
    secondary = DarkCopper,
    onSecondary = Color(0xFF4B160C),
    secondaryContainer = Color(0xFF663126),
    onSecondaryContainer = DarkInk,
    background = DarkCanvas,
    onBackground = DarkInk,
    surface = DarkSurface,
    onSurface = DarkInk,
    surfaceVariant = DarkRaised,
    onSurfaceVariant = DarkMuted,
    outline = DarkRule,
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
)

@Composable
fun BorderLedgerTheme(
    mode: AppearanceMode,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        AppearanceMode.System -> isSystemInDarkTheme()
        AppearanceMode.Light -> false
        AppearanceMode.Dark -> true
    }
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, content = content)
}
