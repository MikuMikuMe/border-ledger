package com.lofuyu.borderledger.bank

import com.lofuyu.borderledger.accounts.AccountRepository
import com.lofuyu.borderledger.accounts.AccountConnectionGateway
import com.lofuyu.borderledger.accounts.AccountPageRequest
import com.lofuyu.borderledger.accounts.AccountSelectionRequest
import com.lofuyu.borderledger.accounts.AccountPage
import com.lofuyu.borderledger.accounts.BankAccount
import com.lofuyu.borderledger.accounts.ConnectionId
import com.lofuyu.borderledger.accounts.ConnectionOperation
import com.lofuyu.borderledger.accounts.ConnectionStatus
import com.lofuyu.borderledger.accounts.DisconnectRequest
import com.lofuyu.borderledger.accounts.ExchangeRequest
import com.lofuyu.borderledger.accounts.LinkTokenRequest
import com.lofuyu.borderledger.accounts.PendingCancellationRequest
import com.lofuyu.borderledger.accounts.SyncRequest
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaidLinkCoordinatorTest {
    @Test
    fun canceledLinkDoesNotCallExchangeOrStoreProviderCredentials() = runTest {
        val gateway = FakeGateway()
        val coordinator = PlaidLinkCoordinator(AccountRepository(gateway), PlaidLinkLauncher { PlaidLinkResult.Canceled })

        coordinator.connect()

        assertEquals(ConnectionCoordinatorState.Canceled, coordinator.state.value)
        assertEquals(0, gateway.exchangeCalls)
    }

    @Test
    fun selectedAccountsAreSentOnlyAfterPendingProviderReview() = runTest {
        val gateway = FakeGateway()
        val coordinator = PlaidLinkCoordinator(AccountRepository(gateway), PlaidLinkLauncher { PlaidLinkResult.Success("public-token-only") })

        coordinator.connect()
        assertTrue(coordinator.state.value is ConnectionCoordinatorState.Pending)
        coordinator.confirmSelection(listOf("provider-account"))

        assertEquals(listOf("provider-account"), gateway.selectedAccountIds)
        assertEquals(ConnectionCoordinatorState.Connected(ConnectionOperation("connected-op", "connected", connectionId = "connection-1")), coordinator.state.value)
    }

    @Test
    fun unsupportedLauncherDoesNotExchangeProviderToken() = runTest {
        val gateway = FakeGateway()
        val coordinator = PlaidLinkCoordinator(AccountRepository(gateway), UnsupportedPlaidLinkLauncher)

        coordinator.connect()

        assertTrue(coordinator.state.value is ConnectionCoordinatorState.Unsupported)
        assertEquals(0, gateway.exchangeCalls)
    }

    @Test
    fun redeliveredLinkResultResumesStagedConnectionWithoutASecondLinkToken() = runTest {
        val gateway = FakeGateway()
        val coordinator = PlaidLinkCoordinator(AccountRepository(gateway), UnsupportedPlaidLinkLauncher)

        coordinator.recover(PlaidLinkResult.Success("public-token-only"))

        assertTrue(coordinator.state.value is ConnectionCoordinatorState.Pending)
        assertEquals(1, gateway.exchangeCalls)
    }

    private class FakeGateway : AccountConnectionGateway {
        var exchangeCalls = 0
        var selectedAccountIds: List<String>? = null

        override suspend fun createLinkToken(request: LinkTokenRequest) = ConnectionOperation("link-op", "ready", linkToken = "server-link-token")

        override suspend fun exchange(request: ExchangeRequest): ConnectionOperation {
            exchangeCalls += 1
            assertEquals("public-token-only", request.publicToken.value)
            return ConnectionOperation(
                "pending-op", "pending", pendingConnectionId = "pending-1",
                accounts = listOf(BankAccount("provider-account", "Checking", "1234", "checking", "CAD", "chequing")),
            )
        }

        override suspend fun selectAccounts(request: AccountSelectionRequest): ConnectionOperation {
            selectedAccountIds = request.accountIds.map { it.value }
            return ConnectionOperation("connected-op", "connected", connectionId = "connection-1")
        }

        override suspend fun cancelPending(request: PendingCancellationRequest) = Unit
        override suspend fun sync(request: SyncRequest) = ConnectionOperation("sync-op", "syncing")
        override suspend fun disconnect(request: DisconnectRequest) = Unit
        override suspend fun listAccounts(request: AccountPageRequest) = AccountPage(emptyList(), null, request.limit)
        override suspend fun listConnections() = emptyList<ConnectionStatus>()
    }
}
