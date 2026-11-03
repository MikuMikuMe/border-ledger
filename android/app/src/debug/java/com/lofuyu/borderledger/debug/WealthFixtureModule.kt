package com.lofuyu.borderledger.debug

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Credential-free SAF adapter for the synthetic `.probe.wealthqa` app only.
 * It never enters the owner session or the production Wealth repository.
 */
class WealthFixtureModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {
    private val pending = ConcurrentHashMap<Int, PendingRequest>()
    private val requestCodes = AtomicInteger(WEALTH_FIXTURE_REQUEST_BASE)

    override fun getName(): String = MODULE_NAME

    override fun initialize() {
        super.initialize()
        context.addActivityEventListener(this)
    }

    override fun invalidate() {
        context.removeActivityEventListener(this)
        pending.values.forEach { it.promise.reject("fixture_unavailable", "The debug Wealth file picker was closed.") }
        pending.clear()
        super.invalidate()
    }

    @ReactMethod
    fun getLaunchScene(promise: Promise) {
        if (!isProbeBuild()) {
            promise.resolve(null)
            return
        }
        val intent = context.currentActivity?.intent
        if (intent?.action != SHOW_WEALTH_FIXTURE) {
            promise.resolve(null)
            return
        }
        promise.resolve(com.facebook.react.bridge.Arguments.createMap().apply {
            putBoolean("dark", intent.getBooleanExtra(DARK_EXTRA, false))
        })
    }

    @ReactMethod
    fun pickCsv(promise: Promise) {
        if (!isProbeBuild()) {
            promise.reject("fixture_unavailable", "The Wealth file fixture is available only in the .probe.wealthqa debug app.")
            return
        }
        launch(
            Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("text/*"),
            PendingRequest(promise, null),
        )
    }

    @ReactMethod
    fun saveDocument(content: String, fileName: String, promise: Promise) {
        if (!isProbeBuild()) {
            promise.reject("fixture_unavailable", "The Wealth file fixture is available only in the .probe.wealthqa debug app.")
            return
        }
        if (content.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES || !fileName.matches(FILE_NAME)) {
            promise.reject("fixture_invalid", "The synthetic Wealth document is invalid.")
            return
        }
        launch(
            Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("text/csv")
                .putExtra(Intent.EXTRA_TITLE, fileName),
            PendingRequest(promise, content),
        )
    }

    private fun launch(intent: Intent, request: PendingRequest) {
        val activity = context.currentActivity
        if (activity == null) {
            request.promise.reject("fixture_unavailable", "The debug Wealth file picker is not attached to an Activity.")
            return
        }
        val code = nextRequestCode()
        pending[code] = request
        try {
            activity.startActivityForResult(intent, code)
        } catch (error: Exception) {
            pending.remove(code)
            request.promise.reject("fixture_unavailable", "Android could not open the synthetic Wealth file picker.", error)
        }
    }

    private fun nextRequestCode(): Int {
        while (true) {
            val candidate = requestCodes.getAndIncrement()
            if (candidate < WEALTH_FIXTURE_REQUEST_BASE + MAX_REQUEST_CODES) return candidate
            requestCodes.compareAndSet(candidate + 1, WEALTH_FIXTURE_REQUEST_BASE)
        }
    }

    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        val request = pending.remove(requestCode) ?: return
        if (resultCode != Activity.RESULT_OK || data?.data == null) {
            request.promise.resolve(if (request.content == null) null else false)
            return
        }
        val uri = requireNotNull(data.data)
        if (request.content == null) {
            request.promise.resolve(readText(uri))
        } else {
            request.promise.resolve(writeText(uri, request.content))
        }
    }

    override fun onNewIntent(intent: Intent) = Unit

    private fun readText(uri: Uri): String? = try {
        val stream = context.contentResolver.openInputStream(uri) ?: return null
        stream.use { input -> boundedUtf8(input) }
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        null
    }

    private fun writeText(uri: Uri, content: String): Boolean = try {
        val stream = context.contentResolver.openOutputStream(uri) ?: return false
        stream.use { output -> output.write(content.toByteArray(Charsets.UTF_8)) }
        true
    } catch (_: IOException) {
        false
    } catch (_: SecurityException) {
        false
    }

    private fun boundedUtf8(input: java.io.InputStream): String? {
        val buffer = ByteArray(DEFAULT_BUFFER_BYTES)
        val output = java.io.ByteArrayOutputStream()
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_FILE_BYTES) return null
            output.write(buffer, 0, count)
        }
        return output.toByteArray().toString(Charsets.UTF_8)
    }

    private fun isProbeBuild(): Boolean = context.packageName.endsWith(".probe.wealthqa")

    private data class PendingRequest(val promise: Promise, val content: String?)

    private companion object {
        const val MODULE_NAME = "NativeWealthFixture"
        const val SHOW_WEALTH_FIXTURE = "com.lofuyu.borderledger.debug.SHOW_WEALTH_FIXTURE"
        const val DARK_EXTRA = "dark"
        const val MAX_FILE_BYTES = 2 * 1024 * 1024
        const val DEFAULT_BUFFER_BYTES = 8192
        const val WEALTH_FIXTURE_REQUEST_BASE = 2800
        const val MAX_REQUEST_CODES = 100
        val FILE_NAME = Regex("[A-Za-z0-9._-]{1,96}")
    }
}
