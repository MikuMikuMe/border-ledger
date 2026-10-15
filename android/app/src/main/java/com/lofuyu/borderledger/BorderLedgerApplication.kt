package com.lofuyu.borderledger

import android.app.Application
import android.content.Context
import java.util.UUID

class BorderLedgerApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this, deviceId = deviceIdentity(this))
    }
}

/** Stable non-secret identity required to bind the owner session to this device. */
internal fun deviceIdentity(context: Context): String {
    val preferences = context.getSharedPreferences(DEVICE_ID_PREFERENCES, Context.MODE_PRIVATE)
    val existing = preferences.getString(DEVICE_ID_KEY, null)
        ?.let { value -> runCatching { UUID.fromString(value).toString() }.getOrNull() }
    if (existing != null) return existing

    val generated = UUID.randomUUID().toString()
    check(preferences.edit().putString(DEVICE_ID_KEY, generated).commit()) {
        "The device identity could not be persisted."
    }
    return generated
}

private const val DEVICE_ID_PREFERENCES = "border_ledger_device_identity"
private const val DEVICE_ID_KEY = "device_id"
