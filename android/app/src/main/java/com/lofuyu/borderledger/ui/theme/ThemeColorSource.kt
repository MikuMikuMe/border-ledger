package com.lofuyu.borderledger.ui.theme

enum class ThemeColorSource { BrandLight, BrandDark, DynamicLight, DynamicDark }

fun themeColorSource(mode: AppearanceMode, systemDark: Boolean, dynamicColorAvailable: Boolean): ThemeColorSource = when {
    mode == AppearanceMode.System && dynamicColorAvailable && systemDark -> ThemeColorSource.DynamicDark
    mode == AppearanceMode.System && dynamicColorAvailable -> ThemeColorSource.DynamicLight
    mode == AppearanceMode.Dark || (mode == AppearanceMode.System && systemDark) -> ThemeColorSource.BrandDark
    else -> ThemeColorSource.BrandLight
}
