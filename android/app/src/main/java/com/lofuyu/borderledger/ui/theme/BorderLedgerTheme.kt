package com.lofuyu.borderledger.ui.theme

import android.content.Context
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
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
private val DarkReview = Color(0xFFE6B16E)

enum class ThemeColorSource { BrandLight, BrandDark, DynamicLight, DynamicDark }

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
    surfaceTint = Teal,
    surfaceDim = Color(0xFFDAD4C9),
    surfaceBright = Color(0xFFFFFCF4),
    surfaceContainerLowest = Color(0xFFFFFDF7),
    surfaceContainerLow = Color(0xFFF7F2E8),
    surfaceContainer = Color(0xFFEFE9DE),
    surfaceContainerHigh = Color(0xFFE9E2D7),
    surfaceContainerHighest = Color(0xFFE3DCD1),
    inverseSurface = Ink,
    inverseOnSurface = Paper,
    inversePrimary = DarkTeal,
    outline = Rule,
    outlineVariant = Color(0xFFBEB7AB),
    error = Color(0xFFA83F3F),
    onError = Color.White,
    errorContainer = Color(0xFFF8DAD5),
    onErrorContainer = Color(0xFF6F1716),
    tertiary = Review,
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFF3E0B7),
    onTertiaryContainer = Ink,
    scrim = Color.Black,
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
    surfaceTint = DarkTeal,
    surfaceDim = DarkCanvas,
    surfaceBright = Color(0xFF3A4640),
    surfaceContainerLowest = Color(0xFF0B100E),
    surfaceContainerLow = Color(0xFF151E1B),
    surfaceContainer = DarkSurface,
    surfaceContainerHigh = Color(0xFF23312C),
    surfaceContainerHighest = Color(0xFF2D3A34),
    inverseSurface = DarkInk,
    inverseOnSurface = Ink,
    inversePrimary = Teal,
    outline = DarkRule,
    outlineVariant = Color(0xFF5A6B62),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    tertiary = DarkReview,
    onTertiary = Color(0xFF3E2E00),
    tertiaryContainer = Color(0xFF5A4300),
    onTertiaryContainer = Color(0xFFFFDDB2),
    scrim = Color.Black,
)

@Composable
fun BorderLedgerTheme(
    mode: AppearanceMode,
    context: Context = LocalContext.current,
    content: @Composable () -> Unit,
) {
    val dark = when (mode) {
        AppearanceMode.System -> isSystemInDarkTheme()
        AppearanceMode.Light -> false
        AppearanceMode.Dark -> true
    }
    val colorScheme = when (themeColorSource(mode, dark, Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)) {
        ThemeColorSource.DynamicDark -> dynamicColorScheme(context, dark = true)
        ThemeColorSource.DynamicLight -> dynamicColorScheme(context, dark = false)
        ThemeColorSource.BrandDark -> DarkColors
        ThemeColorSource.BrandLight -> LightColors
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}

fun themeColorSource(mode: AppearanceMode, systemDark: Boolean, dynamicColorAvailable: Boolean): ThemeColorSource = when {
    mode == AppearanceMode.System && dynamicColorAvailable && systemDark -> ThemeColorSource.DynamicDark
    mode == AppearanceMode.System && dynamicColorAvailable -> ThemeColorSource.DynamicLight
    mode == AppearanceMode.Dark || (mode == AppearanceMode.System && systemDark) -> ThemeColorSource.BrandDark
    else -> ThemeColorSource.BrandLight
}

@Composable
private fun dynamicColorScheme(context: Context, dark: Boolean): ColorScheme {
    // The SDK guard is intentionally local so lint can prove the API-level
    // requirement even though Compose chooses the actual scheme at runtime.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        return if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    }
    return if (dark) DarkColors else LightColors
}
