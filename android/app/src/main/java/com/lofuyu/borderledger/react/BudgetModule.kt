package com.lofuyu.borderledger.react

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.lofuyu.borderledger.react.codegen.NativeBudgetSpec
import org.json.JSONObject

class BudgetModule(context: ReactApplicationContext, private val runtime: NativeServiceRuntime) : NativeBudgetSpec(context) {
    private val bridge = BridgeSupport(runtime)
    override fun invalidate() { bridge.close(); super.invalidate() }
    override fun readSettings(promise: Promise) = bridge.call(promise) { runtime.container.budgetRepository.readSettings() }
    override fun readView(month: String, promise: Promise) = bridge.call(promise) { runtime.container.budgetRepository.readView(month) }
    override fun startWrite(operationId: String, action: String, body: String, promise: Promise) = bridge.call(promise) {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        if (action == "transfers") require(JSONObject(body).optString("id") == operationId)
        runtime.write(WriteRequest(operationId, "budget_$action", "$action:$body") {
            runtime.container.budgetRepository.write(action, body)
            null
        })
    }
}
