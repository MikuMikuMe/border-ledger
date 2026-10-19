package com.lofuyu.borderledger.auth

import kotlinx.coroutines.flow.StateFlow

interface OwnerSessionStateProvider { val state: StateFlow<OwnerSessionState> }

data class VerifiedCallback(val state: String?, val code: String?, val error: String?)

object CallbackValidationException : Exception()

data class LoginLaunch(val requestId: String, val authorizationUrl: String, val expiresAt: String)

enum class SignedOutReason {
    Explicit,
    Canceled,
    Offline,
    StartFailed,
    FailedReturn,
    ExchangeFailed,
    UnapprovedIdentity,
}

enum class StorageOperation {
    Restore,
    LoginCommit,
    RefreshCommit,
    Logout,
    Callback,
}

sealed interface OwnerSessionState {
    data object Restoring : OwnerSessionState
    data object SigningIn : OwnerSessionState
    data object Exchanging : OwnerSessionState
    data object Refreshing : OwnerSessionState
    data object SigningOut : OwnerSessionState
    data class AwaitingBrowser(val requestId: String, val expiresAt: String) : OwnerSessionState
    data class SignedIn(
        val expiresAt: String,
        val scopes: List<String>,
        val pendingDestination: String?,
        val refreshExpiresAt: String? = null,
    ) : OwnerSessionState
    data class SignedOut(
        val pendingRevocations: Int = 0,
        val reason: SignedOutReason = SignedOutReason.Explicit,
    ) : OwnerSessionState
    data class Expired(val pendingRevocations: Int = 0) : OwnerSessionState
    data class CallbackRejected(val recoverable: Boolean) : OwnerSessionState
    data class StorageFailure(val operation: StorageOperation) : OwnerSessionState
}

/** Capability used by owner-authorized reads when the server rejects the current session. */
interface OwnerSessionAuthorizationHandler : OwnerSessionStateProvider {
    suspend fun markRemoteAuthorizationFailure()
}

enum class CallbackResult {
    SignedIn,
    DuplicateIgnored,
    Canceled,
    FailedReturn,
    CallbackRejected,
    ExchangeFailed,
    StorageFailure,
}
