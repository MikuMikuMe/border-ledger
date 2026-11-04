package com.lofuyu.borderledger.react

@JvmInline
internal value class WealthOperationId(val value: String) {
    init {
        require(value.matches(PATTERN))
    }

    private companion object {
        val PATTERN = Regex("[A-Za-z0-9_-]{1,128}")
    }
}

@JvmInline
internal value class WealthOwnerId(val value: String)

@JvmInline
internal value class WealthJsonBody(val value: String)

internal data class WealthCsvRemapRequest(
    val sourceOperation: WealthOperationId,
    val operation: WealthOperationId,
    val mapping: WealthJsonBody,
)

internal enum class WealthDocumentKind(val wireValue: String) {
    EXPORT_PICKER("wealth_export_picker"),
    TEMPLATE_PICKER("wealth_template_picker"),
    IMPORT_PICKER("wealth_import_picker"),
    ;

    companion object {
        fun from(wireValue: String): WealthDocumentKind = entries.firstOrNull { it.wireValue == wireValue }
            ?: error("Unknown Wealth document handoff")
    }
}
