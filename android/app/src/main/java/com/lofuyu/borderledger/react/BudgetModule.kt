package com.lofuyu.borderledger.react

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.lofuyu.borderledger.budget.BudgetModeViewRequest
import com.lofuyu.borderledger.budget.BudgetMonth
import com.lofuyu.borderledger.budget.BudgetRolloverRequest
import com.lofuyu.borderledger.budget.BudgetWriteCommand
import com.lofuyu.borderledger.react.codegen.NativeBudgetSpec
import org.json.JSONObject

class BudgetModule(context: ReactApplicationContext, private val runtime: NativeServiceRuntime) : NativeBudgetSpec(context) {
    private val bridge = BridgeSupport(runtime)
    override fun invalidate() { bridge.close(); super.invalidate() }
    override fun readSettings(promise: Promise) = bridge.call(promise) { runtime.container.budgetRepository.readSettings() }
    override fun readView(month: String, promise: Promise) = bridge.call(promise) { runtime.container.budgetRepository.readView(month) }
    override fun readModeView(request: ReadableMap, promise: Promise) = bridge.call(promise) {
        val query = BudgetModeViewRequest(BudgetMonth(requireNotNull(request.getString("month"))), requireNotNull(request.getString("mode")))
        runtime.container.budgetRepository.readModeView(query)
    }
    override fun readCopyPreview(request: ReadableMap, promise: Promise) = bridge.call(promise) {
        runtime.container.budgetRepository.readCopyPreview(BudgetMonth(requireNotNull(request.getString("month"))))
    }
    override fun readRolloverPreview(request: ReadableMap, promise: Promise) = bridge.call(promise) {
        val query = BudgetRolloverRequest(requireNotNull(request.getString("category")), BudgetMonth(requireNotNull(request.getString("effectiveMonth"))), requireNotNull(request.getString("policy")))
        runtime.container.budgetRepository.readRolloverPreview(query)
    }
    override fun startWrite(operationId: String, action: String, body: String, promise: Promise) = bridge.call(promise) {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        com.lofuyu.borderledger.budget.budgetWritePath(action, body)
        if (action == "transfers") require(JSONObject(body).optString("id") == operationId)
        if (action in setOf("mode", "tracking-plans", "tracking-copy", "rollover")) require(JSONObject(body).optString("operationId") == operationId)
        runtime.write(WriteRequest(operationId, "budget_$action", "$action:$body") {
            runtime.container.budgetRepository.write(BudgetWriteCommand(action, body))
            null
        })
    }
}
