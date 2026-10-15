package com.lofuyu.borderledger.ui.settings

import android.content.Context
import com.lofuyu.borderledger.ui.theme.AppearanceMode

enum class DeviceFilter { All, NeedsReview, Provisional }

/** Device-only choices. These never enter the shared reporting-preferences payload. */
data class DeviceDisplayPreferences(
    val appearanceMode: AppearanceMode = AppearanceMode.System,
    val filter: DeviceFilter = DeviceFilter.All,
    val reducedMotion: Boolean = false,
)

interface DeviceDisplayPreferencesStore {
    fun read(): DeviceDisplayPreferences
    fun write(value: DeviceDisplayPreferences)
}

class SharedPreferencesDeviceDisplayPreferences(context: Context) : DeviceDisplayPreferencesStore {
    private val preferences = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    override fun read() = DeviceDisplayPreferences(
        appearanceMode = runCatching { AppearanceMode.valueOf(preferences.getString(KEY_THEME, null) ?: "System") }.getOrDefault(AppearanceMode.System),
        filter = runCatching { DeviceFilter.valueOf(preferences.getString(KEY_FILTER, null) ?: "All") }.getOrDefault(DeviceFilter.All),
        reducedMotion = preferences.getBoolean(KEY_MOTION, false),
    )

    override fun write(value: DeviceDisplayPreferences) {
        preferences.edit()
            .putString(KEY_THEME, value.appearanceMode.name)
            .putString(KEY_FILTER, value.filter.name)
            .putBoolean(KEY_MOTION, value.reducedMotion)
            .apply()
    }

    private companion object {
        const val NAME = "border_ledger_device_display_preferences"
        const val KEY_THEME = "theme"
        const val KEY_FILTER = "ledger_filter"
        const val KEY_MOTION = "reduced_motion"
    }
}
