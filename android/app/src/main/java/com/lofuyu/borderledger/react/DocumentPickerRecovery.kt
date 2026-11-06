package com.lofuyu.borderledger.react

/** Reopen only local document-picker handoffs that have no live request/result owner. */
internal object DocumentPickerRecovery {
    enum class Destination { IMPORT, EXPORT }

    fun isPickerKind(kind: String): Boolean = kind in PICKER_KINDS

    /** Initial external dispatch accepts the same picker set as recovery, plus Plaid. */
    fun isExternalKind(kind: String): Boolean = kind == "plaid" || isPickerKind(kind)

    fun isWealthCsvOperation(kind: String): Boolean = kind in WEALTH_CSV_KINDS

    fun destinationFor(kind: String): Destination = when (kind) {
        "import_picker", "wealth_import_picker" -> Destination.IMPORT
        "export_picker", "wealth_export_picker", "wealth_template_picker" -> Destination.EXPORT
        else -> error("Unknown document picker kind")
    }

    fun shouldRelaunch(
        kind: String,
        status: String,
        activeInProcess: Boolean,
        resultDelivered: Boolean,
    ): Boolean = isPickerKind(kind) && status == "awaiting_result" && !activeInProcess && !resultDelivered

    /** A selected destination can safely retry the same idempotent export. */
    fun shouldRetryExternal(status: String?): Boolean = status == "running" || status == "reconciliation_required"

    /** Keep the native handoff while an export result is still ambiguous. */
    fun shouldRetainSubmittedHandoff(status: String?): Boolean = shouldRetryExternal(status)

    private val PICKER_KINDS = setOf("import_picker", "export_picker", "wealth_import_picker", "wealth_export_picker", "wealth_template_picker")
    private val WEALTH_CSV_KINDS = setOf("wealth_import_picker", "wealth_csv-preview")
}

internal data class PlaidHandoffState(
    val state: String,
    val operationStatus: String?,
    val providerMayBeOpen: Boolean,
    val providerReturned: Boolean,
    val callbackInProgress: Boolean,
)

internal object PlaidHandoffAvailability {
    fun canCancel(handOff: PlaidHandoffState): Boolean =
        handOff.state == "linking" &&
            handOff.operationStatus == "awaiting_result" &&
            !handOff.callbackInProgress &&
            (!handOff.providerMayBeOpen || handOff.providerReturned)
}
