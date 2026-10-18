package com.lofuyu.borderledger.react

internal sealed interface PlaidCancellationDecision {
    val operation: BridgeOperation

    data class Canceled(override val operation: BridgeOperation) : PlaidCancellationDecision
    data class Retained(override val operation: BridgeOperation) : PlaidCancellationDecision
}

/** A Plaid handoff can only be canceled before LinkKit opens and before callback work is submitted. */
internal class PlaidHandoffCancellation(
    private val journal: BridgeOperationJournal,
    private val providerLaunchState: PlaidProviderLaunchState,
) {
    suspend fun cancelBeforeSubmission(
        operationId: String,
        owner: String,
        providerHasReturned: Boolean = false,
    ): PlaidCancellationDecision? {
        val current = journal.query(operationId, owner) ?: return null
        if (current.kind != "plaid") return null
        if (providerLaunchState.wasStarted(owner, operationId) && !providerHasReturned) {
            return PlaidCancellationDecision.Retained(current)
        }

        val operation = if (current.status == "awaiting_result") {
            journal.cancel(operationId, owner) ?: return null
        } else {
            current
        }
        return if (operation.status in setOf("canceled", "failed_local")) {
            PlaidCancellationDecision.Canceled(operation)
        } else {
            PlaidCancellationDecision.Retained(operation)
        }
    }
}
