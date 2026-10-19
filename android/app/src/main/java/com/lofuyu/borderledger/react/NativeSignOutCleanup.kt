package com.lofuyu.borderledger.react

/** Run destructive handoff cleanup only after the durable owner sign-out succeeds. */
internal suspend fun signOutBeforeClearingHandoff(
    signOut: suspend () -> Map<String, Any?>,
    clearHandoff: suspend () -> Unit,
): Map<String, Any?> {
    val result = signOut()
    if (result["state"] == "signed_out") clearHandoff()
    return result
}
