package com.lofuyu.borderledger.ui.theme

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class AppearanceMode {
    System,
    Light,
    Dark,
}

interface ThemePreferences {
    val mode: Flow<AppearanceMode>
    suspend fun setMode(value: AppearanceMode)
}

/** Non-sensitive device preference; financial state never shares this store. */
class SharedPreferencesThemePreferences(context: Context) : ThemePreferences {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val _mode = MutableStateFlow(readMode())
    override val mode: Flow<AppearanceMode> = _mode.asStateFlow()

    override suspend fun setMode(value: AppearanceMode) {
        preferences.edit().putString(KEY_MODE, value.name).apply()
        _mode.value = value
    }

    private fun readMode(): AppearanceMode = preferences.getString(KEY_MODE, null)
        ?.let { runCatching { AppearanceMode.valueOf(it) }.getOrNull() }
        ?: AppearanceMode.System

    private companion object {
        const val PREFERENCES_NAME = "border_ledger_ui_preferences"
        const val KEY_MODE = "appearance_mode"
    }
}
