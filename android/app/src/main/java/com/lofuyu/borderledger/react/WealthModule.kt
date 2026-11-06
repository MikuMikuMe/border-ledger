package com.lofuyu.borderledger.react

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.lofuyu.borderledger.react.codegen.NativeWealthSpec
import com.lofuyu.borderledger.wealth.WealthAction
import com.lofuyu.borderledger.wealth.WealthIdentifier
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

    override fun createIdentifier(): String = WealthIdentifier.create()

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
        startDocument(WealthOperationId(operationId), WealthDocumentKind.IMPORT_PICKER)
    }

    override fun startCsvTemplate(operationId: String, promise: Promise) = bridge.call(promise) {
        startDocument(WealthOperationId(operationId), WealthDocumentKind.TEMPLATE_PICKER)
    }

    override fun startCsvRemap(sourceOperationId: String, operationId: String, mapping: String, promise: Promise) = bridge.call(promise) {
        val request = WealthCsvRemapRequest(
            sourceOperation = WealthOperationId(sourceOperationId),
            operation = WealthOperationId(operationId),
            mapping = WealthJsonBody(mapping),
        )
        val fingerprint = "csv-remap:${request.sourceOperation.value}:${digest(request.mapping)}"
        runtime.write(WriteRequest(request.operation.value, "wealth_${WealthAction.CSV_PREVIEW.wireValue}", fingerprint) {
            runtime.external.remapWealthImport(request.sourceOperation.value, request.operation.value, request.mapping.value)
        })
    }

    override fun readCsvPreview(operationId: String, promise: Promise) = bridge.call(promise) {
        runtime.external.readWealthImportPreview(operationId)
    }

    override fun startWrite(operationId: String, action: String, body: String, promise: Promise) = bridge.call(promise) {
        startWrite(WealthOperationId(operationId), WealthAction.from(action), WealthJsonBody(body))
    }

    private suspend fun startDocument(
        operation: WealthOperationId,
        kind: WealthDocumentKind,
        arguments: JSONObject = JSONObject(),
    ): Map<String, Any?> = runtime.external.start(ExternalStartRequest(operation.value, kind.wireValue, arguments))

    private suspend fun startWrite(
        operation: WealthOperationId,
        action: WealthAction,
        body: WealthJsonBody,
    ): Map<String, Any?> {
        val payload = JSONObject(body.value)
        if (action == WealthAction.CSV_EXPORT) {
            return startDocument(operation, WealthDocumentKind.EXPORT_PICKER, payload)
        }
        val fingerprint = "${action.wireValue}:${digest(body)}"
        return runtime.write(WriteRequest(operation.value, "wealth_${action.wireValue}", fingerprint) {
            val response = runtime.container.wealthRepository.write(WealthWriteCommand(operation.value, action.wireValue, payload.toString()))
            if (action.isQuoteAction) quoteReceipt(action, WealthJsonBody(response)) else null
        })
    }

    private fun quoteReceipt(action: WealthAction, response: WealthJsonBody): String {
        val value = runCatching { JSONObject(response.value) }.getOrNull() ?: return "quote:${action.wireValue}"
        val receipt = JSONObject().put("action", action.wireValue)
        value.optString("provider").takeIf { it.isNotBlank() }?.let { receipt.put("provider", it) }
        if (value.has("configured")) receipt.put("configured", value.optBoolean("configured"))
        value.optString("status").takeIf { it.isNotBlank() }?.let { receipt.put("status", it) }
        value.optString("reason").takeIf { it.isNotBlank() }?.let { receipt.put("reason", it) }
        return receipt.toString()
    }

    private fun digest(value: WealthJsonBody): String = MessageDigest.getInstance("SHA-256")
        .digest(value.value.encodeToByteArray()).joinToString("") { "%02x".format(it) }
}
