package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.auth.OwnerSessionCore
import kotlinx.coroutines.flow.map

/** Projects the actual shared state machine, without copying its state or refresh policy. */
class BridgeSessionLifecycle(private val manager: OwnerSessionCore, private val beforeSignOut: suspend () -> Unit = {}) {
    val snapshots=manager.state.map { BridgePayloads.session(it) }
    suspend fun getSnapshot(): Map<String,Any?> { manager.restore(); return BridgePayloads.session(manager.state.value) }
    suspend fun resume(): Map<String,Any?> {
        manager.restore()
        manager.accessToken() // Native-only result. Never returned, logged or persisted by this bridge.
        manager.flushPendingRevocations()
        return BridgePayloads.session(manager.state.value)
    }
    suspend fun signOut(): Map<String,Any?> { beforeSignOut(); manager.signOut(); return BridgePayloads.session(manager.state.value) }
}
