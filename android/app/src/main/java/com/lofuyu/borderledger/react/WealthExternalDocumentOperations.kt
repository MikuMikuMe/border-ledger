package com.lofuyu.borderledger.react

import android.net.Uri
import com.lofuyu.borderledger.wealth.WealthWriteCommand
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.json.JSONObject

/** Owner-fenced SAF operations for Wealth CSV import, template, and export. */
internal class WealthExternalDocumentOperations(private val runtime: NativeServiceRuntime) {
    private val records get() = runtime.container.bridgeRecords

    fun changeTopic(kind: String): String = if (kind.startsWith("wealth_")) "wealth" else "files"

    suspend fun process(handoff: HandoffContext, uri: Uri): String = when (handoff.value.getString("kind")) {
        "wealth_export_picker" -> export(handoff, uri)
        "wealth_template_picker" -> exportTemplate(handoff, uri)
        "wealth_import_picker" -> preview(handoff, uri)
        else -> error("Unknown Wealth document handoff")
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
        records.write(sourceKey(handoff.owner, handoff.id), csv.encodeToByteArray())
        val response = runtime.container.wealthRepository.write(
            WealthWriteCommand(handoff.id, "csv-preview", JSONObject().put("csv", csv).toString()),
        )
        records.write(previewKey(handoff.owner, handoff.id), response.encodeToByteArray())
        return "wealth-preview:${handoff.id}"
    }

    suspend fun remap(sourceOperationId: String, operationId: String, mappingJson: String): String {
        val owner = runtime.ownerGeneration()
        require(sourceOperationId.matches(OPERATION_ID) && operationId.matches(OPERATION_ID))
        require(mappingJson.toByteArray(Charsets.UTF_8).size <= MAX_MAPPING_BYTES)
        val mapping = JSONObject(mappingJson)
        mapping.keys().forEach { key ->
            val value = mapping.get(key)
            require(key.matches(HEADER_NAME) && (value == JSONObject.NULL || (value is String && value.matches(HEADER_NAME))))
        }
        val csv = records.read(sourceKey(owner, sourceOperationId))?.decodeToString()
            ?: error("The selected Wealth CSV is no longer available; choose it again.")
        val response = runtime.container.wealthRepository.write(
            WealthWriteCommand(operationId, "csv-preview", JSONObject().put("csv", csv).put("mapping", mapping).toString()),
        )
        records.write(previewKey(owner, operationId), response.encodeToByteArray())
        records.write(sourceKey(owner, operationId), csv.encodeToByteArray())
        return "wealth-preview:$operationId"
    }

    suspend fun readPreview(operationId: String): String? {
        val owner = runtime.ownerGeneration()
        require(operationId.matches(OPERATION_ID))
        return records.read(previewKey(owner, operationId))?.decodeToString()
    }

    suspend fun readCompletedPreview(operationId: String): String? {
        if (completedCsvOperation(operationId) == null) return null
        return readPreview(operationId)
    }

    suspend fun remapCompleted(sourceOperationId: String, operationId: String, mappingJson: String): String {
        check(completedCsvOperation(sourceOperationId) != null) {
            "The selected Wealth CSV is not ready for remapping; choose it again."
        }
        return remap(sourceOperationId, operationId, mappingJson)
    }

    suspend fun export(handoff: HandoffContext, destination: Uri): String {
        val csv = runtime.container.wealthRepository.exportCsv()
        write(destination, csv)
        return "wealth-export:${handoff.id}"
    }

    suspend fun exportTemplate(handoff: HandoffContext, destination: Uri): String {
        val csv = runtime.container.wealthRepository.readTemplate()
        write(destination, csv)
        return "wealth-template:${handoff.id}"
    }

    private fun write(destination: Uri, csv: String) {
        val output = runtime.applicationContext.contentResolver.openOutputStream(destination)
            ?: error("Android could not open the selected Wealth export destination.")
        output.bufferedWriter(Charsets.UTF_8).use { it.write(csv) }
    }

    private fun previewKey(owner: String, operationId: String): String =
        "rn_wealth_preview_v1_${digest("$owner:$operationId")}"

    private fun sourceKey(owner: String, operationId: String): String =
        "rn_wealth_csv_source_v1_${digest("$owner:$operationId")}"

    private suspend fun completedCsvOperation(operationId: String): BridgeOperation? {
        val owner = runtime.ownerGeneration()
        return runtime.container.bridgeOperations.query(BridgeOperationKey(operationId, owner))?.takeIf {
            it.status == "completed" && DocumentPickerRecovery.isWealthCsvOperation(it.kind)
        }
    }

    private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.encodeToByteArray()).joinToString("") { "%02x".format(it) }

    private companion object {
        const val MAX_CSV_BYTES = 2 * 1024 * 1024
        const val MAX_MAPPING_BYTES = 64 * 1024
        val OPERATION_ID = Regex("[A-Za-z0-9_-]{1,128}")
        val HEADER_NAME = Regex("[A-Za-z0-9_. -]{1,128}")
    }
}
