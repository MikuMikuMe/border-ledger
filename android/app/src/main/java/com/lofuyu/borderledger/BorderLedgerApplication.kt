package com.lofuyu.borderledger

import android.app.Application
import android.content.Context
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import java.util.UUID

internal const val CANONICAL_DISPLAY_AXES = "'wght' 500, 'opsz' 38"

class BorderLedgerApplication : Application(), ReactApplication {
    lateinit var container: AppContainer
        private set
    val nativeServices by lazy { com.lofuyu.borderledger.react.NativeServiceRuntime(container, applicationContext) }
    private val reactInitializationLock = Any()
    @Volatile private var reactNativeInitialized = false

    override val reactHost: ReactHost by lazy {
        getDefaultReactHost(
            context = applicationContext,
            useDevSupport = BuildConfig.DEBUG,
            packageList = PackageList(this).packages.apply {
                add(com.lofuyu.borderledger.react.NativeServicePackage(nativeServices))
            },
        )
    }

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this, deviceId = deviceIdentity(this))
    }

    /** Keep workers and headless services free of React startup. */
    fun initializeReactNative() {
        if (reactNativeInitialized) return
        synchronized(reactInitializationLock) {
            if (reactNativeInitialized) return
            // The asset fallback rounds 500/600 down to regular. Registering the
            // original variable faces lets Android apply each requested weight.
            val fonts = com.facebook.react.common.assets.ReactFontManager.getInstance()
            for (family in listOf("DMSans", "Newsreader")) {
                fonts.addCustomFont(family, android.graphics.Typeface.createFromAsset(assets, "fonts/$family.ttf"))
            }
            // Match CSS optical sizing for the original 38px display heading.
            // Smaller Newsreader labels retain the original general-purpose face.
            fonts.addCustomFont("NewsreaderDisplay", android.graphics.Typeface.Builder(assets, "fonts/Newsreader.ttf")
                .setFontVariationSettings(CANONICAL_DISPLAY_AXES)
                .setWeight(500)
                .build())
            loadReactNative(this)
            reactNativeInitialized = true
        }
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
