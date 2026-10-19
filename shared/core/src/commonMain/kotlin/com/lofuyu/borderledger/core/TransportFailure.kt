package com.lofuyu.borderledger.api

sealed class TransportFailure(message: String? = null) : Exception(message) {
    data object Offline : TransportFailure()
    data object Unauthorized : TransportFailure()
    data object Retryable : TransportFailure()
    data object StaleRevocation : TransportFailure()
    data object Unavailable : TransportFailure()
}
