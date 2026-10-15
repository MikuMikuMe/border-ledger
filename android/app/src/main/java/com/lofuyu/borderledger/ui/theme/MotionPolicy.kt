package com.lofuyu.borderledger.ui.theme

import android.content.Context
import android.os.PowerManager
import android.provider.Settings

data class MotionPolicy(
    val appVisible: Boolean,
    val reducedMotion: Boolean,
    val batterySaver: Boolean,
) {
    val allowsContinuousMotion: Boolean get() = appVisible && !reducedMotion && !batterySaver
}

class MotionPolicyProvider(private val context: Context) {
    fun current(appVisible: Boolean): MotionPolicy {
        val durationScale = runCatching {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        }.getOrDefault(1f)
        val powerManager = context.getSystemService(PowerManager::class.java)
        return MotionPolicy(
            appVisible = appVisible,
            reducedMotion = durationScale == 0f,
            batterySaver = powerManager?.isPowerSaveMode == true,
        )
    }
}
