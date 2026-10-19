package com.lofuyu.borderledger.react

import android.provider.Settings

internal data class CaptureSettingsRequest(val action: String, val extras: Map<String,String>)
internal fun captureSettingsRequest(packageName: String, appNotifications: Boolean)=
    if(appNotifications) CaptureSettingsRequest(Settings.ACTION_APP_NOTIFICATION_SETTINGS,mapOf(Settings.EXTRA_APP_PACKAGE to packageName))
    else CaptureSettingsRequest(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS,emptyMap())
