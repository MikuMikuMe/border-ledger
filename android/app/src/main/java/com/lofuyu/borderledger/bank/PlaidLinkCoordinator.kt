package com.lofuyu.borderledger.bank

import com.lofuyu.borderledger.accounts.AccountRepository
import com.lofuyu.borderledger.accounts.BankAccount
import com.lofuyu.borderledger.accounts.ConnectionOperation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex

/**
 * Result boundary for the official Plaid Android Link SDK adapter.
 *
 * The SDK owns provider UI and OAuth return handling. This coordinator only
 * receives a short-lived Link result; access tokens and Plaid secrets never
 * cross this boundary or enter Android storage.
 */
sealed interface PlaidLinkResult {
    data class Success(val publicToken: String) : PlaidLinkResult
    data object Canceled : PlaidLinkResult
    data object Unsupported : PlaidLinkResult
    data class Failed(val message: String) : PlaidLinkResult
}

fun interface PlaidLinkLauncher {
    suspend fun launch(linkToken: String): PlaidLinkResult
}

/** Safe default for tests or hosts that do not own an Activity. */
object UnsupportedPlaidLinkLauncher : PlaidLinkLauncher {
    override suspend fun launch(linkToken: String): PlaidLinkResult = PlaidLinkResult.Unsupported
}

sealed interface ConnectionCoordinatorState {
    data object Idle : ConnectionCoordinatorState
    data object LoadingLink : ConnectionCoordinatorState
    data object Linking : ConnectionCoordinatorState
    data class Pending(
        val operation: ConnectionOperation,
        val accounts: List<BankAccount>,
    ) : ConnectionCoordinatorState
    data class Connected(val operation: ConnectionOperation) : ConnectionCoordinatorState
    data object Canceled : ConnectionCoordinatorState
    data class Unsupported(val message: String) : ConnectionCoordinatorState
    data object ReconciliationRequired : ConnectionCoordinatorState
    data class Failed(val message: String, val recoverable: Boolean = true) : ConnectionCoordinatorState
}

class PlaidLinkCoordinator(
    private val accounts: AccountRepository,
    private var launcher: PlaidLinkLauncher,
    private val idempotencyKey: () -> String = { java.util.UUID.randomUUID().toString() },
) {
    private val _state = MutableStateFlow<ConnectionCoordinatorState>(ConnectionCoordinatorState.Idle)
    private val connectMutex = Mutex()
    val state: StateFlow<ConnectionCoordinatorState> = _state.asStateFlow()

    /** Attach the Activity-owned official SDK bridge before exposing connect UI. */
    fun attachLauncher(launcher: PlaidLinkLauncher) {
        this.launcher = launcher
    }

    /** Do not retain a destroyed Activity through the Application container. */
    fun detachLauncher(launcher: PlaidLinkLauncher) {
        if (this.launcher === launcher) this.launcher = UnsupportedPlaidLinkLauncher
    }

    suspend fun connect(reconnectConnectionId: String? = null) {
        if (!connectMutex.tryLock()) return
        try {
            _state.value = ConnectionCoordinatorState.LoadingLink
            try {
                val link = accounts.createLinkToken(reconnectConnectionId)
                val linkToken = link.linkToken ?: error("The Worker did not return a Link token.")
                _state.value = ConnectionCoordinatorState.Linking
                completeLinkResult(launcher.launch(linkToken), reconnectConnectionId)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                _state.value = ConnectionCoordinatorState.Failed(error.message ?: "The bank connection could not be completed.")
            }
        } finally {
            connectMutex.unlock()
        }
    }

    /** Resume a result redelivered to a recreated Activity without a live waiter. */
    suspend fun recover(result: PlaidLinkResult) {
        if (!connectMutex.tryLock()) return
        try {
            _state.value = ConnectionCoordinatorState.Linking
            try {
                // A recreated Activity cannot safely infer a reconnect target;
                // the Worker still validates the public token and stages the
                // resulting Item for explicit account confirmation.
                completeLinkResult(result, reconnectConnectionId = null)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (error: Exception) {
                _state.value = ConnectionCoordinatorState.Failed(error.message ?: "The recovered bank connection could not be completed.")
            }
        } finally {
            connectMutex.unlock()
        }
    }

    private suspend fun completeLinkResult(result: PlaidLinkResult, reconnectConnectionId: String?) {
        when (result) {
            is PlaidLinkResult.Canceled -> _state.value = ConnectionCoordinatorState.Canceled
            is PlaidLinkResult.Unsupported -> _state.value = ConnectionCoordinatorState.Unsupported(
                "Official Plaid Link is not configured in this build. No provider token was exchanged.",
            )
            is PlaidLinkResult.Failed -> _state.value = ConnectionCoordinatorState.Failed(result.message)
            is PlaidLinkResult.Success -> {
                val pending = accounts.exchange(result.publicToken, idempotencyKey(), reconnectConnectionId)
                if (pending.state != "pending" || pending.pendingConnectionId == null) {
                    _state.value = ConnectionCoordinatorState.Failed("The provider connection was not staged safely.")
                } else {
                    _state.value = ConnectionCoordinatorState.Pending(pending, pending.accounts)
                }
            }
        }
    }

    suspend fun confirmSelection(accountIds: List<String>) {
        val current = _state.value
        if (current !is ConnectionCoordinatorState.Pending) return
        if (accountIds.isEmpty()) {
            _state.value = ConnectionCoordinatorState.Failed("Choose at least one account before continuing.")
            return
        }
        try {
            val connected = accounts.selectAccounts(current.operation.pendingConnectionId!!, accountIds, idempotencyKey())
            _state.value = if (connected.state == "connected") ConnectionCoordinatorState.Connected(connected)
            else ConnectionCoordinatorState.Failed("The Worker did not confirm the selected accounts.")
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            _state.value = ConnectionCoordinatorState.Failed(error.message ?: "The selected accounts could not be confirmed.")
        }
    }

    suspend fun cancelPending() {
        val current = _state.value
        if (current !is ConnectionCoordinatorState.Pending) return
        try {
            accounts.cancelPending(current.operation.pendingConnectionId!!)
            _state.value = ConnectionCoordinatorState.Canceled
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            _state.value = ConnectionCoordinatorState.Failed(error.message ?: "The pending connection could not be canceled.")
        }
    }
}
