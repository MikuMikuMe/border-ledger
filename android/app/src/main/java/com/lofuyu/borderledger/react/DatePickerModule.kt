package com.lofuyu.borderledger.react

import android.app.DatePickerDialog
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.time.LocalDate

class DatePickerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "NativeDatePicker"

    @ReactMethod
    fun pick(value: String, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            val activity = context.currentActivity
            if (activity == null) {
                promise.reject("no_activity", "Date picker is unavailable.")
                return@runOnUiThread
            }
            val date = runCatching { LocalDate.parse(value) }.getOrElse { LocalDate.now() }
            val dialog = DatePickerDialog(activity, { _, year, month, day ->
                promise.resolve(LocalDate.of(year, month + 1, day).toString())
            }, date.year, date.monthValue - 1, date.dayOfMonth)
            dialog.setOnCancelListener { promise.resolve(null) }
            dialog.show()
        }
    }
}
