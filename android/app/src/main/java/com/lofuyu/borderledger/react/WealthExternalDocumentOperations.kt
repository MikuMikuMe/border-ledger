package com.lofuyu.borderledger.react

import android.net.Uri
import com.lofuyu.borderledger.wealth.WealthAction
import com.lofuyu.borderledger.wealth.WealthWriteCommand
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Owner-fenced SAF operations for Wealth CSV import, template, and export. */
internal class WealthExternalDocumentOperations(private val runtime: NativeServiceRuntime) {
    private val records get() = runtime.container.bridgeRecords

    fun changeTopic(kind: String): String = if (kind.startsWith("wealth_")) "wealth" else "files"

    suspend fun process(handoff: HandoffContext, uri: Uri): String = withContext(Dispatchers.IO) {
        when (WealthDocumentKind.from(handoff.value.getString("kind"))) {
            WealthDocumentKind.EXPORT_PICKER -> export(handoff, uri)
            WealthDocumentKind.TEMPLATE_PICKER -> exportTemplate(handoff, uri)
            WealthDocumentKind.IMPORT_PICKER -> preview(handoff, uri)
        }
    }

    suspend fun preview(handoff: HandoffContext, uri: Uri): String {
        val bytes = runtime.applicationContext.contentResolver.openInputStream(uri)?.use { input ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                check(output.size() + count <= MAX_CSV_BYTES) { "The Wealth CSV is larger than 2 MiB." }
                output.write(buffer, 0, count)
            }
            output.toByteArray()
        } ?: error("Android could not read the selected Wealth CSV.")
        val csv = bytes.toString(Charsets.UTF_8)
        check(!csv.contains('\uFFFD')) { "The Wealth CSV must be UTF-8." }
        val operation = WealthOperationId(handoff.id)
        val key = WealthDocumentKey(WealthOwnerId(handoff.owner), operation)
        records.write(sourceKey(key), csv.encodeToByteArray())
        val response = runtime.container.wealthRepository.write(
            WealthWriteCommand(operation.value, WealthAction.CSV_PREVIEW.wireValue, JSONObject().put("csv", csv).toString()),
        )
        records.write(previewKey(key), response.encodeToByteArray())
        return "wealth-preview:${operation.value}"
    }

    suspend fun remap(request: WealthCsvRemapRequest): String {
        val owner = WealthOwnerId(runtime.ownerGeneration())
        val mapping = parseWealthCsvMapping(request.mapping.value)
        val sourceDocumentKey = WealthDocumentKey(owner, request.sourceOperation)
        val destinationKey = WealthDocumentKey(owner, request.operation)
        val csv = records.read(sourceKey(sourceDocumentKey))?.decodeToString()
            ?: error("The selected Wealth CSV is no longer available; choose it again.")
        val response = runtime.container.wealthRepository.write(
            WealthWriteCommand(request.operation.value, WealthAction.CSV_PREVIEW.wireValue, JSONObject().put("csv", csv).put("mapping", mapping).toString()),
        )
        records.write(previewKey(destinationKey), response.encodeToByteArray())
        records.write(sourceKey(destinationKey), csv.encodeToByteArray())
        return "wealth-preview:${request.operation.value}"
    }

    suspend fun readPreview(operation: WealthOperationId): String? {
        val key = WealthDocumentKey(WealthOwnerId(runtime.ownerGeneration()), operation)
        return records.read(previewKey(key))?.decodeToString()
    }

    suspend fun readCompletedPreview(operation: WealthOperationId): String? = withContext(Dispatchers.IO) {
        if (completedCsvOperation(operation) == null) return@withContext null
        readPreview(operation)
    }

    suspend fun remapCompleted(request: WealthCsvRemapRequest): String = withContext(Dispatchers.IO) {
        check(completedCsvOperation(request.sourceOperation) != null) {
            "The selected Wealth CSV is not ready for remapping; choose it again."
        }
        remap(request)
    }

    suspend fun export(handoff: HandoffContext, destination: Uri): String {
        val csv = runtime.container.wealthRepository.exportCsv()
        write(WealthDocumentWrite(destination, csv))
        return "wealth-export:${WealthOperationId(handoff.id).value}"
    }

    suspend fun exportTemplate(handoff: HandoffContext, destination: Uri): String {
        val csv = runtime.container.wealthRepository.readTemplate()
        write(WealthDocumentWrite(destination, csv))
        return "wealth-template:${WealthOperationId(handoff.id).value}"
    }

    private fun write(document: WealthDocumentWrite) {
        val output = runtime.applicationContext.contentResolver.openOutputStream(document.destination)
            ?: error("Android could not open the selected Wealth export destination.")
        output.bufferedWriter(Charsets.UTF_8).use { it.write(document.csv) }
    }

    private fun previewKey(key: WealthDocumentKey): String =
        "rn_wealth_preview_v1_${digest(key)}"

    private fun sourceKey(key: WealthDocumentKey): String =
        "rn_wealth_csv_source_v1_${digest(key)}"

    private suspend fun completedCsvOperation(operation: WealthOperationId): BridgeOperation? {
        val owner = WealthOwnerId(runtime.ownerGeneration())
        return runtime.container.bridgeOperations.query(BridgeOperationKey(operation.value, owner.value))?.takeIf {
            it.status == "completed" && DocumentPickerRecovery.isWealthCsvOperation(it.kind)
        }
    }

    private fun digest(key: WealthDocumentKey): String = MessageDigest.getInstance("SHA-256")
        .digest("${key.owner.value}:${key.operation.value}".encodeToByteArray()).joinToString("") { "%02x".format(it) }

    private data class WealthDocumentKey(val owner: WealthOwnerId, val operation: WealthOperationId)
    private data class WealthDocumentWrite(val destination: Uri, val csv: String)

    private companion object {
        const val MAX_CSV_BYTES = 2 * 1024 * 1024
    }
}

internal fun parseWealthCsvMapping(mappingJson: String): JSONObject {
    require(mappingJson.toByteArray(Charsets.UTF_8).size <= MAX_MAPPING_BYTES)
    val mapping = JSONObject(mappingJson)
    mapping.keys().forEach { key ->
        val value = mapping.get(key)
        require(key.matches(HEADER_NAME) && (value == JSONObject.NULL || (value is String && value.isNotBlank())))
    }
    return mapping
}

private const val MAX_MAPPING_BYTES = 64 * 1024
private val HEADER_NAME = Regex("[A-Za-z0-9_. -]{1,128}")
