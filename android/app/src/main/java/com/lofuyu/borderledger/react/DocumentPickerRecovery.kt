package com.lofuyu.borderledger.react

/** Reopen only local document-picker handoffs that have no live request/result owner. */
internal object DocumentPickerRecovery {
    fun shouldRelaunch(
        kind: String,
        status: String,
        activeInProcess: Boolean,
        resultDelivered: Boolean,
    ): Boolean = kind in PICKER_KINDS && status == "awaiting_result" && !activeInProcess && !resultDelivered

    private val PICKER_KINDS = setOf("import_picker", "export_picker")
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
