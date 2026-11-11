package com.lofuyu.borderledger.react

import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.IllegalViewOperationException
import com.facebook.react.uimanager.UIManagerHelper

class AccessibilityFocusModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "NativeAccessibilityFocus"

    @ReactMethod
    fun focus(tag: Double) {
        UiThreadUtil.runOnUiThread {
            val id = tag.toInt()
            try {
                val view = UIManagerHelper.getUIManagerForReactTag(context, id)?.resolveView(id)
                view?.performAccessibilityAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null)
            } catch (_: IllegalViewOperationException) {
                // The target may disappear while Android is closing the dialog.
            }
        }
    }
}
