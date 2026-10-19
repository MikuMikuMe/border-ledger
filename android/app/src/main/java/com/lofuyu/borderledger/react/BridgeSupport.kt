package com.lofuyu.borderledger.react

import com.facebook.react.bridge.*
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.OwnerSessionState
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect

internal class BridgeSupport(private val runtime: NativeServiceRuntime) {
    private val observers = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    fun close() = observers.cancel()
    fun observe(group: String, emit: () -> Unit) {
        observers.launch { runtime.changes.collect { if (it == group || it == "all") runCatching(emit) } }
    }
    fun observeSuspending(group: String, emit: suspend () -> Unit) {
        observers.launch { runtime.changes.collect { if(it==group || it=="all") try { emit() } catch(_: Exception) { } } }
    }
    fun <T> observeState(flow: kotlinx.coroutines.flow.Flow<T>, emit: (T) -> Unit) {
        observers.launch { flow.collect { runCatching { emit(it) } } }
    }
    fun <T> observeStateSuspending(flow: kotlinx.coroutines.flow.Flow<T>, emit: suspend (T) -> Unit) {
        observers.launch { flow.collect { try { emit(it) } catch(_: Exception) { } } }
    }
    fun call(promise: Promise, owner: Boolean = true, block: suspend () -> Any?) {
        runtime.scope.launch {
            try {
                val generation = if (owner) runtime.ownerGeneration() else null
                val result = block()
                if (owner) check(runtime.currentGeneration() == generation && runtime.container.ownerSessionManager.state.value is OwnerSessionState.SignedIn)
                promise.resolve(nativeValue(result))
            } catch (_: CancellationException) {
                promise.reject("interrupted", "The native operation was interrupted. Query its operation ID before continuing.")
            } catch (error: Exception) { rejectFailure(promise, error) }
        }
    }

    private fun rejectFailure(promise: Promise, error: Exception) {
        val failure = when (error) {
            is BridgeFailure -> "${error.code}|Refresh native service state before continuing."
            is IllegalArgumentException -> "invalid_request|The request is not valid."
            is TransportFailure.Unauthorized -> "unauthorized|Owner authorization is required."
            is TransportFailure.Offline,
            is com.lofuyu.borderledger.ui.settings.ReportingPreferencesRepository.Offline -> "offline|The service is offline."
            is com.lofuyu.borderledger.recurring.RecurringRevisionConflict,
            is com.lofuyu.borderledger.review.ReviewRevisionConflict -> "revision_conflict|Refresh before saving."
            is com.lofuyu.borderledger.accounts.AccountRequestRejected -> "request_rejected|The server rejected this request. Refresh the data and review before trying again."
            else -> "native_unavailable|The native service could not complete the request. Reconcile submitted operations before continuing."
        }
        val separator = failure.indexOf('|')
        promise.reject(failure.substring(0, separator), failure.substring(separator + 1))
    }
    companion object {
        fun nativeValue(value: Any?): Any? = when(value) {
            null, is String, is Boolean, is Double, is Int -> value
            is Map<*, *> -> Arguments.createMap().apply { value.forEach { (k,v) -> put(this, k as String, nativeValue(v)) } }
            is List<*> -> Arguments.createArray().apply { value.forEach { v -> when(val n = nativeValue(v)) { null -> pushNull(); is String -> pushString(n); is Boolean -> pushBoolean(n); is Int -> pushInt(n); is Double -> pushDouble(n); is WritableMap -> pushMap(n); is WritableArray -> pushArray(n); else -> error("Invalid native value") } } }
            else -> error("Unprojected native value")
        }
        private fun put(map: WritableMap, key: String, value: Any?) { when(value) { null -> map.putNull(key); is String -> map.putString(key,value); is Boolean -> map.putBoolean(key,value); is Int -> map.putInt(key,value); is Double -> map.putDouble(key,value); is WritableMap -> map.putMap(key,value); is WritableArray -> map.putArray(key,value); else -> error("Invalid native value") } }
        fun map(value: Map<String, Any?>) = nativeValue(value) as WritableMap
    }
}

internal fun ReadableMap.text(key: String): String? = if (hasKey(key) && !isNull(key)) getString(key) else null
internal fun ReadableMap.integer(key: String): Int { val value = getDouble(key); require(value.isFinite() && value == value.toInt().toDouble()); return value.toInt() }
internal fun ReadableArray.strings(): List<String> = (0 until size()).map { requireNotNull(getString(it)) }
