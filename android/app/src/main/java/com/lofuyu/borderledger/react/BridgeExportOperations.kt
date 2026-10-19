package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.exports.ExportState
import com.lofuyu.borderledger.exports.WorkerExportReceipt

/** Keeps definitive local export failures terminal without hiding an unresolved Worker receipt. */
internal object BridgeExportOperations {
    fun requireReceipt(result: ExportState): WorkerExportReceipt = when (result) {
        is ExportState.Completed -> result.receipt
        is ExportState.Error -> throw BridgeLocalFailure()
        is ExportState.AwaitingWorkerReceipt -> throw IllegalStateException(
            "The export is waiting for a Worker receipt and must remain unresolved.",
        )
        else -> throw IllegalStateException("The export outcome is not yet definitive.")
    }
}
