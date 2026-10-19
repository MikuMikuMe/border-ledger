package com.lofuyu.borderledger.core

import com.lofuyu.borderledger.api.TransportFailure

sealed interface OwnerReadResult<out T> {
    data object NotSignedIn : OwnerReadResult<Nothing>
    data object Unavailable : OwnerReadResult<Nothing>
    data object Offline : OwnerReadResult<Nothing>
    data object Unauthorized : OwnerReadResult<Nothing>
    data class Ready<T>(val value: T) : OwnerReadResult<T>
}

data class OwnerReadRequest<Payload, Value : Any>(
    val signedIn: Boolean,
    val available: Boolean,
    val unauthorized: suspend () -> Unit,
    val read: suspend () -> Payload,
    val decode: suspend (Payload) -> Value?,
)

/** One owner read, with no retry/replay. Cancellation and unexpected failures propagate. */
suspend fun <Payload, Value : Any> ownerRead(
    request: OwnerReadRequest<Payload, Value>,
): OwnerReadResult<Value> {
    if (!request.signedIn) return OwnerReadResult.NotSignedIn
    if (!request.available) return OwnerReadResult.Unavailable
    return try {
        request.decode(request.read())?.let { OwnerReadResult.Ready(it) } ?: OwnerReadResult.Unavailable
    } catch (_: TransportFailure.Offline) {
        OwnerReadResult.Offline
    } catch (_: TransportFailure.Unauthorized) {
        request.unauthorized()
        OwnerReadResult.Unauthorized
    } catch (_: TransportFailure) {
        OwnerReadResult.Unavailable
    }
}
