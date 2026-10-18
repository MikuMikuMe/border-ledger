package com.lofuyu.borderledger.core

import com.lofuyu.borderledger.api.TransportFailure

sealed interface OwnerReadResult<out T> {
    data object NotSignedIn : OwnerReadResult<Nothing>
    data object Unavailable : OwnerReadResult<Nothing>
    data object Offline : OwnerReadResult<Nothing>
    data object Unauthorized : OwnerReadResult<Nothing>
    data class Ready<T>(val value: T) : OwnerReadResult<T>
}

/** One owner read, with no retry/replay. Cancellation and unexpected failures propagate. */
suspend fun <Payload, Value : Any> ownerRead(
    signedIn: Boolean,
    available: Boolean,
    unauthorized: suspend () -> Unit,
    read: suspend () -> Payload,
    decode: suspend (Payload) -> Value?,
): OwnerReadResult<Value> {
    if (!signedIn) return OwnerReadResult.NotSignedIn
    if (!available) return OwnerReadResult.Unavailable
    return try {
        decode(read())?.let { OwnerReadResult.Ready(it) } ?: OwnerReadResult.Unavailable
    } catch (_: TransportFailure.Offline) {
        OwnerReadResult.Offline
    } catch (_: TransportFailure.Unauthorized) {
        unauthorized()
        OwnerReadResult.Unauthorized
    } catch (_: TransportFailure) {
        OwnerReadResult.Unavailable
    }
}
