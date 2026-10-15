package com.lofuyu.borderledger.ui.accounts.connection

import com.lofuyu.borderledger.accounts.AccountRepository
import com.lofuyu.borderledger.accounts.BankAccount
import com.lofuyu.borderledger.accounts.ConnectionStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ConnectionViewState(
    val loading: Boolean = false,
    val accounts: List<BankAccount> = emptyList(),
    val connections: List<ConnectionStatus> = emptyList(),
    val actionConnectionId: String? = null,
    val error: String? = null,
)

/** Coordinates owner account metadata actions without hiding server operation states. */
class ConnectionViewModel(
    private val repository: AccountRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow(ConnectionViewState())
    val state: StateFlow<ConnectionViewState> = _state.asStateFlow()

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null, actionConnectionId = null)
        scope.launch {
            runCatching {
                val connections = async { repository.listConnections() }
                val accounts = async { repository.listAccounts().accounts }
                connections.await() to accounts.await()
            }.onSuccess { (connections, accounts) ->
                _state.value = ConnectionViewState(accounts = accounts, connections = connections)
            }.onFailure { error ->
                _state.value = _state.value.copy(loading = false, error = error.message ?: "Bank connection data is unavailable.")
            }
        }
    }

    fun sync() {
        _state.value = _state.value.copy(loading = true, actionConnectionId = "sync", error = null)
        scope.launch {
            runCatching { repository.sync() }
                .onSuccess { load() }
                .onFailure { error ->
                    _state.value = _state.value.copy(loading = false, actionConnectionId = null, error = error.message ?: "Bank synchronization could not be requested.")
                }
        }
    }

    fun disconnect(connectionId: String) {
        _state.value = _state.value.copy(loading = true, actionConnectionId = connectionId, error = null)
        scope.launch {
            runCatching { repository.disconnect(connectionId) }
                .onSuccess { load() }
                .onFailure { error ->
                    _state.value = _state.value.copy(loading = false, actionConnectionId = null, error = error.message ?: "The bank connection could not be disconnected.")
                }
        }
    }
}
