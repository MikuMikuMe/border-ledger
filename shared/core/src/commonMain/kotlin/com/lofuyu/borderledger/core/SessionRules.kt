package com.lofuyu.borderledger.core

sealed interface CallbackDecision {
    data object Duplicate : CallbackDecision
    data class Rejected(val recoverable: Boolean) : CallbackDecision
    data object Canceled : CallbackDecision
    data object FailedReturn : CallbackDecision
    data object Exchange : CallbackDecision
}

data class CallbackInput(
    val pendingState: String?,
    val returnedState: String?,
    val completedState: String?,
    val code: String?,
    val error: String?,
)

/** Called only after the native URI adapter validates the callback origin and parameter multiplicity. */
fun decideCallback(input: CallbackInput): CallbackDecision {
    if (input.pendingState == null) return completedCallbackDecision(input)
    if (!input.returnedStateMatchesPending()) return CallbackDecision.Rejected(true)
    return input.returnedOutcome()
}

private fun completedCallbackDecision(input: CallbackInput): CallbackDecision =
    if (input.returnedState != null && input.returnedState == input.completedState) {
        CallbackDecision.Duplicate
    } else {
        CallbackDecision.Rejected(false)
    }

private fun CallbackInput.returnedStateMatchesPending(): Boolean =
    returnedState != null && returnedState == pendingState

private fun CallbackInput.returnedOutcome(): CallbackDecision = when {
    error == "access_denied" -> CallbackDecision.Canceled
    error != null -> CallbackDecision.FailedReturn
    code.isNullOrBlank() -> CallbackDecision.Rejected(true)
    else -> CallbackDecision.Exchange
}

fun accessIsValid(expiresAt: String, clock: CoreClock): Boolean = runCatching { clock.isAfterNow(expiresAt) }.getOrDefault(false)
