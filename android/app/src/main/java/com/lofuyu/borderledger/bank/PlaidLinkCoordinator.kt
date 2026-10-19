package com.lofuyu.borderledger.bank

import com.lofuyu.borderledger.accounts.AccountRepository
import com.lofuyu.borderledger.accounts.AccountSelectionRequest
import com.lofuyu.borderledger.accounts.ConnectionId
import com.lofuyu.borderledger.accounts.BankAccount
import com.lofuyu.borderledger.accounts.ConnectionOperation
import com.lofuyu.borderledger.accounts.ExchangeRequest
import com.lofuyu.borderledger.accounts.IdempotencyKey
import com.lofuyu.borderledger.accounts.LinkTokenRequest
import com.lofuyu.borderledger.accounts.PendingCancellationRequest
import com.lofuyu.borderledger.accounts.ProviderAccountId
import com.lofuyu.borderledger.accounts.ProviderPublicToken
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex

private typealias ReconnectTarget = String
private typealias ErrorMessage = String
private typealias ProviderAccountSelection = String

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

    suspend fun connect(reconnectConnectionId: ReconnectTarget? = null) {
        runExclusive("The bank connection could not be completed.") {
            _state.value = ConnectionCoordinatorState.LoadingLink
            val link = accounts.createLinkToken(LinkTokenRequest(reconnectConnectionId?.let(::ConnectionId)))
            val linkToken = link.linkToken ?: error("The Worker did not return a Link token.")
            _state.value = ConnectionCoordinatorState.Linking
            completeLinkResult(launcher.launch(linkToken), reconnectConnectionId)
        }
    }

    /** Resume a result redelivered to a recreated Activity without a live waiter. */
    suspend fun recover(result: PlaidLinkResult) {
        runExclusive("The recovered bank connection could not be completed.") {
            _state.value = ConnectionCoordinatorState.Linking
            // A recreated Activity cannot safely infer a reconnect target;
            // the Worker still validates the public token and stages the
            // resulting Item for explicit account confirmation.
            completeLinkResult(result, reconnectConnectionId = null)
        }
    }

    private suspend fun runExclusive(defaultMessage: ErrorMessage, action: suspend () -> Unit) {
        if (!connectMutex.tryLock()) return
        try {
            runSafely(defaultMessage, action)
        } finally {
            connectMutex.unlock()
        }
    }

    private suspend fun runSafely(defaultMessage: ErrorMessage, action: suspend () -> Unit) {
        try {
            action()
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (error: Exception) {
            _state.value = ConnectionCoordinatorState.Failed(error.message ?: defaultMessage)
        }
    }

    private suspend fun completeLinkResult(result: PlaidLinkResult, reconnectConnectionId: ReconnectTarget?) {
        when (result) {
            is PlaidLinkResult.Canceled -> _state.value = ConnectionCoordinatorState.Canceled
            is PlaidLinkResult.Unsupported -> _state.value = ConnectionCoordinatorState.Unsupported(
                "Official Plaid Link is not configured in this build. No provider token was exchanged.",
            )
            is PlaidLinkResult.Failed -> _state.value = ConnectionCoordinatorState.Failed(result.message)
            is PlaidLinkResult.Success -> stageConnection(result.publicToken, reconnectConnectionId)
        }
    }

    private suspend fun stageConnection(publicToken: String, reconnectConnectionId: ReconnectTarget?) {
        val pending = accounts.exchange(
            ExchangeRequest(
                publicToken = ProviderPublicToken(publicToken),
                idempotencyKey = IdempotencyKey(idempotencyKey()),
                reconnectConnectionId = reconnectConnectionId?.let(::ConnectionId),
            ),
        )
        _state.value = pendingState(pending)
    }

    private fun pendingState(operation: ConnectionOperation): ConnectionCoordinatorState {
        return if (operation.state == "pending" && operation.pendingConnectionId != null) {
            ConnectionCoordinatorState.Pending(operation, operation.accounts)
        } else {
            ConnectionCoordinatorState.Failed("The provider connection was not staged safely.")
        }
    }

    suspend fun confirmSelection(accountIds: List<ProviderAccountSelection>) {
        val current = _state.value as? ConnectionCoordinatorState.Pending ?: return
        if (accountIds.isEmpty()) {
            _state.value = ConnectionCoordinatorState.Failed("Choose at least one account before continuing.")
            return
        }
        runSafely("The selected accounts could not be confirmed.") {
            val connected = accounts.selectAccounts(
                AccountSelectionRequest(
                    pendingConnectionId = ConnectionId(current.operation.pendingConnectionId!!),
                    accountIds = accountIds.map(::ProviderAccountId),
                    idempotencyKey = IdempotencyKey(idempotencyKey()),
                ),
            )
            _state.value = selectionState(connected)
        }
    }

    private fun selectionState(operation: ConnectionOperation): ConnectionCoordinatorState {
        return if (operation.state == "connected") {
            ConnectionCoordinatorState.Connected(operation)
        } else {
            ConnectionCoordinatorState.Failed("The Worker did not confirm the selected accounts.")
        }
    }

    suspend fun cancelPending() {
        val current = _state.value as? ConnectionCoordinatorState.Pending ?: return
        runSafely("The pending connection could not be canceled.") {
            val pendingId = current.operation.pendingConnectionId!!
            accounts.cancelPending(
                PendingCancellationRequest(
                    pendingConnectionId = ConnectionId(pendingId),
                    idempotencyKey = IdempotencyKey("cancel:$pendingId"),
                ),
            )
            _state.value = ConnectionCoordinatorState.Canceled
        }
    }
}
