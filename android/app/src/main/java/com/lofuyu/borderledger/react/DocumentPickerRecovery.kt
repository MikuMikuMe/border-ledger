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

internal object PlaidHandoffAvailability {
    fun canCancel(
        state: String,
        operationStatus: String?,
        providerMayBeOpen: Boolean,
        providerReturned: Boolean,
        callbackInProgress: Boolean,
    ): Boolean = state == "linking" && operationStatus == "awaiting_result" &&
        !callbackInProgress && (!providerMayBeOpen || providerReturned)
}
