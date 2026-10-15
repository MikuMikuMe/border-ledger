package com.lofuyu.borderledger.ui.theme

import org.junit.Assert.assertEquals
import org.junit.Test

class BorderLedgerThemeTest {
    @Test
    fun systemModeUsesDynamicColorsWhenAvailable() {
        assertEquals(ThemeColorSource.DynamicDark, themeColorSource(AppearanceMode.System, systemDark = true, dynamicColorAvailable = true))
        assertEquals(ThemeColorSource.DynamicLight, themeColorSource(AppearanceMode.System, systemDark = false, dynamicColorAvailable = true))
    }

    @Test
    fun systemModeStillHonorsDarkModeBelowAndroid12() {
        assertEquals(ThemeColorSource.BrandDark, themeColorSource(AppearanceMode.System, systemDark = true, dynamicColorAvailable = false))
        assertEquals(ThemeColorSource.BrandLight, themeColorSource(AppearanceMode.System, systemDark = false, dynamicColorAvailable = false))
    }
}

