package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.bank.PlaidCallbackIdentity
import com.lofuyu.borderledger.auth.OwnerSessionState
import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Regression coverage for the Task 3 external-operation ownership boundaries. */
class Task3ExternalOwnershipTest {
    @Test
    fun fileStateIsResetBetweenOwnerGenerationsAndLateCompletionCannotRestoreRowsOrReceipts() = runTest {
        var repositoryState = "idle"
        val state = OwnerScopedFileState { repositoryState = "idle" }
        state.bindCurrent("owner-a")
        state.runBound("owner-a") { repositoryState = "rows-a" }
        assertEquals("rows-a", repositoryState)

        state.invalidate()
        state.bindCurrent("owner-b")
        state.runBound("owner-b") { repositoryState = "rows-b" }
        assertEquals("rows-b", repositoryState)

        // A completion captured under owner A cannot write into owner B.
        try {
            state.runBound("owner-a") { repositoryState = "late-a-receipt" }
            fail("The prior owner must not regain the file repository.")
        } catch (_: IllegalStateException) {
            // Expected owner fence.
        }
        assertEquals("rows-b", repositoryState)
    }

    @Test
    fun concurrentLateFileCompletionIsFencedBeforeItCanPublishAnInvalidation() = runTest {
        var repositoryState = "idle"
        val state = OwnerScopedFileState { repositoryState = "idle" }
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        state.bindCurrent("owner-a")
        val late = async {
            state.runBound("owner-a") {
                entered.complete(Unit)
                release.await()
                "receipt-a"
            }
        }
        entered.await()
        val invalidate = async { state.invalidate() }
        // Invalidation waits for the old operation, then atomically resets it.
        assertFalse(invalidate.isCompleted)
        release.complete(Unit)
        assertEquals("receipt-a", late.await())
        invalidate.await()
        state.bindCurrent("owner-a")
        assertEquals("idle", repositoryState)
    }

    @Test
    fun staleFileReadCannotResetTheNewOwnersDraftOrReceipt() = runTest {
        var currentOwner = "owner-a"
        var repositoryState = "idle"
        val state = OwnerScopedFileState { repositoryState = "idle" }
        val staleReadReady = CompletableDeferred<Unit>()
        val resumeStaleRead = CompletableDeferred<Unit>()

        state.bindCurrent("owner-a")
        val staleRead = async {
            staleReadReady.complete(Unit)
            resumeStaleRead.await()
            runCatching {
                state.runCurrent("owner-a", isCurrent = { currentOwner == "owner-a" }) {
                    repositoryState
                }
            }
        }

        staleReadReady.await()
        currentOwner = "owner-b"
        state.bindCurrent("owner-b")
        state.runBound("owner-b") { repositoryState = "draft-b|receipt-b" }

        resumeStaleRead.complete(Unit)
        assertTrue(staleRead.await().isFailure)
        assertEquals("draft-b|receipt-b", state.runBound("owner-b") { repositoryState })
    }

    @Test
    fun androidJsonNullReconnectIdIsDecodedAsNullButNonNullValueSurvives() {
        val nullArgs = JSONObject().put("reconnectConnectionId", JSONObject.NULL)
        val valueArgs = JSONObject().put("reconnectConnectionId", "connection-7")
        assertNull(nullArgs.bridgeNullableString("reconnectConnectionId"))
        assertEquals("connection-7", valueArgs.bridgeNullableString("reconnectConnectionId"))
    }

    @Test
    fun recreatedPlaidCallbackRequiresThePersistedMatchingOperation() {
        val original = PlaidCallbackIdentity()
        original.begin("flow-a")
        val savedOperationId = original.snapshot()

        val recreated = PlaidCallbackIdentity(savedOperationId)
        assertNull(recreated.claim("flow-b"))
        assertEquals("flow-a", recreated.claim(null))
        assertNull(recreated.claim(null))

        val orphaned = PlaidCallbackIdentity()
        assertNull(orphaned.claim(null))

        val completed = PlaidCallbackIdentity()
        completed.begin("flow-c")
        completed.complete("flow-c")
        assertNull(completed.snapshot())
        assertNull(completed.claim(null))
    }

    @Test
    fun plaidCallbackBeforeResumeRestoresTheSessionAndReconcilesOnlyOnce() = runTest {
        var sessionState: OwnerSessionState = OwnerSessionState.Restoring
        var restores = 0
        val fence = RestoredOwnerFence(
            restore = {
                restores += 1
                sessionState = OwnerSessionState.SignedIn(
                    expiresAt = "2026-10-17T00:00:00Z",
                    scopes = listOf("owner"),
                    pendingDestination = null,
                )
            },
            currentGeneration = { "owner-restored" },
            signedIn = { sessionState is OwnerSessionState.SignedIn },
        )
        val journal = BridgeOperationJournal(MemoryRecords())
        journal.awaitExternal("plaid-restored", "plaid", "{}", "owner-restored")
        val callbackClaim = RestoredPlaidCallbackClaim(
            pending = {
                JSONObject()
                    .put("kind", "plaid")
                    .put("operationId", "plaid-restored")
                    .put("owner", "owner-restored")
            },
            ownerFence = fence,
        )
        var exchanges = 0

        suspend fun deliverCallback() {
            val claimed = callbackClaim.claim("plaid-restored") ?: return
            journal.completeExternal(claimed.getString("operationId"), claimed.getString("owner")) {
                exchanges += 1
                "pending-connection"
            }
        }

        assertTrue(sessionState is OwnerSessionState.Restoring)
        deliverCallback()
        deliverCallback()
        assertEquals(2, restores)
        assertEquals(1, exchanges)
        assertEquals("completed", journal.query("plaid-restored", "owner-restored")?.status)
    }

    @Test
    fun plaidCallbackThatCannotRestoreItsOwnerRemainsPendingWithoutReplayOrRebind() = runTest {
        var sessionState: OwnerSessionState = OwnerSessionState.Restoring
        var restores = 0
        val fence = RestoredOwnerFence(
            restore = { restores += 1 },
            currentGeneration = { "owner-restored" },
            signedIn = { sessionState is OwnerSessionState.SignedIn },
        )
        val journal = BridgeOperationJournal(MemoryRecords())
        journal.awaitExternal("plaid-pending", "plaid", "{}", "owner-restored")
        val callbackClaim = RestoredPlaidCallbackClaim(
            pending = {
                JSONObject()
                    .put("kind", "plaid")
                    .put("operationId", "plaid-pending")
                    .put("owner", "owner-restored")
            },
            ownerFence = fence,
        )
        var exchanges = 0

        callbackClaim.claim("plaid-pending")?.let { claimed ->
            journal.completeExternal(claimed.getString("operationId"), claimed.getString("owner")) {
                exchanges += 1
                "wrong"
            }
        }

        assertEquals(1, restores)
        assertEquals(0, exchanges)
        assertEquals("awaiting_result", journal.query("plaid-pending", "owner-restored")?.status)
        assertNull(journal.query("plaid-pending", "new-owner"))
    }

    @Test
    fun interruptedPlaidExchangeCanRestoreItsPublicTokenOnlyForTheSameOwnerAndOperation() = runTest {
        val records = MemoryRecords()
        val firstRuntime = PendingPlaidResultStore(records)
        firstRuntime.save("owner-a", "plaid-op-1", "short-lived-public-token")

        val restoredRuntime = PendingPlaidResultStore(records)
        assertEquals("short-lived-public-token", restoredRuntime.read("owner-a", "plaid-op-1"))
        assertNull(restoredRuntime.read("owner-b", "plaid-op-1"))
        assertNull(restoredRuntime.read("owner-a", "plaid-op-2"))
        restoredRuntime.clear("owner-b", "plaid-op-1")
        assertEquals("short-lived-public-token", restoredRuntime.read("owner-a", "plaid-op-1"))
        restoredRuntime.clear("owner-a", "plaid-op-1")
        assertNull(restoredRuntime.read("owner-a", "plaid-op-1"))
    }

    @Test
    fun accountLinkOutcomesKeepFixedCodesWithoutProviderText() {
        val pending = com.lofuyu.borderledger.accounts.ConnectionOperation("o", "pending", pendingConnectionId = "p")
        assertEquals("success", BridgePayloads.link(com.lofuyu.borderledger.bank.ConnectionCoordinatorState.Pending(pending, emptyList()))["outcomeCode"])
        assertEquals("canceled", BridgePayloads.link(com.lofuyu.borderledger.bank.ConnectionCoordinatorState.Canceled)["outcomeCode"])
        assertEquals("unsupported", BridgePayloads.link(com.lofuyu.borderledger.bank.ConnectionCoordinatorState.Unsupported("provider secret"))["outcomeCode"])
        val failed = BridgePayloads.link(com.lofuyu.borderledger.bank.ConnectionCoordinatorState.Failed("provider secret"))
        assertEquals("failed", failed["outcomeCode"])
        assertFalse(failed.toString().contains("secret"))
        val unresolved = BridgePayloads.link(com.lofuyu.borderledger.bank.ConnectionCoordinatorState.ReconciliationRequired)
        assertEquals("reconciliation_required", unresolved["state"])
        assertEquals("reconciliation_required", unresolved["outcomeCode"])
    }

    private class MemoryRecords : SecureRecordPort {
        private val records = mutableMapOf<String, ByteArray>()
        override suspend fun read(record: String) = records[record]?.copyOf()
        override suspend fun write(record: String, value: ByteArray) { records[record] = value.copyOf() }
        override suspend fun delete(record: String) { records.remove(record) }
    }
}
