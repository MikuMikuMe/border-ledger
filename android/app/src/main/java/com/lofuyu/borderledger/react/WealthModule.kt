package com.lofuyu.borderledger.react

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.lofuyu.borderledger.react.codegen.NativeWealthSpec
import com.lofuyu.borderledger.wealth.WealthReadQuery
import com.lofuyu.borderledger.wealth.WealthWriteCommand
import org.json.JSONObject
import java.security.MessageDigest

class WealthModule(context: ReactApplicationContext, private val runtime: NativeServiceRuntime) : NativeWealthSpec(context) {
    private val bridge = BridgeSupport(runtime)

    override fun initialize() {
        super.initialize()
        bridge.observe("wealth") { emitOnStateChanged("changed") }
    }

    override fun invalidate() { bridge.close(); super.invalidate() }

    override fun readSnapshot(request: ReadableMap, promise: Promise) = bridge.call(promise) {
        runtime.container.wealthRepository.readSnapshot(
            WealthReadQuery(
                view = request.text("view"), accountId = request.text("accountId"), exchange = request.text("exchange"), ticker = request.text("ticker"),
                asOf = request.text("asOf"), periodStart = request.text("periodStart"), periodEnd = request.text("periodEnd"),
            ),
        )
    }

    override fun readEvents(request: ReadableMap, promise: Promise) = bridge.call(promise) {
        runtime.container.wealthRepository.readEvents(request.text("accountId"))
    }

    override fun readValuations(request: ReadableMap, promise: Promise) = bridge.call(promise) {
        runtime.container.wealthRepository.readValuations(request.text("accountId"))
    }

    override fun readQuoteSettings(promise: Promise) = bridge.call(promise) {
        runtime.container.wealthRepository.readQuoteSettings()
    }

    override fun readTemplate(promise: Promise) = bridge.call(promise) { runtime.container.wealthRepository.readTemplate() }

    override fun startCsvImport(operationId: String, promise: Promise) = bridge.call(promise) {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        runtime.external.start(ExternalStartRequest(operationId, "wealth_import_picker", JSONObject()))
    }

    override fun startCsvTemplate(operationId: String, promise: Promise) = bridge.call(promise) {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        runtime.external.start(ExternalStartRequest(operationId, "wealth_template_picker", JSONObject()))
    }

    override fun startCsvRemap(sourceOperationId: String, operationId: String, mapping: String, promise: Promise) = bridge.call(promise) {
        require(sourceOperationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val fingerprint = "csv-remap:${sourceOperationId}:${digest(mapping)}"
        runtime.write(WriteRequest(operationId, "wealth_csv-preview", fingerprint) {
            runtime.external.remapWealthImport(sourceOperationId, operationId, mapping)
        })
    }

    override fun readCsvPreview(operationId: String, promise: Promise) = bridge.call(promise) {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        runtime.external.readWealthImportPreview(operationId)
    }

    override fun startWrite(operationId: String, action: String, body: String, promise: Promise) = bridge.call(promise) {
        require(operationId.matches(Regex("[A-Za-z0-9_-]{1,128}")))
        val payload = JSONObject(body)
        if (action == "csv-export") {
            runtime.external.start(ExternalStartRequest(operationId, "wealth_export_picker", payload))
        } else {
            val fingerprint = "$action:${digest(body)}"
            runtime.write(WriteRequest(operationId, "wealth_$action", fingerprint) {
                val response = runtime.container.wealthRepository.write(WealthWriteCommand(operationId, action, payload.toString()))
                if (action.startsWith("quote-")) quoteReceipt(action, response) else null
            })
        }
    }

    private fun quoteReceipt(action: String, response: String): String {
        val value = runCatching { JSONObject(response) }.getOrNull() ?: return "quote:$action"
        val receipt = JSONObject().put("action", action)
        value.optString("provider").takeIf { it.isNotBlank() }?.let { receipt.put("provider", it) }
        if (value.has("configured")) receipt.put("configured", value.optBoolean("configured"))
        value.optString("status").takeIf { it.isNotBlank() }?.let { receipt.put("status", it) }
        value.optString("reason").takeIf { it.isNotBlank() }?.let { receipt.put("reason", it) }
        return receipt.toString()
    }

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.encodeToByteArray()).joinToString("") { "%02x".format(it) }
}
