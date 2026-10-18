package com.lofuyu.borderledger.core

sealed interface CallbackDecision {
    data object Duplicate : CallbackDecision
    data class Rejected(val recoverable: Boolean) : CallbackDecision
    data object Canceled : CallbackDecision
    data object FailedReturn : CallbackDecision
    data object Exchange : CallbackDecision
}

/** Called only after the native URI adapter validates the callback origin and parameter multiplicity. */
fun decideCallback(pendingState: String?, returnedState: String?, completedState: String?, code: String?, error: String?): CallbackDecision {
    if (pendingState == null) return if (returnedState != null && returnedState == completedState) CallbackDecision.Duplicate else CallbackDecision.Rejected(false)
    if (returnedState == null || returnedState != pendingState) return CallbackDecision.Rejected(true)
    if (error != null) return if (error == "access_denied") CallbackDecision.Canceled else CallbackDecision.FailedReturn
    if (code.isNullOrBlank()) return CallbackDecision.Rejected(true)
    return CallbackDecision.Exchange
}

fun accessIsValid(expiresAt: String, clock: CoreClock): Boolean = runCatching { clock.isAfterNow(expiresAt) }.getOrDefault(false)
